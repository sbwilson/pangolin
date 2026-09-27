import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Clock,
  createIdGenerator,
  defineJobKind,
  defineSchedule,
  enqueueJob,
  fixedClockAt,
  type JobContext,
  type JobRegistration,
  jobHandler,
  listReviewItems,
  type Schedule,
  systemClock,
  type UnitOfWork,
  updateHouseholdSettings,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createRunner, type RunnerLog, type RunnerOptions } from "./runner.ts";

const LEASE = 60_000;
const payload = z.object({ n: z.number() }).strict();

const echo = defineJobKind({
  kind: "test-echo",
  schema: payload,
  lane: "local",
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
  externalEffects: false,
  needsPersonWhenDead: true,
});

const think = defineJobKind({
  kind: "test-think",
  schema: payload,
  lane: "llm",
  externalEffects: true,
  needsPersonWhenDead: false,
});

let dir: string;
let db: Db;
let uow: UnitOfWork;
// The server may not import @pangolin/shared, so instants come from the app's clocks.
const start = fixedClockAt("2026-09-27").now();
let now = start;
const clock: Clock = systemClock("UTC", () => now);
let ms: number;
const newId = createIdGenerator({ now: () => ++ms, random: Math.random });
let logs: { level: string; msg: string; fields: Record<string, unknown> }[];
const log: RunnerLog = (level, msg, fields) => logs.push({ level, msg, fields });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-runner-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  uow = createUnitOfWork(db);
  now = start;
  ms = now.epochMilliseconds;
  logs = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function advance(millis: number): void {
  now = now.add({ milliseconds: millis });
}

function runner(kinds: readonly JobRegistration[], extra: Partial<RunnerOptions> = {}) {
  return createRunner({ uow, clock, newId, kinds, schedules: [], leaseMs: LEASE, log, ...extra });
}

function enqueue(kind = echo, n = 1): string {
  const ctx = { viewer: systemViewer("cli:test"), clock, newId, uow };
  return write(ctx, (tx) => enqueueJob(tx, ctx, kind, { n }));
}

function jobs(): Record<string, unknown>[] {
  return db.prepare("SELECT * FROM job ORDER BY id").all() as Record<string, unknown>[];
}

/** A handler that waits until the test releases it, recording each call. */
function gate() {
  const calls: { ctx: JobContext; n: number }[] = [];
  const pending: (() => void)[] = [];
  const handler = async (ctx: JobContext, input: { n: number }) => {
    calls.push({ ctx, n: input.n });
    await new Promise<void>((resolve) => pending.push(resolve));
  };
  return { calls, handler, release: () => pending.shift()?.() };
}

