// The daily closing-balance sync (finding Q1): scheduled at 00:05 household time whether or not a
// backup repository is configured, and idempotent on the day a closed date arrives.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Clock,
  closeAccount,
  createAccount,
  createIdGenerator,
  createPerson,
  createTransaction,
  fixedClockAt,
  getAccount,
  listReviewItems,
  systemClock,
  type UseCaseContext,
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BACKUP_CONFIG } from "../config.ts";
import { createJobs } from "./index.ts";
import { createRunner, type Runner } from "./runner.ts";

let dir: string;
let db: Db;
let now: ReturnType<Clock["now"]>;
let ms: number;
let ctx: UseCaseContext;
const clock: Clock = systemClock("UTC", () => now);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-closing-balance-jobs-"));
  db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = fixedClockAt("2026-09-27").now();
  ms = now.epochMilliseconds;
  ctx = {
    viewer: systemViewer("cli:test"),
    clock,
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The production registry with no backup repository: only the closing-balance sync is scheduled. */
function runner(timezone = "UTC", runnerClock: Clock = clock): Runner {
  const jobs = createJobs({
    timezone,
    dataDir: dir,
    backup: DEFAULT_BACKUP_CONFIG,
    migrationsDir: packageMigrationsDir,
  });
  return createRunner({
    uow: ctx.uow,
    clock: runnerClock,
    newId: ctx.newId,
    ...jobs,
    leaseMs: 60_000,
    log: () => {},
  });
}

const items = () => listReviewItems(ctx).filter((item) => item.kind === "accounts.closing-balance");
const auditCount = () => db.prepare("SELECT COUNT(*) FROM audit_log").pluck().get();
const syncJobs = () =>
  db
    .prepare("SELECT status, run_at FROM job WHERE kind = 'closing-balance-sync' ORDER BY run_at")
    .all();

describe("the closing-balance sync job", () => {
  it("is scheduled at 00:05 household time without a backup repository", () => {
    runner().ensureSchedules();
    expect(syncJobs()).toEqual([{ status: "pending", run_at: "2026-09-27T00:05:00.000Z" }]);
  });

  it("raises the item the day a closed date arrives, and a second run changes nothing", async () => {
    const pa = createPerson(ctx, { displayName: "A", colour: "#000000" });
    const id = createAccount(ctx, {
      name: "Acct",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: pa, shareBp: 10000 }],
    });
    createTransaction(ctx, {
      accountId: id,
      postedOn: "2026-09-01",
      amountCents: 4200,
      description: "x",
    });
    closeAccount(ctx, { id, closedOn: "2026-09-28" });
    expect(items()).toEqual([]);
    expect(getAccount(ctx, { id }).warning).toBeUndefined();

    const r = runner();
    r.ensureSchedules();
    // Before 00:05 on the 27th the job is not due.
    await r.tick();
    expect(items()).toEqual([]);

    now = fixedClockAt("2026-09-28").now().add({ minutes: 6 });
    await r.tick();
    expect(items()).toMatchObject([{ accountId: id, entityRef: `account:${id}` }]);
    expect(getAccount(ctx, { id }).warning).toEqual({
      kind: "closing-balance",
      balanceCents: 4200,
    });
    expect(
      db.prepare("SELECT actor FROM audit_log WHERE entity = 'review_item'").pluck().all(),
    ).toEqual(["job:closing-balance-sync"]);

    // The next day's run raises nothing more and writes no audit row.
    const before = auditCount();
    now = fixedClockAt("2026-09-29").now().add({ minutes: 6 });
    await r.tick();
    expect(items()).toHaveLength(1);
    expect(auditCount()).toBe(before);
    expect(syncJobs().filter((row) => (row as { status: string }).status === "done")).toHaveLength(
      2,
    );
  });

  it("raises the item on the run at 00:06 local when the household date is ahead of UTC", async () => {
    // Sydney moves to UTC+11 on 2026-10-04, so 00:06 on the 5th there is still the 4th in UTC.
    const sydney = systemClock("Australia/Sydney", () => now);
    const sydneyCtx: UseCaseContext = { ...ctx, clock: sydney };
    const pa = createPerson(ctx, { displayName: "A", colour: "#000000" });
    const id = createAccount(ctx, {
      name: "Acct",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: pa, shareBp: 10000 }],
    });
    createTransaction(ctx, {
      accountId: id,
      postedOn: "2026-09-01",
      amountCents: 4200,
      description: "x",
    });
    closeAccount(ctx, { id, closedOn: "2026-10-05" });

    now = fixedClockAt("2026-10-04").now().add({ hours: 12 });
    const r = runner("Australia/Sydney", sydney);
    r.ensureSchedules();
    expect(syncJobs()).toEqual([{ status: "pending", run_at: "2026-10-04T13:05:00.000Z" }]);
    await r.tick();
    expect(items()).toEqual([]);

    now = fixedClockAt("2026-10-04").now().add({ hours: 13, minutes: 6 });
    expect(now.toString().slice(0, 10)).toBe("2026-10-04");
    expect(sydney.today().toString()).toBe("2026-10-05");
    await r.tick();
    expect(items()).toMatchObject([{ accountId: id, entityRef: `account:${id}` }]);
    expect(getAccount(sydneyCtx, { id }).warning).toEqual({
      kind: "closing-balance",
      balanceCents: 4200,
    });
  });
});
