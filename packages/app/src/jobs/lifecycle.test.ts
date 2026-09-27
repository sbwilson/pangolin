import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import type { JobRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { write } from "../write.ts";
import { enqueueJob } from "./enqueue.ts";
import { claimJob, completeJob, ensureSchedules, failJob, renewJobLease } from "./lifecycle.ts";
import { defineJobKind, defineSchedule, type JobKind } from "./registry.ts";

const LEASE = 60_000;
const schema = z.object({ n: z.number() }).strict();

const flaky = defineJobKind({
  kind: "test-flaky",
  schema,
  lane: "net",
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
  externalEffects: true,
  needsPersonWhenDead: true,
});

const quiet = defineJobKind({
  kind: "test-quiet",
  schema,
  lane: "local",
  retry: { maxAttempts: 1 },
  externalEffects: false,
  needsPersonWhenDead: false,
});

const hourly = defineSchedule({
  name: "hourly",
  kind: quiet,
  payload: { n: 0 },
  next: (after) => after.add({ hours: 1 }),
});

function setup() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("job:runner"), clock);
  return { clock, ctx, uow };
}

function enqueue(ctx: UseCaseContext, kind: JobKind<{ n: number }>, n: number) {
  return write(ctx, (tx) => enqueueJob(tx, ctx, kind, { n }));
}

function claim(ctx: UseCaseContext, lane: JobRow["lane"], owner: string): JobRow {
  const job = claimJob(ctx, { lane, owner, leaseMs: LEASE });
  if (job === undefined) throw new Error("nothing claimed");
  return job;
}

describe("claimJob", () => {
  it("claims the oldest due job in the lane with a lease and one more attempt", () => {
    const { ctx, clock } = setup();
    const first = enqueue(ctx, flaky, 1);
    clock.advance(1);
    enqueue(ctx, flaky, 2);
    enqueue(ctx, quiet, 3);
    const job = claim(ctx, "net", "a");
    expect(job).toMatchObject({
      id: first,
      status: "running",
      leaseOwner: "a",
      leaseExpiresAt: "2026-09-27T00:01:00.001Z",
      attempts: 1,
    });
  });

  it("skips jobs that are not due, and returns undefined when nothing is runnable", () => {
    const { ctx, clock } = setup();
    write(ctx, (tx) =>
      enqueueJob(tx, ctx, flaky, { n: 1 }, { runAt: clock.now().add({ minutes: 5 }) }),
    );
    expect(claimJob(ctx, { lane: "net", owner: "a", leaseMs: LEASE })).toBeUndefined();
    clock.advance(5 * 60_000);
    expect(claim(ctx, "net", "a").attempts).toBe(1);
  });

  it("re-claims a job whose lease expired, counting the lost attempt", () => {
    const { ctx, clock } = setup();
    const id = enqueue(ctx, flaky, 1);
    claim(ctx, "net", "a");
    expect(claimJob(ctx, { lane: "net", owner: "b", leaseMs: LEASE })).toBeUndefined();
    clock.advance(LEASE);
    const job = claim(ctx, "net", "b");
    expect(job).toMatchObject({ id, leaseOwner: "b", attempts: 2 });
  });
});

describe("lease ownership", () => {
  it("rejects completion, renewal and failure from a runner that lost the lease", () => {
    const { ctx, clock, uow } = setup();
    enqueue(ctx, flaky, 1);
    const asA = claim(ctx, "net", "a");
    clock.advance(LEASE);
    const asB = claim(ctx, "net", "b");
    expect(completeJob(ctx, { job: asA, owner: "a", schedules: [] })).toBe(false);
    expect(renewJobLease(ctx, { job: asA, owner: "a", leaseMs: LEASE })).toBe(false);
    expect(failJob(ctx, { job: asA, owner: "a", kind: flaky, error: "x", schedules: [] })).toBe(
      "lost",
    );
    expect(uow.state.jobs[0]).toMatchObject({ status: "running", leaseOwner: "b" });
    expect(completeJob(ctx, { job: asB, owner: "b", schedules: [] })).toBe(true);
    expect(uow.state.jobs[0]).toMatchObject({
      status: "done",
      leaseOwner: null,
      finishedAt: "2026-09-27T00:01:00.000Z",
    });
  });

  it("renews the owner's lease from now", () => {
    const { ctx, clock, uow } = setup();
    enqueue(ctx, flaky, 1);
    const job = claim(ctx, "net", "a");
    clock.advance(20_000);
    expect(renewJobLease(ctx, { job, owner: "a", leaseMs: LEASE })).toBe(true);
    expect(uow.state.jobs[0]?.leaseExpiresAt).toBe("2026-09-27T00:01:20.000Z");
  });
});

