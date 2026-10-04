// The memory mirror answers balanceAsOf, shared-split checks and account views as SQLite does,
// through the accounts use cases. It sits beside the memory unit of work, which is not exported
// from the package: a test file here may import the adapter.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnitOfWork,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import {
  type AccountView,
  balanceAsOf as accountBalanceAsOf,
  createAccount,
  createIdGenerator,
  createPerson,
  createTransaction,
  deleteTransaction,
  getAccount,
  personViewer,
  recordBalanceSnapshot,
  setPrivacy,
  type UseCaseContext,
  updateAccount,
} from "../index.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

const own = (id: Id<"Person">) => [{ personId: id, shareBp: 10000 }];
const txn = (ctx: UseCaseContext, accountId: string, postedOn: string, amountCents: number) =>
  createTransaction(ctx, {
    accountId,
    postedOn,
    amountCents,
    description: `${postedOn} ${amountCents}`,
  });

describe("memory mirror parity", () => {
  it("answers balanceAsOf, shared-split and account views as SQLite does", () => {
    const dir = mkdtempSync(join(tmpdir(), "pangolin-accounts-parity-"));
    const db = openDatabase(join(dir, "test.sqlite"));
    migrate(db, loadMigrations(packageMigrationsDir));
    let ms = now.epochMilliseconds;
    const sqliteBase = {
      clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
      newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
      uow: createUnitOfWork(db),
    };
    const sys: UseCaseContext = { ...sqliteBase, viewer: systemViewer("cli:test") };
    const as = (id: Id<"Person">): UseCaseContext => ({
      ...sqliteBase,
      viewer: personViewer(id, now),
    });
    const a = createPerson(sys, { displayName: "A", colour: "#000000" });
    const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
    const run = (
      ctxs: { sys: UseCaseContext; as: (id: Id<"Person">) => UseCaseContext },
      pa: Id<"Person">,
      pb: Id<"Person">,
    ) => {
      const acct = createAccount(ctxs.sys, {
        name: "P",
        type: "savings",
        currency: "AUD",
        isPrivate: false,
        owners: [
          { personId: pa, shareBp: 6000 },
          { personId: pb, shareBp: 4000 },
        ],
      });
      const A = ctxs.as(pa);
      recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-01", balanceCents: 5000 });
      recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-10", balanceCents: 4000 });
      // Same day and created_at: the later ID wins.
      recordBalanceSnapshot(A, { accountId: acct, asOf: "2026-09-10", balanceCents: 4100 });
      txn(A, acct, "2026-09-01", -100);
      txn(A, acct, "2026-09-05", -200);
      txn(A, acct, "2026-09-12", 25);
      // A soft-deleted line no longer counts.
      deleteTransaction(A, { id: txn(A, acct, "2026-09-14", -999) });
      const balances = ["2026-08-01", "2026-09-01", "2026-09-05", "2026-09-10", "2026-09-30"].map(
        (date) => accountBalanceAsOf(A, { accountId: acct, date }),
      );
      const view: AccountView = getAccount(A, { id: acct });
      let conflict = "";
      try {
        updateAccount(A, { id: acct, owners: own(pa) });
        setPrivacy(A, { id: acct, isPrivate: true });
      } catch (error) {
        conflict = (error as { code: string }).code;
      }
      return { balances, pool: view.pool, owners: view.owners, conflict };
    };
    const sqlite = run({ sys, as }, a, b);

    const uow = memoryUnitOfWork();
    let n = 0;
    const base = {
      clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
      newId: (<B extends string>() =>
        `M${String(++n).padStart(6, "0")}` as Id<B>) as UseCaseContext["newId"],
      uow,
    };
    const msys: UseCaseContext = { ...base, viewer: systemViewer("cli:test") };
    const ma = createPerson(msys, { displayName: "A", colour: "#000000" });
    const mb = createPerson(msys, { displayName: "B", colour: "#ffffff" });
    const memory = run(
      { sys: msys, as: (id) => ({ ...base, viewer: personViewer(id, now) }) },
      ma,
      mb,
    );
    const norm = (r: typeof sqlite, x: Id<"Person">, y: Id<"Person">) =>
      JSON.parse(JSON.stringify(r).replaceAll(x, "PA").replaceAll(y, "PB"));
    expect(norm(memory, ma, mb)).toEqual(norm(sqlite, a, b));
    expect(sqlite.balances).toEqual([0, 5000, 4800, 4100, 4125]);
    expect(sqlite.conflict).toBe("Conflict");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
