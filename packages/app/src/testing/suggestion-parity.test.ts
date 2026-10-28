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
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AccountOwnerRow,
  AccountRow,
  CategoryGroupRow,
  CategoryRow,
  PersonRow,
  SplitRow,
  SuggestionRow,
  UnitOfWork,
} from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

/** `Viewer.authAt` is required by the type; these tests never read its value. */
const AUTH_AT = Temporal.Instant.from("2026-10-26T10:00:00Z");

describe("Suggestion repository parity (SQLite vs Memory)", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-suggestion-parity-"));
    db = openDatabase(join(dir, "test.sqlite"));
    migrate(db, loadMigrations(packageMigrationsDir));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function setupBaseline(uow: UnitOfWork) {
    const personId = "01HNZX8JGFACFA36RBXDHEQN01" as Id<"Person">;
    const publicAccountId = "01HNZX8JGFACFA36RBXDHEQN02" as Id<"Account">;
    const privateAccountId = "01HNZX8JGFACFA36RBXDHEQN03" as Id<"Account">;
    const catId = "01HNZX8JGFACFA36RBXDHEQN04" as Id<"Category">;
    const groupId = "01HNZX8JGFACFA36RBXDHEQN05" as Id<"CategoryGroup">;

    uow.transaction((tx) => {
      tx.person.insert({
        id: personId,
        userId: "user-1",
        displayName: "Test User",
        colour: "#123456",
        createdAt: "2026-10-26T10:00:00Z",
        updatedAt: "2026-10-26T10:00:00Z",
        deletedAt: null,
      } as PersonRow);

      tx.categoryGroups.insert({
        id: groupId,
        name: "Food",
        kind: "expense",
        sort: 1,
        createdAt: "2026-10-26T10:00:00Z",
        updatedAt: "2026-10-26T10:00:00Z",
      } as CategoryGroupRow);

      tx.categories.insert({
        id: catId,
        groupId,
        name: "Groceries",
        isFixedCost: false,
        createdAt: "2026-10-26T10:00:00Z",
        updatedAt: "2026-10-26T10:00:00Z",
      } as CategoryRow);

      tx.accounts.insert(
        {
          id: publicAccountId,
          name: "Joint Account",
          type: "transaction",
          currency: "AUD",
          isPrivate: false,
          isSavings: false,
          institutionId: null,
          openedOn: null,
          closedOn: null,
          createdAt: "2026-10-26T10:00:00Z",
          updatedAt: "2026-10-26T10:00:00Z",
          deletedAt: null,
        } as AccountRow,
        [
          {
            accountId: publicAccountId,
            personId,
            shareBp: 10000,
            createdAt: "2026-10-26T10:00:00Z",
            updatedAt: "2026-10-26T10:00:00Z",
          } as AccountOwnerRow,
        ],
      );

      tx.accounts.insert(
        {
          id: privateAccountId,
          name: "Private Account",
          type: "transaction",
          currency: "AUD",
          isPrivate: true,
          isSavings: false,
          institutionId: null,
          openedOn: null,
          closedOn: null,
          createdAt: "2026-10-26T10:00:00Z",
          updatedAt: "2026-10-26T10:00:00Z",
          deletedAt: null,
        } as AccountRow,
        [
          {
            accountId: privateAccountId,
            personId,
            shareBp: 10000,
            createdAt: "2026-10-26T10:00:00Z",
            updatedAt: "2026-10-26T10:00:00Z",
          } as AccountOwnerRow,
        ],
      );
    });

    return { personId, publicAccountId, privateAccountId, catId };
  }

  it("produces identical suggestion lifecycle behavior across SQLite and Memory", () => {
    const memoryUow = memoryUnitOfWork();
    const sqliteUow = createUnitOfWork(db);

    const mem = setupBaseline(memoryUow);
    const sql = setupBaseline(sqliteUow);

    const txnId = "01HNZX8JGFACFA36RBXDHEQN10" as Id<"Transaction">;
    const splitId = "01HNZX8JGFACFA36RBXDHEQN11" as Id<"Split">;
    const suggestionId1 = "01HNZX8JGFACFA36RBXDHEQN12" as Id<"Suggestion">;

    // Insert transaction and split
    const addTxn = (uow: UnitOfWork, base: typeof mem) => {
      uow.transaction((tx) => {
        tx.transactions.insert(
          {
            id: txnId,
            accountId: base.publicAccountId,
            postedOn: "2026-10-26",
            amountCents: -5400,
            descriptionRaw: "Coles Supermarkets",
            fingerprint: "fp-coles",
            fingerprintVersion: 1,
            status: "posted",
            externalId: null,
            importId: null,
            isHidden: false,
            performedBy: null,
            payeeId: null,
            notes: null,
            nameHiddenUntil: null,
            nameHiddenBy: null,
            transferGroupId: null,
            needsReview: true,
            createdAt: "2026-10-26T10:00:00Z",
            updatedAt: "2026-10-26T10:00:00Z",
          },
          [
            {
              id: splitId,
              transactionId: txnId,
              amountCents: -5400,
              categoryId: null,
              activityId: null,
              beneficiary: "shared",
              propertyId: null,
              taxCategoryId: null,
              deductibleBp: null,
              memo: null,
              categorySource: null,
              activitySource: null,
              taxCategorySource: null,
              beneficiarySource: "user",
              deductibleBpSource: null,
              createdAt: "2026-10-26T10:00:00Z",
              updatedAt: "2026-10-26T10:00:00Z",
            } as SplitRow,
          ],
        );
      });
    };

    addTxn(memoryUow, mem);
    addTxn(sqliteUow, sql);

    const suggestion1: SuggestionRow = {
      id: suggestionId1,
      accountId: mem.publicAccountId,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: mem.catId,
      payeeName: "Coles",
      websiteDomain: "coles.com.au",
      taxCategoryId: null,
      activityId: null,
      confidence: 0.92,
      model: "gpt-4o",
      promptVersion: "2026-10-26.1",
      outcome: "open",
      createdAt: "2026-10-26T10:05:00Z",
      resolvedAt: null,
    };

    // Insert suggestion in both
    memoryUow.transaction((tx) => tx.suggestions.insert(suggestion1));
    sqliteUow.transaction((tx) => tx.suggestions.insert(suggestion1));

    // Check findOpenForSplit
    const memOpen = memoryUow.read((r) => r.suggestions.findOpenForSplit(splitId, "category"));
    const sqlOpen = sqliteUow.read((r) => r.suggestions.findOpenForSplit(splitId, "category"));
    expect(memOpen).toEqual(sqlOpen);
    expect(memOpen?.suggestedValue).toBe(mem.catId);
    expect(memOpen?.outcome).toBe("open");

    // Partial unique index constraint: inserting a second open suggestion for same split and field fails
    const suggestion2: SuggestionRow = {
      ...suggestion1,
      id: "01HNZX8JGFACFA36RBXDHEQN13" as Id<"Suggestion">,
    };
    expect(() => memoryUow.transaction((tx) => tx.suggestions.insert(suggestion2))).toThrow();
    expect(() => sqliteUow.transaction((tx) => tx.suggestions.insert(suggestion2))).toThrow();

    // Resolve open suggestion as accepted
    memoryUow.transaction((tx) =>
      tx.suggestions.resolveOpen(splitId, "category", "accepted", "2026-10-26T10:10:00Z"),
    );
    sqliteUow.transaction((tx) =>
      tx.suggestions.resolveOpen(splitId, "category", "accepted", "2026-10-26T10:10:00Z"),
    );

    // Verify open is now undefined in both
    expect(
      memoryUow.read((r) => r.suggestions.findOpenForSplit(splitId, "category")),
    ).toBeUndefined();
    expect(
      sqliteUow.read((r) => r.suggestions.findOpenForSplit(splitId, "category")),
    ).toBeUndefined();

    // Verify transaction history in both
    const viewer: Viewer = { kind: "person", personId: mem.personId, authAt: AUTH_AT };
    const memTxnList = memoryUow.read((r) => r.suggestions.listForTransaction(viewer, txnId));
    const sqlTxnList = sqliteUow.read((r) => r.suggestions.listForTransaction(viewer, txnId));
    expect(memTxnList).toHaveLength(1);
    expect(sqlTxnList).toHaveLength(1);
    expect(memTxnList[0]?.outcome).toBe("accepted");
    expect(sqlTxnList[0]?.outcome).toBe("accepted");
    expect(memTxnList[0]?.resolvedAt).toBe("2026-10-26T10:10:00Z");
    expect(sqlTxnList[0]?.resolvedAt).toBe("2026-10-26T10:10:00Z");
  });

  it("findFewShot returns matching public transactions from txn_fts and excludes private accounts", () => {
    const memoryUow = memoryUnitOfWork();
    const sqliteUow = createUnitOfWork(db);

    const mem = setupBaseline(memoryUow);
    const sql = setupBaseline(sqliteUow);

    const publicTxnId = "01HNZX8JGFACFA36RBXDHEQN20" as Id<"Transaction">;
    const publicSplitId = "01HNZX8JGFACFA36RBXDHEQN21" as Id<"Split">;
    const privateTxnId = "01HNZX8JGFACFA36RBXDHEQN22" as Id<"Transaction">;
    const privateSplitId = "01HNZX8JGFACFA36RBXDHEQN23" as Id<"Split">;

    const seedTxns = (uow: UnitOfWork, base: typeof mem) => {
      uow.transaction((tx) => {
        // Public transaction matching Woolworths
        tx.transactions.insert(
          {
            id: publicTxnId,
            accountId: base.publicAccountId,
            postedOn: "2026-10-25",
            amountCents: -3500,
            descriptionRaw: "Woolworths Surry Hills",
            fingerprint: "fp-woolworths-pub",
            fingerprintVersion: 1,
            status: "posted",
            externalId: null,
            importId: null,
            isHidden: false,
            performedBy: null,
            payeeId: null,
            notes: null,
            nameHiddenUntil: null,
            nameHiddenBy: null,
            transferGroupId: null,
            needsReview: false,
            createdAt: "2026-10-25T10:00:00Z",
            updatedAt: "2026-10-25T10:00:00Z",
          },
          [
            {
              id: publicSplitId,
              transactionId: publicTxnId,
              amountCents: -3500,
              categoryId: base.catId,
              activityId: null,
              beneficiary: "shared",
              propertyId: null,
              taxCategoryId: null,
              deductibleBp: null,
              memo: null,
              categorySource: "user",
              activitySource: null,
              taxCategorySource: null,
              beneficiarySource: "user",
              deductibleBpSource: null,
              createdAt: "2026-10-25T10:00:00Z",
              updatedAt: "2026-10-25T10:00:00Z",
            } as SplitRow,
          ],
        );

        // Private transaction matching Woolworths
        tx.transactions.insert(
          {
            id: privateTxnId,
            accountId: base.privateAccountId,
            postedOn: "2026-10-25",
            amountCents: -1200,
            descriptionRaw: "Woolworths Metro",
            fingerprint: "fp-woolworths-priv",
            fingerprintVersion: 1,
            status: "posted",
            externalId: null,
            importId: null,
            isHidden: false,
            performedBy: null,
            payeeId: null,
            notes: null,
            nameHiddenUntil: null,
            nameHiddenBy: null,
            transferGroupId: null,
            needsReview: false,
            createdAt: "2026-10-25T10:00:00Z",
            updatedAt: "2026-10-25T10:00:00Z",
          },
          [
            {
              id: privateSplitId,
              transactionId: privateTxnId,
              amountCents: -1200,
              categoryId: base.catId,
              activityId: null,
              beneficiary: "shared",
              propertyId: null,
              taxCategoryId: null,
              deductibleBp: null,
              memo: null,
              categorySource: "user",
              activitySource: null,
              taxCategorySource: null,
              beneficiarySource: "user",
              deductibleBpSource: null,
              createdAt: "2026-10-25T10:00:00Z",
              updatedAt: "2026-10-25T10:00:00Z",
            } as SplitRow,
          ],
        );
      });
    };

    seedTxns(memoryUow, mem);
    seedTxns(sqliteUow, sql);

    const viewer: Viewer = { kind: "person", personId: mem.personId, authAt: AUTH_AT };

    const sqlFewShot = sqliteUow.read((r) =>
      r.suggestions.findFewShot(viewer, "2026-10-26", "Woolworths"),
    );
    const memFewShot = memoryUow.read((r) =>
      r.suggestions.findFewShot(viewer, "2026-10-26", "Woolworths"),
    );

    // Both should return only the public account transaction
    expect(sqlFewShot).toHaveLength(1);
    expect(sqlFewShot[0]?.transactionId).toBe(publicTxnId);
    expect(sqlFewShot[0]?.description).toBe("Woolworths Surry Hills");
    expect(sqlFewShot[0]?.categoryId).toBe(sql.catId);
    expect(sqlFewShot[0]?.categoryName).toBe("Groceries");

    expect(memFewShot).toHaveLength(1);
    expect(memFewShot[0]?.transactionId).toBe(publicTxnId);
    expect(memFewShot[0]?.categoryId).toBe(mem.catId);
  });
});
