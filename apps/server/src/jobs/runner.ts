// The job runner (AD-8): claims jobs per lane under a lease, runs their handlers as
// `SystemViewer` `job:<kind>`, renews the lease while a handler runs, and records the outcome
// through the `app` lifecycle use cases. All timing reads the injected `Clock`; `start()` only
// adds a real interval that calls `tick()`, so tests drive the runner with `tick()` alone.
import {
  type Clock,
  claimJob,
  completeJob,
  ensureSchedules,
  failJob,
  type IdGenerator,
  JOB_LANES,
  type JobContext,
  type JobKind,
  type JobLane,
  type JobRegistration,
  type JobRow,
  type RunnerLiveness,
  renewJobLease,
  type Schedule,
  type SystemViewer,
  type UnitOfWork,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";

export type LaneConcurrency = Readonly<Record<JobLane, number>>;

export const DEFAULT_CONCURRENCY: LaneConcurrency = { llm: 1, net: 2, local: 1 };
export const DEFAULT_LEASE_MS = 60_000;

export type RunnerLog = (
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown>,
) => void;

export interface RunnerOptions {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly kinds: readonly JobRegistration[];
  readonly schedules: readonly Schedule[];
  readonly concurrency?: Partial<LaneConcurrency>;
  readonly leaseMs?: number;
  /** This runner's lease owner name; unique per process. Defaults to `runner:<new id>`. */
  readonly owner?: string;
  /** How often `start()` calls `tick()`, in real milliseconds. Defaults to min(1 s, lease / 3). */
  readonly pollMs?: number;
  /** How long `stop()` waits for running handlers, in real milliseconds. Defaults to 10 s. */
  readonly stopTimeoutMs?: number;
  /** Structured log sink. Never receives payloads or error text. */
  readonly log?: RunnerLog;
}

export interface Runner {
  readonly owner: string;
  /** How often `start()` calls `tick()`, in real milliseconds. */
  readonly pollMs: number;
  /**
   * For `/healthz`: whether it is started and not stopped, and when it last started or ticked
   * (a tick counts once its claims succeed), by the injected clock.
   */
  liveness(): RunnerLiveness;
  /**
   * Ensures the schedules' next rows, warns once for each lane with concurrency 0 (disabled),
   * then calls `tick()` every `pollMs`.
   */
  start(): void;
  /**
   * Stops claiming, and waits (up to `stopTimeoutMs`) for running handlers, renewing their
   * leases every `pollMs` meanwhile.
   */
  stop(): Promise<void>;
  /**
   * One pass: renews leases due for renewal (every `leaseMs / 3` by the clock), then claims
   * runnable jobs up to each lane's concurrency and starts their handlers. Resolves when the
   * handlers started in this pass have finished and their outcomes are recorded.
   */
  tick(): Promise<void>;
  /** Enqueues each schedule's next run unless it already has a live row. */
  ensureSchedules(): void;
  /** Resolves when every running handler has finished and its outcome is recorded. */
  idle(): Promise<void>;
}

/** The context a job's bookkeeping and handler run with: `job:<kind>`, or `job:runner`. */
interface RunContext extends UseCaseContext {
  readonly viewer: SystemViewer;
}

interface Run {
  /** The latest claimed row; replaced when this runner re-claims the job. */
  job: JobRow;
  readonly ctx: RunContext;
  /** Aborted when the attempt times out or `stop()` gives up on it. */
  readonly abort: AbortController;
  renewedAt: number;
  done: Promise<void>;
}

const logToConsole: RunnerLog = (level, msg, fields) => {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === "info") console.log(line);
  else console.error(line);
};

function positiveInteger(name: string, value: number, min = 1): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`createRunner: ${name} must be an integer >= ${min}, got ${value}`);
  }
  return value;
}

