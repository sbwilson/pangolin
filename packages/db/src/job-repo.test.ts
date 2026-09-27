import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimJob,
  completeJob,
  createIdGenerator,
  deadJobs,
  defineJobKind,
  enqueueJob,
  failJob,
  type JobRow,
  jobCounts,
  listReviewItems,
  renewJobLease,
  type UseCaseContext,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const LEASE = 60_000;

const flaky = defineJobKind({
  kind: "test-flaky",
  schema: z.object({ n: z.number() }).strict(),
  lane: "net",
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
  externalEffects: false,
  needsPersonWhenDead: true,
});

let dir: string;
let db: Db;
let now: Temporal.Instant;
let ctx: UseCaseContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-jobs-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = Temporal.Instant.from("2026-09-27T00:00:00Z");
  let ms = now.epochMilliseconds;
  ctx = {
    viewer: systemViewer("job:runner"),
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function advance(ms: number): void {
  now = now.add({ milliseconds: ms });
}

function jobs(): Record<string, unknown>[] {
  return db.prepare("SELECT * FROM job ORDER BY id").all() as Record<string, unknown>[];
}

function enqueue(n: number, dedupeKey?: string) {
  return write(ctx, (tx) =>
    enqueueJob(tx, ctx, flaky, { n }, dedupeKey === undefined ? {} : { dedupeKey }),
  );
}

function claim(owner: string): JobRow {
  const job = claimJob(ctx, { lane: "net", owner, leaseMs: LEASE });
  if (job === undefined) throw new Error("nothing claimed");
  return job;
}

describe("migration 0002", () => {
  it("creates job and review_item STRICT with their indexes", () => {
    const strict = db
      .prepare("SELECT name, strict FROM pragma_table_list WHERE name IN ('job', 'review_item')")
      .all();
    expect(strict).toEqual(
      expect.arrayContaining([
        { name: "job", strict: 1 },
        { name: "review_item", strict: 1 },
      ]),
    );
    const indexes = (table: string) =>
      db
        .prepare(
          `SELECT name, "unique", partial FROM pragma_index_list('${table}') WHERE origin = 'c' ORDER BY name`,
        )
        .all();
    expect(indexes("job")).toEqual([
      { name: "job_claim_idx", unique: 0, partial: 0 },
      { name: "job_dedupe_key_live_idx", unique: 1, partial: 1 },
      { name: "job_finished_idx", unique: 0, partial: 0 },
    ]);
    expect(indexes("review_item")).toEqual([
      { name: "review_item_dedupe_key_open_idx", unique: 1, partial: 1 },
    ]);
  });

  it("checks lane, status, JSON payload and lease columns", () => {
    const insert = (lane: string, status: string, payload: string, owner: string | null) =>
      db
        .prepare(
          `INSERT INTO job (id, kind, lane, payload, status, attempts, max_attempts, run_at,
             lease_owner, lease_expires_at, created_at, updated_at, finished_at)
           VALUES (hex(randomblob(8)), 'k', ?, ?, ?, 0, 1, 'x', ?, ?, 'x', 'x', ?)`,
        )
        .run(lane, payload, status, owner, owner, status === "done" ? "x" : null);
    insert("local", "pending", "{}", null);
    expect(() => insert("gpu", "pending", "{}", null)).toThrow(/CHECK constraint failed: job_lane/);
    expect(() => insert("local", "stuck", "{}", null)).toThrow(/CHECK constraint failed/);
    expect(() => insert("local", "pending", "nope", null)).toThrow(/job_payload_json/);
    expect(() => insert("local", "running", "{}", null)).toThrow(/job_lease/);
    insert("local", "done", "{}", null);
  });

  it("allows one live job per dedupe key but any number of finished ones", () => {
    const insert = db.prepare(
      `INSERT INTO job (id, kind, lane, payload, dedupe_key, status, attempts, max_attempts, run_at,
         created_at, updated_at, finished_at)
       VALUES (?, 'k', 'local', '{}', 'key', ?, 0, 1, 'x', 'x', 'x', ?)`,
    );
    insert.run("1", "done", "x");
    insert.run("2", "dead", "x");
    insert.run("3", "pending", null);
    expect(() => insert.run("4", "pending", null)).toThrow(/UNIQUE constraint failed/);
  });
});

describe("job repository on SQLite", () => {
  it("dedupes two enqueues while the first is pending: one row, the same ID", () => {
    const first = enqueue(1, "k");
    const second = enqueue(2, "k");
    expect(second).toBe(first);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ payload: '{"n":1}', status: "pending", attempts: 0 });
  });

  it("enqueues anew once the first job is done", () => {
    const first = enqueue(1, "k");
    completeJob(ctx, { job: claim("a"), owner: "a", schedules: [] });
    expect(enqueue(2, "k")).not.toBe(first);
    expect(jobs().map((row) => row.status)).toEqual(["done", "pending"]);
  });

  it("rolls the job back with the business transaction", () => {
    expect(() =>
      write(ctx, (tx) => {
        enqueueJob(tx, ctx, flaky, { n: 1 });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(jobs()).toEqual([]);
  });

  it("claims in run_at order within the lane, one runnable job at a time", () => {
    const a = enqueue(1);
    advance(1);
    const b = enqueue(2);
    expect(claim("r").id).toBe(a);
    expect(claim("r").id).toBe(b);
    expect(claimJob(ctx, { lane: "net", owner: "r", leaseMs: LEASE })).toBeUndefined();
    expect(claimJob(ctx, { lane: "llm", owner: "r", leaseMs: LEASE })).toBeUndefined();
  });

  it("lets a second runner take over an expired lease, and rejects the first owner", () => {
    const id = enqueue(1);
    const asA = claim("a");
    advance(LEASE - 1);
    expect(claimJob(ctx, { lane: "net", owner: "b", leaseMs: LEASE })).toBeUndefined();
    advance(1);
    const asB = claim("b");
    expect(asB).toMatchObject({ id, attempts: 2, leaseOwner: "b" });

    expect(completeJob(ctx, { job: asA, owner: "a", schedules: [] })).toBe(false);
    expect(renewJobLease(ctx, { job: asA, owner: "a", leaseMs: LEASE })).toBe(false);
    expect(jobs()[0]).toMatchObject({ status: "running", lease_owner: "b" });

    expect(renewJobLease(ctx, { job: asB, owner: "b", leaseMs: LEASE })).toBe(true);
    expect(completeJob(ctx, { job: asB, owner: "b", schedules: [] })).toBe(true);
    expect(jobs()[0]).toMatchObject({
      status: "done",
      lease_owner: null,
      lease_expires_at: null,
      finished_at: "2026-09-27T00:01:00.000Z",
    });
  });

  it("retries with backoff, then dies raising exactly one job.dead review item", () => {
    const id = enqueue(1);
    const fail = () =>
      failJob(ctx, { job: claim("a"), owner: "a", kind: flaky, error: "boom", schedules: [] });
    expect(fail()).toBe("retry");
    expect(jobs()[0]).toMatchObject({ status: "pending", run_at: "2026-09-27T00:00:01.000Z" });
    advance(1000);
    expect(fail()).toBe("retry");
    expect(jobs()[0]).toMatchObject({ run_at: "2026-09-27T00:00:03.000Z" });
    advance(2000);
    expect(fail()).toBe("dead");
    expect(jobs()[0]).toMatchObject({ status: "dead", attempts: 3, last_error: "boom" });

    expect(listReviewItems(ctx)).toEqual([
      expect.objectContaining({ kind: "job.dead", entityRef: `job:${id}`, personId: null }),
    ]);
    expect(db.prepare("SELECT count(*) FROM review_item").pluck().get()).toBe(1);
    expect(deadJobs(ctx)).toEqual([{ kind: "test-flaky", failedAt: "2026-09-27T00:00:03.000Z" }]);
  });

  it("counts jobs by status, through system.jobCounts", () => {
    const uow = createUnitOfWork(db);
    expect(uow.read((repos) => repos.jobs.countByStatus())).toEqual({
      pending: 0,
      running: 0,
      done: 0,
      dead: 0,
    });
    enqueue(1);
    enqueue(2);
    enqueue(3);
    completeJob(ctx, { job: claim("a"), owner: "a", schedules: [] });
    claim("b");
    expect(uow.read((repos) => repos.jobs.countByStatus())).toEqual({
      pending: 1,
      running: 1,
      done: 1,
      dead: 0,
    });
    expect(jobCounts(ctx)).toEqual({ pending: 1, running: 1, dead: 0 });
  });

  it("refuses repository calls after the transaction ended", () => {
    const tx = createUnitOfWork(db).transaction((repos) => repos);
    expect(() => tx.jobs.listDead(1)).toThrow(/outside its transaction/);
    expect(() => tx.jobs.countByStatus()).toThrow(/outside its transaction/);
    expect(() => tx.reviewItems.listOpenFor(ctx.viewer)).toThrow(/outside its transaction/);
  });
});
