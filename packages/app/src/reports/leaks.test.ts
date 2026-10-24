import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import { createPayee } from "../classify/payees.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { hideTransactionName } from "../ledger/hide-name.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { leaks } from "./leaks.ts";

const clock = manualClock("2026-09-27T00:00:00Z");
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-leaks-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setupHousehold(uow: UnitOfWork) {
  registerTransactionNeedsReviewSync();
  const newId = sequentialIds();
  const ctxOf = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = ctxOf(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "A", colour: "#000000" });
  const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const asA = ctxOf(personViewer(a, clock.now()));
  const asB = ctxOf(personViewer(b, clock.now()));

  const accountId = createAccount(sys, {
    name: "Everyday",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [
      { personId: a, shareBp: 5000 },
      { personId: b, shareBp: 5000 },
    ],
  });

  return { ctxOf, sys, asA, asB, accountId, personA: a, personB: b };
}

describe("reports.leaks", () => {
  it("rejects invalid date ranges with Validation error", () => {
    const uow = createUnitOfWork(db);
    const { asA } = setupHousehold(uow);

    expect(() => leaks(asA, { from: "2026-10-01", to: "2026-09-01" })).toThrow(AppError);
    expect(() => leaks(asA, { from: "not-a-date", to: "2026-09-30" })).toThrow(AppError);
  });

  it("returns qualifying merchants with >= 4 txns and median <= $25", () => {
    const uow = createUnitOfWork(db);
    const { asA, accountId } = setupHousehold(uow);

    const cafe = createPayee(asA, { name: "Corner Cafe" });
    const bakery = createPayee(asA, { name: "Local Bakery" });
    const expensive = createPayee(asA, { name: "Steakhouse" });
    const few = createPayee(asA, { name: "Occasional Coffee" });

    // Corner Cafe: 4 txns ($10, $20, $20, $30) -> median $20, total $80
    createTransaction(asA, {
      accountId,
      postedOn: "2026-09-02",
      amountCents: -1000,
      description: "c1",
      payeeId: cafe.id,
    });
    createTransaction(asA, {
      accountId,
      postedOn: "2026-09-05",
      amountCents: -2000,
      description: "c2",
      payeeId: cafe.id,
    });
    createTransaction(asA, {
      accountId,
      postedOn: "2026-09-10",
      amountCents: -2000,
      description: "c3",
      payeeId: cafe.id,
    });
    createTransaction(asA, {
      accountId,
      postedOn: "2026-09-15",
      amountCents: -3000,
      description: "c4",
      payeeId: cafe.id,
    });

    // Local Bakery: 5 txns of $5 -> median $5, total $25
    for (let i = 1; i <= 5; i++) {
      createTransaction(asA, {
        accountId,
        postedOn: `2026-09-0${i}`,
        amountCents: -500,
        description: `b${i}`,
        payeeId: bakery.id,
      });
    }

    // Steakhouse: 5 txns of $35 -> median $35 > $25, excluded
    for (let i = 1; i <= 5; i++) {
      createTransaction(asA, {
        accountId,
        postedOn: `2026-09-1${i}`,
        amountCents: -3500,
        description: `s${i}`,
        payeeId: expensive.id,
      });
    }

    // Occasional Coffee: 3 txns of $4 -> count 3 < 4, excluded
    for (let i = 1; i <= 3; i++) {
      createTransaction(asA, {
        accountId,
        postedOn: `2026-09-2${i}`,
        amountCents: -400,
        description: `o${i}`,
        payeeId: few.id,
      });
    }

    const report = leaks(asA, SEPTEMBER);
    expect(report.from).toBe(SEPTEMBER.from);
    expect(report.to).toBe(SEPTEMBER.to);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toEqual({
      payeeId: cafe.id,
      payeeName: "Corner Cafe",
      count: 4,
      totalCents: 8000,
      medianCents: 2000,
    });
    expect(report.rows[1]).toEqual({
      payeeId: bakery.id,
      payeeName: "Local Bakery",
      count: 5,
      totalCents: 2500,
      medianCents: 500,
    });
  });

  it("never leaks hidden payees across partners", () => {
    const uow = createUnitOfWork(db);
    const { asA, asB, accountId } = setupHousehold(uow);

    const secretCafe = createPayee(asA, { name: "Secret Cafe" });
    for (let i = 1; i <= 4; i++) {
      const txnId = createTransaction(asA, {
        accountId,
        postedOn: `2026-09-0${i}`,
        amountCents: -600,
        description: `Coffee ${i}`,
        payeeId: secretCafe.id,
      });
      hideTransactionName(asA, { id: txnId, until: "2026-12-31" });
    }

    // Partner A sees Secret Cafe
    const reportA = leaks(asA, SEPTEMBER);
    expect(reportA.rows).toHaveLength(1);
    expect(reportA.rows[0]?.payeeName).toBe("Secret Cafe");

    // Partner B does not see Secret Cafe
    const reportB = leaks(asB, SEPTEMBER);
    expect(reportB.rows).toEqual([]);
  });

  it("returns empty rows when no merchants qualify", () => {
    const uow = createUnitOfWork(db);
    const { asA } = setupHousehold(uow);

    const report = leaks(asA, SEPTEMBER);
    expect(report.rows).toEqual([]);
  });

  it("caps results to top 5 merchants ordered by total spend descending", () => {
    const uow = createUnitOfWork(db);
    const { asA, accountId } = setupHousehold(uow);

    // Create 6 qualifying merchants (M1 to M6) with varying total spend (all count 4, median <= $25)
    for (let m = 1; m <= 6; m++) {
      const p = createPayee(asA, { name: `Merchant ${m}` });
      for (let i = 1; i <= 4; i++) {
        createTransaction(asA, {
          accountId,
          postedOn: `2026-09-0${i}`,
          amountCents: -(m * 100), // m=1: $4 total, m=6: $24 total
          description: `m${m}_${i}`,
          payeeId: p.id,
        });
      }
    }

    const report = leaks(asA, SEPTEMBER);
    expect(report.rows).toHaveLength(5);
    expect(report.rows.map((r) => r.payeeName)).toEqual([
      "Merchant 6",
      "Merchant 5",
      "Merchant 4",
      "Merchant 3",
      "Merchant 2",
    ]);
  });
});