/** An attempt ran past its kind's `timeoutMs`. */
export class JobTimeout extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms} ms`);
    this.name = "JobTimeout";
  }
}

/** The runner stopped before the attempt finished. */
export class RunnerStopped extends Error {
  constructor() {
    super("The job runner stopped");
    this.name = "RunnerStopped";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function createRunner(options: RunnerOptions): Runner {
  const leaseMs = positiveInteger("leaseMs", options.leaseMs ?? DEFAULT_LEASE_MS, 3);
  const concurrency: LaneConcurrency = { ...DEFAULT_CONCURRENCY, ...options.concurrency };
  for (const lane of JOB_LANES) positiveInteger(`concurrency.${lane}`, concurrency[lane], 0);
  const pollMs = options.pollMs ?? Math.min(1000, Math.floor(leaseMs / 3));
  const stopTimeoutMs = options.stopTimeoutMs ?? 10_000;
  const owner = options.owner ?? `runner:${options.newId<"Runner">()}`;
  const log = options.log ?? logToConsole;
  const { uow, clock, newId } = options;

  const kinds = new Map<string, JobRegistration>();
  for (const registration of options.kinds) {
    if (kinds.has(registration.kind.kind)) {
      throw new Error(`createRunner: job kind ${registration.kind.kind} is registered twice`);
    }
    kinds.set(registration.kind.kind, registration);
  }
  const names = new Set<string>();
  for (const schedule of options.schedules) {
    if (names.has(schedule.name)) {
      throw new Error(`createRunner: schedule ${schedule.name} is defined twice`);
    }
    names.add(schedule.name);
  }

  const runnerCtx: RunContext = { viewer: systemViewer("job:runner"), clock, newId, uow };
  const running = new Map<string, Run>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let lastTickAt: number | undefined;

  function contextFor(kind: string): RunContext {
    // Kinds from this build are validated as `job:<kind>` actors; an unknown row may not be.
    const registered = kinds.has(kind);
    return registered ? { ...runnerCtx, viewer: systemViewer(`job:${kind}`) } : runnerCtx;
  }

  function inLane(lane: JobLane): number {
    let count = 0;
    for (const run of running.values()) if (run.job.lane === lane) count++;
    return count;
  }

  /** Records a failure; logs, and never throws, so one bad job cannot stop the runner. */
  function fail(run: Run, kind: JobKind | undefined, error: string, permanent: boolean): void {
    try {
      const outcome = failJob(run.ctx, {
        job: run.job,
        owner,
        kind,
        error,
        permanent,
        schedules: options.schedules,
      });
      const fields = { kind: run.job.kind, jobId: run.job.id, attempt: run.job.attempts };
      if (outcome === "lost") log("warn", "job lease lost before its failure was recorded", fields);
      else log(outcome === "dead" ? "error" : "warn", `job failed (${outcome})`, fields);
    } catch (caught) {
      log("error", "could not record a job failure", {
        kind: run.job.kind,
        jobId: run.job.id,
        error: caught instanceof Error ? caught.name : "unknown",
      });
    }
  }

  function complete(run: Run): void {
    const fields = { kind: run.job.kind, jobId: run.job.id, attempt: run.job.attempts };
    try {
      if (completeJob(run.ctx, { job: run.job, owner, schedules: options.schedules })) {
        log("info", "job done", fields);
      } else {
        log("warn", "job finished after its lease was lost; completion rejected", fields);
      }
    } catch (caught) {
      log("error", "could not record a job completion", {
        ...fields,
        error: caught instanceof Error ? caught.name : "unknown",
      });
    }
  }

  async function execute(run: Run): Promise<void> {
    const { job } = run;
    const registration = kinds.get(job.kind);
    if (registration === undefined) {
      fail(run, undefined, `No handler for job kind ${job.kind}`, true);
      return;
    }
    const { kind, handler } = registration;
    if (job.attempts > job.maxAttempts) {
      fail(run, kind, "Lease expired on the final attempt", true);
      return;
    }
    let payload: unknown;
    try {
      payload = kind.schema.parse(JSON.parse(job.payload));
    } catch {
      fail(run, kind, "Payload failed its schema at run time", true);
      return;
    }
    const ctx: JobContext = {
      ...run.ctx,
      job: { id: job.id, kind: job.kind, attempt: job.attempts },
      signal: run.abort.signal,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = handler(ctx, payload);
      if (kind.timeoutMs === undefined) {
        await work;
      } else {
        const limit = kind.timeoutMs;
        // The attempt fails at the limit; the aborted signal tells the handler to stop its I/O.
        // A later settlement of `work` is ignored.
        work.catch(() => {});
        await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const error = new JobTimeout(limit);
              run.abort.abort(error);
              reject(error);
            }, limit);
            timer.unref?.();
          }),
        ]);
      }
    } catch (error) {
      fail(run, kind, errorText(error), false);
      return;
    } finally {
      clearTimeout(timer);
    }
    complete(run);
  }

  function startRun(job: JobRow): Run {
    const run: Run = {
      job,
      ctx: contextFor(job.kind),
      abort: new AbortController(),
      renewedAt: clock.now().epochMilliseconds,
      done: Promise.resolve(),
    };
    running.set(job.id, run);
    run.done = execute(run).finally(() => running.delete(job.id));
    return run;
  }

  function renewLeases(): void {
    const now = clock.now().epochMilliseconds;
    for (const run of running.values()) {
      if (now - run.renewedAt < leaseMs / 3) continue;
      try {
        if (renewJobLease(run.ctx, { job: run.job, owner, leaseMs })) {
          run.renewedAt = now;
        } else {
          log("warn", "job lease lost while its handler runs", {
            kind: run.job.kind,
            jobId: run.job.id,
          });
          // Stop renewing; the handler's outcome will be rejected as not the owner's.
          run.renewedAt = Number.POSITIVE_INFINITY;
        }
      } catch (caught) {
        log("error", "could not renew a job lease", {
          kind: run.job.kind,
          jobId: run.job.id,
          error: caught instanceof Error ? caught.name : "unknown",
        });
      }
    }
  }

  function claimAll(): Run[] {
    const started: Run[] = [];
    for (const lane of JOB_LANES) {
      while (inLane(lane) < concurrency[lane]) {
        const job = claimJob(runnerCtx, { lane, owner, leaseMs });
        if (job === undefined) break;
        if (running.has(job.id)) {
          // Renewal failed past our own lease and we re-claimed a job we are still running: the
          // claim renewed the lease and counted an attempt. Keep the run, with the new row, so
          // a failure is judged against the new attempt count.
          const run = running.get(job.id);
          if (run !== undefined) {
            run.job = job;
            run.renewedAt = clock.now().epochMilliseconds;
          }
          log("warn", "re-claimed a job this runner is still running", {
            kind: job.kind,
            jobId: job.id,
          });
          continue;
        }
        started.push(startRun(job));
      }
    }
    return started;
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    renewLeases();
    let started: Run[];
    try {
      started = claimAll();
    } catch (caught) {
      log("error", "could not claim jobs", {
        error: caught instanceof Error ? caught.name : "unknown",
      });
      return;
    }
    lastTickAt = clock.now().epochMilliseconds;
    await Promise.all(started.map((run) => run.done));
  }

  async function idle(): Promise<void> {
    while (running.size > 0) await Promise.all([...running.values()].map((run) => run.done));
  }

  return {
    owner,
    pollMs,
    liveness: () => ({ running: timer !== undefined && !stopped, lastTickAt, pollMs }),
    tick,
    idle,
    ensureSchedules: () => ensureSchedules(runnerCtx, options.schedules),
    start: () => {
      if (stopped) throw new Error("A stopped runner cannot start again; create a new one");
      if (timer !== undefined) return;
      ensureSchedules(runnerCtx, options.schedules);
      lastTickAt = clock.now().epochMilliseconds;
      for (const lane of JOB_LANES) {
        if (concurrency[lane] === 0) {
          log("warn", "job lane disabled: concurrency is 0, so its jobs never run", { lane });
        }
      }
      timer = setInterval(() => void tick(), pollMs);
      timer.unref?.();
    },
    stop: async () => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (running.size === 0) return;
      // Keep the running jobs' leases alive while they drain, or they could expire mid-drain.
      const heartbeat = setInterval(renewLeases, pollMs);
      heartbeat.unref?.();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const gaveUp = new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), stopTimeoutMs);
      });
      const result = await Promise.race([idle().then(() => "idle" as const), gaveUp]);
      clearTimeout(timeout);
      clearInterval(heartbeat);
      if (result === "timeout") {
        log("warn", "stopped with handlers still running; their leases will expire", {
          running: running.size,
        });
        // Tell them to stop their I/O (a child process, a worker) rather than run on unowned.
        for (const run of running.values()) run.abort.abort(new RunnerStopped());
      }
    },
  };
}