describe("runner", () => {
  it("runs a job as job:<kind> and commits through use cases", async () => {
    let seen: JobContext | undefined;
    const r = runner([
      jobHandler(echo, async (ctx, input) => {
        seen = ctx;
        await Promise.resolve();
        updateHouseholdSettings(ctx, { timezone: input.n === 1 ? "UTC" : "Australia/Perth" });
      }),
    ]);
    const id = enqueue();
    await r.tick();
    expect(seen?.viewer).toMatchObject({ kind: "system", actor: "job:test-echo" });
    expect(seen?.job).toEqual({ id, kind: "test-echo", attempt: 1 });
    expect(jobs()[0]).toMatchObject({ status: "done", attempts: 1 });
    expect(db.prepare("SELECT actor FROM audit_log").pluck().all()).toEqual(["job:test-echo"]);
    expect(logs.map((l) => l.msg)).toEqual(["job done"]);
  });

  it("lets a second runner finish a job whose runner stopped mid-run, once the lease passes", async () => {
    const a = gate();
    const runnerA = runner([jobHandler(echo, a.handler)], { owner: "a" });
    const bRan: number[] = [];
    const runnerB = runner([jobHandler(echo, async (_ctx, input) => void bRan.push(input.n))], {
      owner: "b",
    });
    enqueue();

    const hung = runnerA.tick();
    expect(a.calls).toHaveLength(1);
    await runnerB.tick();
    expect(bRan).toEqual([]);

    advance(LEASE);
    await runnerB.tick();
    expect(bRan).toEqual([1]);
    expect(jobs()[0]).toMatchObject({ status: "done", attempts: 2 });

    // A comes back and finishes: its completion is rejected and logged.
    a.release();
    await hung;
    expect(jobs()[0]).toMatchObject({ status: "done", attempts: 2 });
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "warn",
        msg: "job finished after its lease was lost; completion rejected",
      }),
    );
  });

  it("renews the lease every leaseMs / 3 while a handler runs", async () => {
    const a = gate();
    const runnerA = runner([jobHandler(echo, a.handler)], { owner: "a" });
    const runnerB = runner([jobHandler(echo, async () => {})], { owner: "b" });
    enqueue();
    const running = runnerA.tick();
    expect(jobs()[0]?.lease_expires_at).toBe("2026-09-27T00:01:00.000Z");

    advance(LEASE / 3 - 1);
    await runnerA.tick();
    expect(jobs()[0]?.lease_expires_at).toBe("2026-09-27T00:01:00.000Z");
    advance(1);
    await runnerA.tick();
    expect(jobs()[0]?.lease_expires_at).toBe("2026-09-27T00:01:20.000Z");

    // Past the first lease, but the renewed one still holds B off.
    advance(LEASE / 3 + 10_000);
    await runnerB.tick();
    expect(jobs()[0]).toMatchObject({ lease_owner: "a", attempts: 1 });

    a.release();
    await running;
    expect(jobs()[0]).toMatchObject({ status: "done", attempts: 1 });
  });

  it("retries with backoff, then goes dead with one job.dead review item", async () => {
    let calls = 0;
    const r = runner([
      jobHandler(echo, async () => {
        calls++;
        throw new Error("upstream said no: secret detail");
      }),
    ]);
    const id = enqueue();
    await r.tick();
    expect(jobs()[0]).toMatchObject({ status: "pending", run_at: "2026-09-27T00:00:01.000Z" });
    await r.tick();
    expect(calls).toBe(1);
    advance(1000);
    await r.tick();
    expect(jobs()[0]).toMatchObject({ status: "pending", run_at: "2026-09-27T00:00:03.000Z" });
    advance(2000);
    await r.tick();
    expect(calls).toBe(3);
    expect(jobs()[0]).toMatchObject({
      status: "dead",
      attempts: 3,
      last_error: "Error: upstream said no: secret detail",
    });
    const ctx = { viewer: systemViewer("cli:test"), clock, newId, uow };
    expect(listReviewItems(ctx)).toEqual([
      expect.objectContaining({ kind: "job.dead", entityRef: `job:${id}` }),
    ]);
    // Logs name the job but never carry its error text or payload.
    expect(JSON.stringify(logs)).not.toContain("secret");
  });

  it("runs one llm job at a time with llm concurrency 1", async () => {
    const g = gate();
    const r = runner([jobHandler(think, g.handler)], { concurrency: { llm: 1 } });
    enqueue(think, 1);
    enqueue(think, 2);
    enqueue(think, 3);

    const first = r.tick();
    await r.tick();
    expect(g.calls.map((c) => c.n)).toEqual([1]);
    expect(jobs().map((row) => row.status)).toEqual(["running", "pending", "pending"]);

    g.release();
    await first;
    const second = r.tick();
    expect(g.calls.map((c) => c.n)).toEqual([1, 2]);
    g.release();
    await second;
    const third = r.tick();
    g.release();
    await third;
    expect(jobs().map((row) => row.status)).toEqual(["done", "done", "done"]);
  });

  it("runs up to the lane's concurrency at once", async () => {
    const g = gate();
    const r = runner([jobHandler(think, g.handler)], { concurrency: { llm: 2 } });
    enqueue(think, 1);
    enqueue(think, 2);
    enqueue(think, 3);
    const both = r.tick();
    expect(g.calls.map((c) => c.n)).toEqual([1, 2]);
    g.release();
    g.release();
    await both;
    expect(jobs().map((row) => row.status)).toEqual(["done", "done", "pending"]);
    const third = r.tick();
    g.release();
    await third;
    expect(jobs().map((row) => row.status)).toEqual(["done", "done", "done"]);
  });

  it("sends a job whose payload no longer parses straight to dead", async () => {
    let ran = false;
    const r = runner([
      jobHandler(echo, async () => {
        ran = true;
      }),
    ]);
    enqueue();
    db.prepare(`UPDATE job SET payload = '{"n":"not a number"}'`).run();
    await r.tick();
    expect(ran).toBe(false);
    expect(jobs()[0]).toMatchObject({ status: "dead", attempts: 1 });
    expect(db.prepare("SELECT count(*) FROM review_item").pluck().get()).toBe(1);
  });

  it("sends a job of an unknown kind to dead", async () => {
    const r = runner([]);
    enqueue();
    await r.tick();
    expect(jobs()[0]).toMatchObject({
      status: "dead",
      last_error: "No handler for job kind test-echo",
    });
  });

  it("does not run a crashed job again once its final attempt is used up", async () => {
    const once = defineJobKind({ ...echo, kind: "test-once", retry: { maxAttempts: 1 } });
    const a = gate();
    const runnerA = runner([jobHandler(once, a.handler)], { owner: "a" });
    let ranB = false;
    const runnerB = runner(
      [
        jobHandler(once, async () => {
          ranB = true;
        }),
      ],
      { owner: "b" },
    );
    enqueue(once);
    void runnerA.tick();
    advance(LEASE);
    await runnerB.tick();
    expect(ranB).toBe(false);
    expect(jobs()[0]).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("rejects duplicate kinds and bad settings", () => {
    expect(() =>
      runner([jobHandler(echo, async () => {}), jobHandler(echo, async () => {})]),
    ).toThrow(/registered twice/);
    expect(() => runner([], { leaseMs: 0 })).toThrow(RangeError);
    expect(() => runner([], { concurrency: { net: -1 } })).toThrow(RangeError);
  });

  it("judges a failure against the new attempt count after re-claiming its own job", async () => {
    const twice = defineJobKind({ ...echo, kind: "test-twice", retry: { maxAttempts: 2 } });
    // A unit of work whose next write throws, so the lease renewal fails and the lease expires.
    let failNext = false;
    const flaky: UnitOfWork = {
      read: (fn) => uow.read(fn),
      transaction: (fn) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk hiccup");
        }
        return uow.transaction(fn);
      },
    };
    let release: (() => void) | undefined;
    const r = runner(
      [
        jobHandler(twice, async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          throw new Error("handler failed");
        }),
      ],
      { uow: flaky, owner: "a", concurrency: { local: 2 } },
    );
    enqueue(twice);
    const running = r.tick();
    advance(LEASE);
    failNext = true;
    await r.tick();
    expect(jobs()[0]).toMatchObject({ status: "running", lease_owner: "a", attempts: 2 });
    release?.();
    await running;
    // Attempt 2 of 2 failed: dead, not another retry on the stale attempt count.
    expect(jobs()[0]).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("reports its liveness: running once started, and when it last started or ticked", async () => {
    const r = runner([], { pollMs: 3_600_000 });
    expect(r.liveness()).toEqual({ running: false, lastTickAt: undefined, pollMs: 3_600_000 });
    r.start();
    expect(r.liveness()).toEqual({
      running: true,
      lastTickAt: start.epochMilliseconds,
      pollMs: 3_600_000,
    });
    advance(5000);
    await r.tick();
    expect(r.liveness().lastTickAt).toBe(start.epochMilliseconds + 5000);
    await r.stop();
    expect(r.liveness().running).toBe(false);
  });

  it("leaves lastTickAt unchanged when a tick's claim throws", async () => {
    let broken = false;
    const flaky: UnitOfWork = {
      transaction: (fn) => {
        if (broken) throw new Error("SQLITE_IOERR");
        return uow.transaction(fn);
      },
      read: (fn) => uow.read(fn),
    };
    const r = runner([], { uow: flaky, pollMs: 3_600_000 });
    r.start();
    const started = r.liveness().lastTickAt;
    expect(started).toBe(start.epochMilliseconds);
    advance(5000);
    broken = true;
    await r.tick();
    expect(r.liveness().lastTickAt).toBe(started);
    expect(logs.map((l) => l.msg)).toContain("could not claim jobs");
    broken = false;
    await r.stop();
  });

  it("warns once for each lane disabled with concurrency 0 when it starts", async () => {
    const r = runner([], { concurrency: { llm: 0, local: 0 }, pollMs: 3_600_000 });
    r.start();
    r.start();
    await r.stop();
    expect(logs.filter((l) => l.msg.startsWith("job lane disabled"))).toEqual([
      expect.objectContaining({ level: "warn", fields: { lane: "llm" } }),
      expect.objectContaining({ level: "warn", fields: { lane: "local" } }),
    ]);
  });

  it("keeps renewing leases while stop waits for running handlers", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    try {
      const lease = 300;
      const g = gate();
      const r = runner([jobHandler(echo, g.handler)], {
        owner: "a",
        leaseMs: lease,
        pollMs: 50,
        stopTimeoutMs: 10_000,
      });
      const other = runner([jobHandler(echo, async () => {})], { owner: "b", leaseMs: lease });
      enqueue();
      void r.tick();
      expect(jobs()[0]?.lease_expires_at).toBe("2026-09-27T00:00:00.300Z");

      const stopping = r.stop();
      advance(lease / 3);
      await vi.advanceTimersByTimeAsync(50);
      expect(jobs()[0]?.lease_expires_at).toBe("2026-09-27T00:00:00.400Z");

      // Past the first lease, but the drain kept it alive.
      advance(lease / 3 + 50);
      await vi.advanceTimersByTimeAsync(50);
      await other.tick();
      expect(jobs()[0]).toMatchObject({ status: "running", lease_owner: "a", attempts: 1 });

      g.release();
      await stopping;
      expect(jobs()[0]).toMatchObject({ status: "done", attempts: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for running handlers on stop, then claims nothing more", async () => {
    const g = gate();
    const r = runner([jobHandler(echo, g.handler)]);
    enqueue(echo, 1);
    void r.tick();
    const stopping = r.stop();
    g.release();
    await stopping;
    expect(jobs()[0]).toMatchObject({ status: "done" });
    enqueue(echo, 2);
    await r.tick();
    expect(jobs()[1]).toMatchObject({ status: "pending" });
  });
});

describe("runner schedules", () => {
  const every = defineSchedule({
    name: "every-hour",
    kind: echo,
    payload: { n: 7 },
    next: (after) => after.add({ hours: 1 }),
  });

  function scheduled(
    schedules: readonly Schedule[],
    handler: (ctx: JobContext, input: { n: number }) => Promise<void> = async () => {},
  ) {
    return runner([jobHandler(echo, handler)], { schedules, pollMs: 3_600_000 });
  }

  it("keeps exactly one pending row per schedule across start, stop and start", async () => {
    const first = scheduled([every]);
    first.start();
    await first.stop();
    advance(60_000);
    const second = scheduled([every]);
    second.start();
    await second.stop();
    expect(jobs()).toEqual([
      expect.objectContaining({
        dedupe_key: "schedule:every-hour",
        status: "pending",
        run_at: "2026-09-27T01:00:00.000Z",
      }),
    ]);
  });

  it("enqueues the next run when a scheduled job finishes", async () => {
    const seen: number[] = [];
    const r = scheduled([every], async (_ctx: JobContext, input: { n: number }) => {
      seen.push(input.n);
    });
    r.ensureSchedules();
    await r.tick();
    expect(seen).toEqual([]);
    advance(3_600_000);
    await r.tick();
    expect(seen).toEqual([7]);
    expect(jobs().map((row) => [row.status, row.run_at])).toEqual([
      ["done", "2026-09-27T01:00:00.000Z"],
      ["pending", "2026-09-27T02:00:00.000Z"],
    ]);
  });

  it("enqueues the next run when a scheduled job ends dead", async () => {
    const once = defineJobKind({ ...echo, kind: "test-once-dead", retry: { maxAttempts: 1 } });
    const daily = defineSchedule({
      name: "daily",
      kind: once,
      payload: { n: 1 },
      next: (after) => after.add({ hours: 24 }),
    });
    const r = runner(
      [
        jobHandler(once, async () => {
          throw new Error("always");
        }),
      ],
      { schedules: [daily] },
    );
    r.ensureSchedules();
    advance(24 * 3_600_000);
    await r.tick();
    expect(jobs().map((row) => [row.status, row.dedupe_key, row.run_at])).toEqual([
      ["dead", "schedule:daily", "2026-09-28T00:00:00.000Z"],
      ["pending", "schedule:daily", "2026-09-29T00:00:00.000Z"],
    ]);
  });

  it("refuses a schedule defined twice", () => {
    expect(() => scheduled([every, every])).toThrow(/defined twice/);
  });
});
