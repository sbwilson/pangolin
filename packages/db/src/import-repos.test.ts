import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccount, createIdGenerator, createPerson, personViewer } from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-10-20T12:00:00Z");

describe("SQLite Import Repositories & Dedupe", () => {
  let dir: string;
  let db: Db;
  let newId: ReturnType<typeof createIdGenerator>;
  let uow: ReturnType<typeof createUnitOfWork>;

  let alexPersonId: Id<"Person">;
  let samPersonId: Id<"Person">;
  let alexViewer: ReturnType<typeof personViewer>;
  let samViewer: ReturnType<typeof personViewer>;
  let sysViewer: ReturnType<typeof systemViewer>;

  let sharedAccountId: Id<"Account">;
  let alexPrivateAccountId: Id<"Account">;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-import-repos-"));
    db = openDatabase(join(dir, "test.sqlite"));
    migrate(db, loadMigrations(packageMigrationsDir));
    let ms = now.epochMilliseconds;
    newId = createIdGenerator({ now: () => ++ms, random: Math.random });
    uow = createUnitOfWork(db);

    const clock = {
      now: () => now,
      today: () => now.toZonedDateTimeISO("UTC").toPlainDate(),
    };

    sysViewer = systemViewer("cli:test");
    const sysCtx = { viewer: sysViewer, clock, newId, uow };

    alexPersonId = createPerson(sysCtx, { displayName: "Alex", colour: "#ff0000" });
    samPersonId = createPerson(sysCtx, { displayName: "Sam", colour: "#0000ff" });

    alexViewer = personViewer(alexPersonId, now);
    samViewer = personViewer(samPersonId, now);

    const alexCtx = { viewer: alexViewer, clock, newId, uow };

    sharedAccountId = createAccount(alexCtx, {
      name: "Shared Checking",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alexPersonId, shareBp: 10000 }],
    });

    alexPrivateAccountId = createAccount(alexCtx, {
      name: "Alex Private",
      type: "savings",
      currency: "AUD",
      isPrivate: true,
      owners: [{ personId: alexPersonId, shareBp: 10000 }],
    });
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("manages import batches with privacy enforcement", () => {
    const at = now.toString();
    const batchId1 = newId<"ImportBatch">();
    const batchId2 = newId<"ImportBatch">();

    uow.transaction((tx) => {
      tx.importBatches.insert({
        id: batchId1,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "sha256-shared-1",
        rowCount: 10,
        newCount: 8,
        dupCount: 2,
        status: "staged",
        createdAt: at,
        updatedAt: at,
      });

      tx.importBatches.insert({
        id: batchId2,
        accountId: alexPrivateAccountId,
        source: "commbank_ofx",
        fileSha256: "sha256-private-1",
        rowCount: 5,
        newCount: 5,
        dupCount: 0,
        status: "committed",
        createdAt: at,
        updatedAt: at,
      });
    });

    uow.read((repos) => {
      // Shared batch is visible to both
      expect(repos.importBatches.find(alexViewer, batchId1)).toBeDefined();
      expect(repos.importBatches.find(samViewer, batchId1)).toBeDefined();

      // Private batch is visible to Alex, hidden from Sam
      expect(repos.importBatches.find(alexViewer, batchId2)).toBeDefined();
      expect(repos.importBatches.find(samViewer, batchId2)).toBeUndefined();

      // Find by account and fileSha
      expect(
        repos.importBatches.findByAccountAndFileSha(alexViewer, sharedAccountId, "sha256-shared-1"),
      ).toBeDefined();
      expect(
        repos.importBatches.findByAccountAndFileSha(
          alexViewer,
          alexPrivateAccountId,
          "sha256-private-1",
        ),
      ).toBeDefined();
      expect(
        repos.importBatches.findByAccountAndFileSha(
          samViewer,
          alexPrivateAccountId,
          "sha256-private-1",
        ),
      ).toBeUndefined();

      // List visible
      expect(repos.importBatches.listVisible(alexViewer, alexPrivateAccountId)).toHaveLength(1);
      expect(repos.importBatches.listVisible(samViewer, alexPrivateAccountId)).toHaveLength(0);
    });

    // Update counts and status
    uow.transaction((tx) => {
      const updated = tx.importBatches.updateCountsAndStatus(
        batchId1,
        { status: "committed", newCount: 10, dupCount: 0 },
        at,
      );
      expect(updated).toBe(true);
    });

    uow.read((repos) => {
      const b = repos.importBatches.find(alexViewer, batchId1);
      expect(b?.status).toBe("committed");
      expect(b?.newCount).toBe(10);
      expect(b?.dupCount).toBe(0);
    });
  });

  it("manages import rows with visibility filtering and reason updates", () => {
    const at = now.toString();
    const batchId = newId<"ImportBatch">();
    const rowId1 = newId<"ImportRow">();
    const rowId2 = newId<"ImportRow">();

    uow.transaction((tx) => {
      tx.importBatches.insert({
        id: batchId,
        accountId: alexPrivateAccountId,
        source: "commbank_csv",
        fileSha256: "sha256-private-rows",
        rowCount: 2,
        newCount: 0,
        dupCount: 0,
        status: "staged",
        createdAt: at,
        updatedAt: at,
      });

      tx.importRows.insert({
        id: rowId1,
        batchId,
        rowNumber: 1,
        rawLine: "01/09/2024,-10.00,COFFEE,50.00",
        status: "staged",
        reason: null,
        pdfPage: null,
        createdAt: at,
        updatedAt: at,
      });

      tx.importRows.insertMany([
        {
          id: rowId2,
          batchId,
          rowNumber: 2,
          rawLine: "02/09/2024,-20.00,LUNCH,30.00",
          status: "staged",
          reason: null,
          pdfPage: null,
          createdAt: at,
          updatedAt: at,
        },
      ]);
    });

    // Check listForBatch visibility
    uow.read((repos) => {
      // Alex can see rows of private account batch
      const alexRows = repos.importRows.listForBatch(alexViewer, batchId);
      expect(alexRows).toHaveLength(2);
      expect(alexRows[0]?.rowNumber).toBe(1);
      expect(alexRows[1]?.rowNumber).toBe(2);

      // Sam cannot see rows of Alex's private account batch
      const samRows = repos.importRows.listForBatch(samViewer, batchId);
      expect(samRows).toHaveLength(0);

      // Single row find visibility
      expect(repos.importRows.find(alexViewer, rowId1)).toBeDefined();
      expect(repos.importRows.find(alexViewer, rowId1)?.rowNumber).toBe(1);
      expect(repos.importRows.find(samViewer, rowId1)).toBeUndefined();
    });

    // Update status and reason
    uow.transaction((tx) => {
      tx.importRows.updateStatus(rowId1, "committed", at);
      tx.importRows.updateStatus(rowId2, "discarded", at, "duplicate");
    });

    uow.read((repos) => {
      const rows = repos.importRows.listForBatch(alexViewer, batchId);
      expect(rows[0]?.status).toBe("committed");
      expect(rows[0]?.reason).toBeNull();
      expect(rows[1]?.status).toBe("discarded");
      expect(rows[1]?.reason).toBe("duplicate");
    });
  });

  it("performs listForDedupe with over 400 dates (chunked parameter binding)", () => {
    const at = now.toString();
    const txnId1 = newId<"Transaction">();
    const txnId2 = newId<"Transaction">();
    const splitId1 = newId<"Split">();
    const splitId2 = newId<"Split">();

    uow.transaction((tx) => {
      tx.transactions.insert(
        {
          id: txnId1,
          accountId: sharedAccountId,
          postedOn: "2024-01-01",
          amountCents: -1000,
          descriptionRaw: "Merchant 1",
          payeeId: null,
          status: "posted",
          externalId: "EXT001",
          fingerprint: "fp-001",
          fingerprintVersion: 1,
          importId: null,
          performedBy: null,
          transferGroupId: null,
          needsReview: false,
          isHidden: false,
          nameHiddenBy: null,
          nameHiddenUntil: null,
          notes: null,
          createdAt: at,
          updatedAt: at,
        },
        [
          {
            id: splitId1,
            transactionId: txnId1,
            amountCents: -1000,
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
            beneficiarySource: null,
            deductibleBpSource: null,
            createdAt: at,
            updatedAt: at,
          },
        ],
      );

      tx.transactions.insert(
        {
          id: txnId2,
          accountId: sharedAccountId,
          postedOn: "2025-05-01",
          amountCents: 2000,
          descriptionRaw: "Salary",
          payeeId: null,
          status: "posted",
          externalId: null,
          fingerprint: "fp-002",
          fingerprintVersion: 1,
          importId: null,
          performedBy: null,
          transferGroupId: null,
          needsReview: false,
          isHidden: false,
          nameHiddenBy: null,
          nameHiddenUntil: null,
          notes: null,
          createdAt: at,
          updatedAt: at,
        },
        [
          {
            id: splitId2,
            transactionId: txnId2,
            amountCents: 2000,
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
            beneficiarySource: null,
            deductibleBpSource: null,
            createdAt: at,
            updatedAt: at,
          },
        ],
      );
    });

    // Generate 500 dates spanning beyond SQLite's default parameter thresholds
    const dates: string[] = [];
    for (let day = 1; day <= 500; day++) {
      const d = String(day).padStart(4, "0");
      dates.push(`2024-01-01`); // include match
      dates.push(`2099-${d.slice(0, 2)}-${d.slice(2)}`);
    }

    uow.read((repos) => {
      const dedupeRows = repos.transactions.listForDedupe(sharedAccountId, dates);
      expect(dedupeRows.length).toBeGreaterThanOrEqual(1);
      expect(dedupeRows.some((r) => r.id === txnId1)).toBe(true);

      // Verify findByExternalId and findByFingerprint
      expect(repos.transactions.findByExternalId(sharedAccountId, "EXT001")).toEqual({
        id: txnId1,
      });
      expect(repos.transactions.findByExternalId(sharedAccountId, "NONEXISTENT")).toBeUndefined();

      expect(repos.transactions.findByFingerprint(sharedAccountId, "fp-002")).toEqual({
        id: txnId2,
      });
      expect(
        repos.transactions.findByFingerprint(sharedAccountId, "nonexistent-fp"),
      ).toBeUndefined();
    });
  });
});
