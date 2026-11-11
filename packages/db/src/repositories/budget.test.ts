import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BudgetRow, Id, Viewer } from "@pangolin/app";
import { personViewer } from "@pangolin/app";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "../migrate.ts";
import { type Db, openDatabase } from "../open.ts";
import { createUnitOfWork } from "../unit-of-work.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-budget-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("budget repository on SQLite", () => {
  it("enforces table constraints: STRICT, target exclusivity, positive limit, and valid cadence", () => {
    // Insert valid person and category
    db.prepare(
      "INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES ('P1', 'Person 1', '#000', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO category_group (id, name, kind, sort, created_at, updated_at) VALUES ('G1', 'Groceries Group', 'expense', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO category (id, group_id, name, is_fixed_cost, created_at, updated_at) VALUES ('C1', 'G1', 'Food', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();

    // Valid insert
    db.prepare(
      "INSERT INTO budget (id, person_id, category_id, cadence, limit_cents, rollover, created_at, updated_at) VALUES ('B1', 'P1', 'C1', 'fortnight', 50000, 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();

    // Fails if neither category_id nor category_group_id is set
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget (id, person_id, cadence, limit_cents, rollover, created_at, updated_at) VALUES ('B2', 'P1', 'fortnight', 50000, 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
        )
        .run(),
    ).toThrow();

    // Fails if BOTH category_id and category_group_id are set
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget (id, person_id, category_id, category_group_id, cadence, limit_cents, rollover, created_at, updated_at) VALUES ('B3', 'P1', 'C1', 'G1', 'fortnight', 50000, 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
        )
        .run(),
    ).toThrow();

    // Fails on non-positive limit
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget (id, person_id, category_id, cadence, limit_cents, rollover, created_at, updated_at) VALUES ('B4', 'P1', 'C1', 'fortnight', 0, 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
        )
        .run(),
    ).toThrow();

    // Fails on invalid cadence
    expect(() =>
      db
        .prepare(
          "INSERT INTO budget (id, person_id, category_id, cadence, limit_cents, rollover, created_at, updated_at) VALUES ('B5', 'P1', 'C1', 'yearly', 50000, 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
        )
        .run(),
    ).toThrow();
  });

  it("calculates spent summing only matching beneficiary and expense flowKind across visible accounts", () => {
    // Seed people
    db.prepare(
      "INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES ('P1', 'A', '#000', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES ('P2', 'B', '#111', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();

    // Seed category group and category
    db.prepare(
      "INSERT INTO category_group (id, name, kind, sort, created_at, updated_at) VALUES ('G1', 'Food', 'expense', 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO category (id, group_id, name, is_fixed_cost, created_at, updated_at) VALUES ('C1', 'G1', 'Groceries', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();

    // Seed institution & accounts: 1 joint, 1 personal P1, 1 private P2
    db.prepare(
      "INSERT INTO institution (id, name, kind, created_at, updated_at) VALUES ('I1', 'Bank', 'bank', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO account (id, name, type, currency, is_private, institution_id, opened_on, is_savings, created_at, updated_at) VALUES ('A_JOINT', 'Joint', 'transaction', 'AUD', 0, 'I1', '2026-01-01', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO account_owner (account_id, person_id, share_bp, created_at, updated_at) VALUES ('A_JOINT', 'P1', 5000, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO account_owner (account_id, person_id, share_bp, created_at, updated_at) VALUES ('A_JOINT', 'P2', 5000, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();

    db.prepare(
      "INSERT INTO account (id, name, type, currency, is_private, institution_id, opened_on, is_savings, created_at, updated_at) VALUES ('A_P1', 'Card P1', 'credit_card', 'AUD', 0, 'I1', '2026-01-01', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO account_owner (account_id, person_id, share_bp, created_at, updated_at) VALUES ('A_P1', 'P1', 10000, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    ).run();

    // Transactions in period [2026-10-01, 2026-10-15):
    // 1. Joint account: $50 expense, beneficiary = shared -> counts for shared budget
    db.prepare(
      "INSERT INTO `transaction` (id, account_id, posted_on, status, amount_cents, description_raw, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T1', 'A_JOINT', '2026-10-05', 'posted', -5000, 'Woolies', 'fp1', 1, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO split (id, transaction_id, amount_cents, category_id, beneficiary, created_at, updated_at) VALUES ('S1', 'T1', -5000, 'C1', 'shared', '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')",
    ).run();

    // 2. Personal P1 card: $30 expense, beneficiary = shared -> counts for shared budget!
    db.prepare(
      "INSERT INTO `transaction` (id, account_id, posted_on, status, amount_cents, description_raw, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T2', 'A_P1', '2026-10-06', 'posted', -3000, 'Coles', 'fp2', 1, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO split (id, transaction_id, amount_cents, category_id, beneficiary, created_at, updated_at) VALUES ('S2', 'T2', -3000, 'C1', 'shared', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')",
    ).run();

    // 3. Joint account: $20 expense, beneficiary = P1 -> personal split, does NOT count for shared budget
    db.prepare(
      "INSERT INTO `transaction` (id, account_id, posted_on, status, amount_cents, description_raw, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T3', 'A_JOINT', '2026-10-07', 'posted', -2000, 'Treat', 'fp3', 1, '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO split (id, transaction_id, amount_cents, category_id, beneficiary, created_at, updated_at) VALUES ('S3', 'T3', -2000, 'C1', 'P1', '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')",
    ).run();

    // 4. Joint account: income +$100 in same category -> does NOT count toward budget (flowKind = income)
    db.prepare(
      "INSERT INTO `transaction` (id, account_id, posted_on, status, amount_cents, description_raw, fingerprint, fingerprint_version, created_at, updated_at) VALUES ('T4', 'A_JOINT', '2026-10-08', 'posted', 10000, 'Refund', 'fp4', 1, '2026-10-08T00:00:00Z', '2026-10-08T00:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO split (id, transaction_id, amount_cents, category_id, beneficiary, created_at, updated_at) VALUES ('S4', 'T4', 10000, 'C1', 'shared', '2026-10-08T00:00:00Z', '2026-10-08T00:00:00Z')",
    ).run();

    const uow = createUnitOfWork(db);
    const authAt = Temporal.Instant.from("2026-10-08T00:00:00Z");
    const viewerP1: Viewer = personViewer("P1" as Id<"Person">, authAt);
    const viewerP2: Viewer = personViewer("P2" as Id<"Person">, authAt);

    const sharedBudgetRow: BudgetRow = {
      id: "B_SHARED" as Id<"Budget">,
      personId: null,
      categoryId: "C1" as Id<"Category">,
      categoryGroupId: null,
      fundingAccountId: null,
      cadence: "fortnight",
      limitCents: 60000,
      rollover: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    const personalBudgetP1Row: BudgetRow = {
      id: "B_P1" as Id<"Budget">,
      personId: "P1" as Id<"Person">,
      categoryId: "C1" as Id<"Category">,
      categoryGroupId: null,
      fundingAccountId: null,
      cadence: "fortnight",
      limitCents: 20000,
      rollover: false,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
    };

    uow.transaction((tx) => {
      tx.budgets.insert(sharedBudgetRow);
      tx.budgets.insert(personalBudgetP1Row);
    });

    uow.read((repos) => {
      // Shared budget spent should be 5000 + 3000 = 8000 cents ($80)
      const spentP1 = repos.budgets.calculateSpent(viewerP1, sharedBudgetRow, "2026-10-08", {
        start: "2026-10-01",
        end: "2026-10-15",
      });
      expect(spentP1).toBe(8000);

      // Both partners see identical spent for shared budget
      const spentP2 = repos.budgets.calculateSpent(viewerP2, sharedBudgetRow, "2026-10-08", {
        start: "2026-10-01",
        end: "2026-10-15",
      });
      expect(spentP2).toBe(8000);

      // Personal budget P1 spent should be 2000 cents ($20)
      const personalSpent = repos.budgets.calculateSpent(
        viewerP1,
        personalBudgetP1Row,
        "2026-10-08",
        {
          start: "2026-10-01",
          end: "2026-10-15",
        },
      );
      expect(personalSpent).toBe(2000);

      // Privacy: Viewer P2 querying personal budget of P1 receives 0
      const privacySpent = repos.budgets.calculateSpent(
        viewerP2,
        personalBudgetP1Row,
        "2026-10-08",
        {
          start: "2026-10-01",
          end: "2026-10-15",
        },
      );
      expect(privacySpent).toBe(0);

      // Privacy: Viewer P2 listing budgets does not see P1's budget
      const listP2 = repos.budgets.listVisible(viewerP2);
      expect(listP2.map((b) => b.id)).toEqual(["B_SHARED"]);
    });
  });
});
