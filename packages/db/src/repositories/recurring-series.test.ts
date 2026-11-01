import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Id, RecurringSeriesRow, Viewer } from "@pangolin/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "../migrate.ts";
import { type Db, openDatabase } from "../open.ts";
import { createUnitOfWork } from "../unit-of-work.ts";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-recurring-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recurring_series repository on SQLite", () => {
  it("enforces table constraints: direction, cadence, status, positive expected_cents", () => {
    const uow = createUnitOfWork(db);

    const personAId = "01J0000000000000000000000A" as Id<"Person">;
    const accountId = "01J0000000000000000000001A" as Id<"Account">;
    const payeeId = "01J000000000000000000000PA" as Id<"Payee">;

    db.prepare(
      "INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES (?, 'Partner A', '#000', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(personAId);

    db.prepare(
      "INSERT INTO institution (id, name, kind, created_at, updated_at) VALUES ('01J000000000000000000000IN', 'Bank', 'bank', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();

    db.prepare(
      "INSERT INTO account (id, name, type, currency, is_private, institution_id, created_at, updated_at) VALUES (?, 'Joint Account', 'transaction', 'AUD', 0, '01J000000000000000000000IN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(accountId);

    db.prepare(
      "INSERT INTO account_owner (account_id, person_id, share_bp, created_at, updated_at) VALUES (?, ?, 10000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(accountId, personAId);

    db.prepare(
      "INSERT INTO payee (id, name, created_at, updated_at) VALUES (?, 'Netflix', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(payeeId);

    // Valid insert
    const validRow: RecurringSeriesRow = {
      id: "01J000000000000000000000S1" as Id<"RecurringSeries">,
      accountId,
      payeeId,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 1999,
      toleranceBp: 1500,
      nextDueOn: "2026-04-15",
      status: "candidate",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    uow.transaction((tx) => {
      tx.recurringSeries.insert(validRow);
    });

    const viewer: Viewer = { kind: "person", personId: personAId };
    const read = uow.read((repos) => repos.recurringSeries.findById(viewer, validRow.id));
    expect(read).toEqual(validRow);

    // Negative expected_cents fails CHECK
    expect(() =>
      uow.transaction((tx) => {
        tx.recurringSeries.insert({
          ...validRow,
          id: "01J000000000000000000000S2" as Id<"RecurringSeries">,
          expectedCents: -500,
        });
      }),
    ).toThrow();

    // Invalid cadence fails CHECK
    expect(() =>
      uow.transaction((tx) => {
        tx.recurringSeries.insert({
          ...validRow,
          id: "01J000000000000000000000S3" as Id<"RecurringSeries">,
          cadence: "daily" as "weekly",
        });
      }),
    ).toThrow();
  });

  it("respects viewer visibility for private accounts (AD-3, AD-22)", () => {
    const uow = createUnitOfWork(db);

    const personAId = "01J0000000000000000000000A" as Id<"Person">;
    const personBId = "01J0000000000000000000000B" as Id<"Person">;
    const privAcctA = "01J0000000000000000000001A" as Id<"Account">;
    const payeeId = "01J000000000000000000000PA" as Id<"Payee">;

    db.prepare(
      "INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES (?, 'Partner A', '#000', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(personAId);
    db.prepare(
      "INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES (?, 'Partner B', '#111', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(personBId);

    db.prepare(
      "INSERT INTO institution (id, name, kind, created_at, updated_at) VALUES ('01J000000000000000000000IN', 'Bank', 'bank', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run();

    db.prepare(
      "INSERT INTO account (id, name, type, currency, is_private, institution_id, created_at, updated_at) VALUES (?, 'Private Account', 'transaction', 'AUD', 1, '01J000000000000000000000IN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(privAcctA);

    db.prepare(
      "INSERT INTO account_owner (account_id, person_id, share_bp, created_at, updated_at) VALUES (?, ?, 10000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(privAcctA, personAId);

    db.prepare(
      "INSERT INTO payee (id, name, created_at, updated_at) VALUES (?, 'Gym', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
    ).run(payeeId);

    uow.transaction((tx) => {
      tx.recurringSeries.insert({
        id: "01J000000000000000000000S1" as Id<"RecurringSeries">,
        accountId: privAcctA,
        payeeId,
        direction: "bill",
        cadence: "fortnightly",
        expectedCents: 4500,
        toleranceBp: 1500,
        nextDueOn: "2026-03-01",
        status: "candidate",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const viewerA: Viewer = { kind: "person", personId: personAId };
    const viewerB: Viewer = { kind: "person", personId: personBId };

    const seriesForA = uow.read((repos) => repos.recurringSeries.listVisible(viewerA));
    expect(seriesForA).toHaveLength(1);
    expect(seriesForA[0]?.expectedCents).toBe(4500);

    const seriesForB = uow.read((repos) => repos.recurringSeries.listVisible(viewerB));
    expect(seriesForB).toHaveLength(0);

    const findForB = uow.read((repos) =>
      repos.recurringSeries.findById(
        viewerB,
        "01J000000000000000000000S1" as Id<"RecurringSeries">,
      ),
    );
    expect(findForB).toBeUndefined();

    // Delete for account
    uow.transaction((tx) => {
      tx.recurringSeries.deleteForAccount(privAcctA);
    });
    expect(uow.read((repos) => repos.recurringSeries.listVisible(viewerA))).toHaveLength(0);
  });

  it("throws TypeError when viewer is undefined or omitted (AD-3)", () => {
    const uow = createUnitOfWork(db);
    const none = undefined as unknown as Viewer;

    expect(() =>
      uow.read((repos) =>
        repos.recurringSeries.findById(none, "01J000000000000000000000S1" as Id<"RecurringSeries">),
      ),
    ).toThrow(TypeError);

    expect(() => uow.read((repos) => repos.recurringSeries.listVisible(none))).toThrow(TypeError);
  });
});