describe("failJob", () => {
  it("backs off base, then 2 × base, then goes dead with one job.dead review item", () => {
    const { ctx, clock, uow } = setup();
    const id = enqueue(ctx, flaky, 1);

    const fail = (job: JobRow) =>
      failJob(ctx, { job, owner: "a", kind: flaky, error: "boom", schedules: [] });

    expect(fail(claim(ctx, "net", "a"))).toBe("retry");
    expect(uow.state.jobs[0]).toMatchObject({
      status: "pending",
      runAt: "2026-09-27T00:00:01.000Z",
      lastError: "boom",
      leaseOwner: null,
    });
    clock.advance(1000);
    expect(fail(claim(ctx, "net", "a"))).toBe("retry");
    expect(uow.state.jobs[0]?.runAt).toBe("2026-09-27T00:00:03.000Z");
    clock.advance(2000);
    expect(fail(claim(ctx, "net", "a"))).toBe("dead");
    expect(uow.state.jobs[0]).toMatchObject({
      status: "dead",
      attempts: 3,
      finishedAt: "2026-09-27T00:00:03.000Z",
    });

    expect(uow.state.reviewItems).toEqual([
      expect.objectContaining({
        kind: "job.dead",
        accountId: null,
        personId: null,
        entityRef: `job:${id}`,
        dedupeKey: `job.dead:${id}`,
        resolvedAt: null,
      }),
    ]);
    expect(uow.state.audit).toEqual([
      expect.objectContaining({ entity: "review_item", action: "raise", actor: "job:runner" }),
    ]);
  });

  it("goes straight to dead when permanent, and raises nothing for a quiet kind", () => {
    const { ctx, uow } = setup();
    enqueue(ctx, quiet, 1);
    const job = claim(ctx, "local", "a");
    expect(
      failJob(ctx, { job, owner: "a", kind: quiet, error: "bad", permanent: true, schedules: [] }),
    ).toBe("dead");
    expect(uow.state.reviewItems).toEqual([]);
    expect(uow.state.audit).toEqual([]);
  });

  it("goes dead without a kind, and after a crash on the final attempt", () => {
    const { ctx, clock, uow } = setup();
    enqueue(ctx, flaky, 1);
    const job = claim(ctx, "net", "a");
    expect(failJob(ctx, { job, owner: "a", kind: undefined, error: "?", schedules: [] })).toBe(
      "dead",
    );
    expect(uow.state.reviewItems).toEqual([]);

    enqueue(ctx, quiet, 2);
    claim(ctx, "local", "a");
    clock.advance(LEASE);
    const again = claim(ctx, "local", "b");
    expect(again.attempts).toBe(2);
    expect(failJob(ctx, { job: again, owner: "b", kind: quiet, error: "x", schedules: [] })).toBe(
      "dead",
    );
  });

  it("keeps at most 2000 characters of error text", () => {
    const { ctx, uow } = setup();
    enqueue(ctx, flaky, 1);
    const job = claim(ctx, "net", "a");
    failJob(ctx, { job, owner: "a", kind: flaky, error: "e".repeat(5000), schedules: [] });
    expect(uow.state.jobs[0]?.lastError).toHaveLength(2000);
  });
});

describe("schedules", () => {
  it("ensures exactly one pending row per schedule, however often it runs", () => {
    const { ctx, clock, uow } = setup();
    ensureSchedules(ctx, [hourly]);
    clock.advance(5 * 60_000);
    ensureSchedules(ctx, [hourly]);
    expect(uow.state.jobs).toEqual([
      expect.objectContaining({
        kind: "test-quiet",
        dedupeKey: "schedule:hourly",
        status: "pending",
        runAt: "2026-09-27T01:00:00.000Z",
      }),
    ]);
  });

  it("enqueues the next run when a scheduled job completes", () => {
    const { ctx, clock, uow } = setup();
    ensureSchedules(ctx, [hourly]);
    clock.set("2026-09-27T01:00:30Z");
    const job = claim(ctx, "local", "a");
    expect(completeJob(ctx, { job, owner: "a", schedules: [hourly] })).toBe(true);
    expect(uow.state.jobs.map((row) => [row.status, row.runAt])).toEqual([
      ["done", "2026-09-27T01:00:00.000Z"],
      ["pending", "2026-09-27T02:00:30.000Z"],
    ]);
  });

  it("enqueues the next run when a scheduled job dies", () => {
    const { ctx, clock, uow } = setup();
    ensureSchedules(ctx, [hourly]);
    clock.set("2026-09-27T01:00:00Z");
    const job = claim(ctx, "local", "a");
    expect(failJob(ctx, { job, owner: "a", kind: quiet, error: "x", schedules: [hourly] })).toBe(
      "dead",
    );
    expect(uow.state.jobs.map((row) => row.status)).toEqual(["dead", "pending"]);
  });

  it("rejects a schedule whose next run is not after now, at ensure and at the next run", () => {
    const { ctx, clock, uow } = setup();
    const stuck = defineSchedule({ ...hourly, name: "stuck", next: (after) => after });
    expect(() => ensureSchedules(ctx, [stuck])).toThrow(TypeError);
    expect(() => ensureSchedules(ctx, [stuck])).toThrow(/Schedule stuck/);
    expect(uow.state.jobs).toEqual([]);

    // Fine at startup, broken by the time its job finishes.
    const cutoff = clock.now().add({ minutes: 30 });
    const later = defineSchedule({
      ...hourly,
      name: "later",
      next: (after) =>
        after.epochMilliseconds < cutoff.epochMilliseconds ? after.add({ minutes: 30 }) : after,
    });
    ensureSchedules(ctx, [later]);
    clock.set(cutoff);
    const job = claim(ctx, "local", "a");
    expect(() => completeJob(ctx, { job, owner: "a", schedules: [later] })).toThrow(
      /Schedule later/,
    );
    expect(uow.state.jobs.map((row) => row.status)).toEqual(["running"]);
  });

  it("does not enqueue a next run while a scheduled job only retries", () => {
    const { ctx, uow } = setup();
    const retrying = defineSchedule({ ...hourly, name: "retrying", kind: flaky });
    ensureSchedules(ctx, [retrying]);
    uow.state.jobs = uow.state.jobs.map((row) => ({ ...row, runAt: "2026-09-27T00:00:00.000Z" }));
    const job = claim(ctx, "net", "a");
    expect(failJob(ctx, { job, owner: "a", kind: flaky, error: "x", schedules: [retrying] })).toBe(
      "retry",
    );
    expect(uow.state.jobs).toHaveLength(1);
  });
});
