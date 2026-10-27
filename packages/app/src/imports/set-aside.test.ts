import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import type { LlmProvider, StructuredPrompt, StructuredResponse } from "../ports/llm-provider.ts";
import type { LlmProviderRow } from "../ports/unit-of-work.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";
import {
  confirmSetAsideProposal,
  discardSetAsideRow,
  fixSetAsideRow,
  IMPORT_SET_ASIDE_REVIEW,
  interpretSetAsideRows,
  type InterpretSetAsideRowsContext,
  listSetAsideRowsForBatch,
} from "./set-aside.ts";

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");
const clock = manualClock("2026-10-20T12:00:00.000Z");

function setup() {
  let ms = 1792400000000;
  const newId = createIdGenerator({
    now: () => ++ms,
    random: () => 0.5,
  });
  const uow = memoryUnitOfWork();

  const alexPersonId = newId<"Person">();
  const samPersonId = newId<"Person">();

  const alexViewer: Viewer = {
    kind: "person",
    personId: alexPersonId,
    authAt: now,
  };

  const samViewer: Viewer = {
    kind: "person",
    personId: samPersonId,
    authAt: now,
  };

  const sharedAccountId = newId<"Account">();
  const alexPrivateAccountId = newId<"Account">();
  const samPrivateAccountId = newId<"Account">();

  uow.state.people.push(
    {
      id: alexPersonId,
      userId: "user-alex",
      displayName: "Alex",
      colour: "#ff0000",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: samPersonId,
      userId: "user-sam",
      displayName: "Sam",
      colour: "#0000ff",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );

  // Shared account owned by both Alex and Sam
  uow.state.accounts.push({
    id: sharedAccountId,
    name: "Joint Everyday",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    institutionId: null,
    openedOn: "2024-01-01",
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  uow.state.accountOwners.push(
    {
      accountId: sharedAccountId,
      personId: alexPersonId,
      shareBp: 5000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      accountId: sharedAccountId,
      personId: samPersonId,
      shareBp: 5000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  // Alex private account
  uow.state.accounts.push({
    id: alexPrivateAccountId,
    name: "Alex Spending",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    institutionId: null,
    openedOn: "2024-01-01",
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  uow.state.accountOwners.push({
    accountId: alexPrivateAccountId,
    personId: alexPersonId,
    shareBp: 10000,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  // Sam private account
  uow.state.accounts.push({
    id: samPrivateAccountId,
    name: "Sam Spending",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    institutionId: null,
    openedOn: "2024-01-01",
    closedOn: null,
    isSavings: false,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });
  uow.state.accountOwners.push({
    accountId: samPrivateAccountId,
    personId: samPersonId,
    shareBp: 10000,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const alexCtx = {
    viewer: alexViewer,
    clock,
    newId,
    uow,
  };

  const samCtx = {
    viewer: samViewer,
    clock,
    newId,
    uow,
  };

  return {
    alexCtx,
    samCtx,
    alexViewer,
    samViewer,
    alexPersonId,
    samPersonId,
    sharedAccountId,
    alexPrivateAccountId,
    samPrivateAccountId,
    uow,
    newId,
  };
}

describe("set-aside rows management", () => {
  describe("listSetAsideRowsForBatch", () => {
    it("lists only set-aside rows for a batch", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 3,
        newCount: 1,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const row1Id = newId<"ImportRow">();
      const row2Id = newId<"ImportRow">();
      const row3Id = newId<"ImportRow">();

      uow.state.importRows.push(
        {
          id: row1Id,
          batchId,
          rowNumber: 1,
          rawLine: "row-1",
          status: "committed",
          reason: null,
          pdfPage: null,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
        {
          id: row2Id,
          batchId,
          rowNumber: 2,
          rawLine: "row-2-bad",
          status: "set_aside",
          reason: "Invalid date format",
          pdfPage: null,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
        {
          id: row3Id,
          batchId,
          rowNumber: 3,
          rawLine: "row-3-bad",
          status: "set_aside",
          reason: "Invalid amount",
          pdfPage: null,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
      );

      const rows = listSetAsideRowsForBatch(alexCtx, { batchId });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id)).toEqual([row2Id, row3Id]);
      expect(rows[0]?.reason).toBe("Invalid date format");
      expect(rows[1]?.reason).toBe("Invalid amount");
    });

    it("throws NotFound if batch does not exist", () => {
      const { alexCtx, newId } = setup();
      expect(() =>
        listSetAsideRowsForBatch(alexCtx, { batchId: newId<"ImportBatch">() }),
      ).toThrowError(AppError);
    });

    it("throws NotFound if batch belongs to an account hidden from viewer", () => {
      const { samCtx, alexPrivateAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: alexPrivateAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      // Sam cannot see Alex's private account
      expect(() => listSetAsideRowsForBatch(samCtx, { batchId })).toThrowError(AppError);
    });
  });

  describe("fixSetAsideRow", () => {
    it("commits fixed transaction to ledger with importId and increments batch newCount", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 2,
        newCount: 1,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 2,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Invalid amount",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const res = fixSetAsideRow(alexCtx, {
        rowId,
        postedOn: "2024-09-01",
        amountCents: -4500,
        description: "Fixed Supermarket purchase",
      });

      expect(res.transactionId).toBeDefined();

      // Transaction committed to ledger
      const txn = uow.state.transactions.find((t) => t.id === res.transactionId);
      expect(txn).toBeDefined();
      expect(txn?.accountId).toBe(sharedAccountId);
      expect(txn?.postedOn).toBe("2024-09-01");
      expect(txn?.amountCents).toBe(-4500);
      expect(txn?.descriptionRaw).toBe("Fixed Supermarket purchase");
      expect(txn?.importId).toBe(batchId);

      // Split beneficiary is shared for shared account
      const splits = uow.state.splits.filter((s) => s.transactionId === res.transactionId);
      expect(splits).toHaveLength(1);
      expect(splits[0]?.beneficiary).toBe("shared");
      expect(splits[0]?.categoryId).toBeNull();
      expect(splits[0]?.categorySource).toBeNull();
      expect(txn?.needsReview).toBe(true);

      // Unclassified review item raised
      const unclassifiedItem = uow.state.reviewItems.find(
        (r) => r.dedupeKey === `classify.unclassified:${res.transactionId}`,
      );
      expect(unclassifiedItem).toBeDefined();
      expect(unclassifiedItem?.kind).toBe("classify.unclassified");

      // import_row status updated to committed and reason cleared
      const updatedRow = uow.state.importRows.find((r) => r.id === rowId);
      expect(updatedRow?.status).toBe("committed");
      expect(updatedRow?.reason).toBeNull();

      // batch newCount incremented from 1 to 2
      const updatedBatch = uow.state.importBatches.find((b) => b.id === batchId);
      expect(updatedBatch?.newCount).toBe(2);
    });

    it("assigns split beneficiary to account owner for private account", () => {
      const { alexCtx, alexPrivateAccountId, alexPersonId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: alexPrivateAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Invalid date",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const res = fixSetAsideRow(alexCtx, {
        rowId,
        postedOn: "2024-09-05",
        amountCents: -1200,
        description: "Alex Private Lunch",
      });

      const splits = uow.state.splits.filter((s) => s.transactionId === res.transactionId);
      expect(splits).toHaveLength(1);
      expect(splits[0]?.beneficiary).toBe(alexPersonId);
    });

    it("applies classification cascade to fixed transaction and skips unclassified review item when rule matches", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();
      const catGroupId = newId<"CategoryGroup">();
      const catId = newId<"Category">();
      const ruleId = newId<"Rule">();

      uow.state.categoryGroups.push({
        id: catGroupId,
        name: "Transport",
        kind: "expense",
        sort: 1,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });
      uow.state.categories.push({
        id: catId,
        groupId: catGroupId,
        name: "Fuel",
        isFixedCost: false,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.rules.push({
        id: ruleId,
        name: "Fuel Rule",
        priority: 10,
        conditions: JSON.stringify({
          descriptionPattern: "BP CONNECT",
          descriptionMatchKind: "contains",
        }),
        actions: JSON.stringify({ categoryId: catId }),
        origin: "user",
        scopePersonId: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Invalid date",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const res = fixSetAsideRow(alexCtx, {
        rowId,
        postedOn: "2024-09-05",
        amountCents: -7500,
        description: "BP CONNECT ROZELLE",
      });

      const txn = uow.state.transactions.find((t) => t.id === res.transactionId);
      expect(txn?.needsReview).toBe(false);

      const splits = uow.state.splits.filter((s) => s.transactionId === res.transactionId);
      expect(splits).toHaveLength(1);
      expect(splits[0]?.categoryId).toBe(catId);
      expect(splits[0]?.categorySource).toBe("rule");

      // No unclassified review item raised
      const unclassifiedItem = uow.state.reviewItems.find(
        (r) => r.dedupeKey === `classify.unclassified:${res.transactionId}`,
      );
      expect(unclassifiedItem).toBeUndefined();
    });

    it("throws Conflict if externalId already exists on a transaction in the account", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.transactions.push({
        id: newId<"Transaction">(),
        accountId: sharedAccountId,
        postedOn: "2024-09-01",
        amountCents: -1000,
        descriptionRaw: "Existing external txn",
        payeeId: null,
        status: "posted",
        externalId: "ext-12345",
        fingerprint: "dummy-fp",
        fingerprintVersion: 1,
        importId: null,
        performedBy: null,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Invalid amount",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      expect(() =>
        fixSetAsideRow(alexCtx, {
          rowId,
          postedOn: "2024-09-02",
          amountCents: -1000,
          description: "Fixed with existing externalId",
          externalId: "ext-12345",
        }),
      ).toThrowError(AppError);

      try {
        fixSetAsideRow(alexCtx, {
          rowId,
          postedOn: "2024-09-02",
          amountCents: -1000,
          description: "Fixed with existing externalId",
          externalId: "ext-12345",
        });
      } catch (err) {
        expect((err as AppError).code).toBe("Conflict");
      }
    });

    it("throws NotFound if row is in private account invisible to viewer", () => {
      const { samCtx, alexPrivateAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: alexPrivateAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Invalid date",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      expect(() =>
        fixSetAsideRow(samCtx, {
          rowId,
          postedOn: "2024-09-05",
          amountCents: -1200,
          description: "Unauthorized Fix Attempt",
        }),
      ).toThrowError(AppError);
    });

    it("throws Validation if row status is not set_aside", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 1,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "row-line",
        status: "committed",
        reason: null,
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      expect(() =>
        fixSetAsideRow(alexCtx, {
          rowId,
          postedOn: "2024-09-05",
          amountCents: -1200,
          description: "Attempt to fix already committed row",
        }),
      ).toThrowError(AppError);
    });
  });

  describe("discardSetAsideRow", () => {
    it("marks row as discarded without creating a ledger transaction", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Unparseable junk",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      const res = discardSetAsideRow(alexCtx, {
        rowId,
        reason: "Duplicate or corrupt row",
      });

      expect(res.rowId).toBe(rowId);

      const row = uow.state.importRows.find((r) => r.id === rowId);
      expect(row?.status).toBe("discarded");
      expect(row?.reason).toBe("Duplicate or corrupt row");

      // No ledger transaction created
      expect(uow.state.transactions).toHaveLength(0);

      // Batch counts remain unchanged
      const batch = uow.state.importBatches.find((b) => b.id === batchId);
      expect(batch?.newCount).toBe(0);
    });

    it("preserves existing row reason when parsed.reason is undefined", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Original parser error",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      discardSetAsideRow(alexCtx, { rowId });

      const row = uow.state.importRows.find((r) => r.id === rowId);
      expect(row?.status).toBe("discarded");
      expect(row?.reason).toBe("Original parser error");
    });

    it("throws NotFound if row belongs to private account invisible to viewer", () => {
      const { samCtx, alexPrivateAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: alexPrivateAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "set_aside",
        reason: "Unparseable junk",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      expect(() => discardSetAsideRow(samCtx, { rowId })).toThrowError(AppError);
    });

    it("throws Validation if row status is not set_aside", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row-line",
        status: "discarded",
        reason: "Already discarded",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      expect(() => discardSetAsideRow(alexCtx, { rowId })).toThrowError(AppError);
    });
  });

  describe("auto-resolution of import.set_aside review item", () => {
    it("auto-resolves review item when a single set-aside row is fixed", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "bad-row",
        status: "set_aside",
        reason: "Bad date",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.reviewItems.push({
        id: newId<"ReviewItem">(),
        kind: IMPORT_SET_ASIDE_REVIEW.kind,
        accountId: sharedAccountId,
        personId: null,
        entityRef: `import_batch:${batchId}`,
        dedupeKey: `import.set_aside:${batchId}`,
        createdAt: now.toString(),
        resolvedAt: null,
        resolution: null,
      });

      fixSetAsideRow(alexCtx, {
        rowId,
        postedOn: "2024-09-10",
        amountCents: -1500,
        description: "Fixed Coffee",
      });

      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${batchId}`,
      );
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.resolvedAt).not.toBeNull();
      expect(reviewItem?.resolution).toBe("all rows resolved");
    });

    it("auto-resolves review item when a single set-aside row is discarded", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const rowId = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 1,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push({
        id: rowId,
        batchId,
        rowNumber: 1,
        rawLine: "corrupt-row",
        status: "set_aside",
        reason: "Corrupt bytes",
        pdfPage: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.reviewItems.push({
        id: newId<"ReviewItem">(),
        kind: IMPORT_SET_ASIDE_REVIEW.kind,
        accountId: sharedAccountId,
        personId: null,
        entityRef: `import_batch:${batchId}`,
        dedupeKey: `import.set_aside:${batchId}`,
        createdAt: now.toString(),
        resolvedAt: null,
        resolution: null,
      });

      discardSetAsideRow(alexCtx, { rowId, reason: "Corrupt row" });

      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${batchId}`,
      );
      expect(reviewItem?.resolvedAt).not.toBeNull();
      expect(reviewItem?.resolution).toBe("all rows resolved");
    });

    it("keeps review item open until the last set-aside row is resolved", () => {
      const { alexCtx, sharedAccountId, uow, newId } = setup();
      const batchId = newId<"ImportBatch">();
      const row1Id = newId<"ImportRow">();
      const row2Id = newId<"ImportRow">();

      uow.state.importBatches.push({
        id: batchId,
        accountId: sharedAccountId,
        source: "commbank_csv",
        fileSha256: "dummy-sha",
        rowCount: 2,
        newCount: 0,
        dupCount: 0,
        status: "committed",
        importedByPersonId: null,
        undoneAt: null,
        reconcileStatus: null,
        reconcileGapCents: null,
        openingBalanceCents: null,
        closingBalanceCents: null,
        firstPostedOn: null,
        lastPostedOn: null,
        createdAt: now.toString(),
        updatedAt: now.toString(),
      });

      uow.state.importRows.push(
        {
          id: row1Id,
          batchId,
          rowNumber: 1,
          rawLine: "row-1",
          status: "set_aside",
          reason: "Bad date",
          pdfPage: null,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
        {
          id: row2Id,
          batchId,
          rowNumber: 2,
          rawLine: "row-2",
          status: "set_aside",
          reason: "Bad amount",
          pdfPage: null,
          createdAt: now.toString(),
          updatedAt: now.toString(),
        },
      );

      uow.state.reviewItems.push({
        id: newId<"ReviewItem">(),
        kind: IMPORT_SET_ASIDE_REVIEW.kind,
        accountId: sharedAccountId,
        personId: null,
        entityRef: `import_batch:${batchId}`,
        dedupeKey: `import.set_aside:${batchId}`,
        createdAt: now.toString(),
        resolvedAt: null,
        resolution: null,
      });

      // 1. Fix row 1 -> review item should remain open
      fixSetAsideRow(alexCtx, {
        rowId: row1Id,
        postedOn: "2024-09-01",
        amountCents: -2000,
        description: "Fixed Row 1",
      });

      const reviewItemAfterFirst = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${batchId}`,
      );
      expect(reviewItemAfterFirst?.resolvedAt).toBeNull();

      // 2. Discard row 2 -> review item should now be resolved
      discardSetAsideRow(alexCtx, {
        rowId: row2Id,
        reason: "Irrelevant Row 2",
      });

      const reviewItemAfterSecond = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${batchId}`,
      );
      expect(reviewItemAfterSecond?.resolvedAt).not.toBeNull();
      expect(reviewItemAfterSecond?.resolution).toBe("all rows resolved");
    });
  });

  describe("end-to-end import to set-aside resolution workflow", () => {
    it("handles partial import, listing, fixing one row, and discarding another", () => {
      const { alexCtx, sharedAccountId, uow } = setup();

      const csvContent = `01/09/2024,-10.00,Valid Row 1
bad-date,-20.00,Row 2 Bad Date
03/09/2024,invalid-amount,Row 3 Bad Amount`;

      // 1. Partial import
      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      expect(importRes.rowCount).toBe(3);
      expect(importRes.newCount).toBe(1);
      expect(importRes.setAsideCount).toBe(2);

      // Review item raised
      const reviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${importRes.batchId}`,
      );
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.resolvedAt).toBeNull();

      // 2. List set-aside rows
      const setAsideRows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      expect(setAsideRows).toHaveLength(2);
      const badDateRow = setAsideRows[0];
      const badAmountRow = setAsideRows[1];
      if (!badDateRow || !badAmountRow) {
        throw new Error("Expected 2 set-aside rows");
      }

      // 3. Fix row 2
      const fixRes = fixSetAsideRow(alexCtx, {
        rowId: badDateRow.id,
        postedOn: "2024-09-02",
        amountCents: -2000,
        description: "Row 2 Bad Date (Corrected)",
      });
      expect(fixRes.transactionId).toBeDefined();

      // Ledger now has 2 transactions
      expect(uow.state.transactions).toHaveLength(2);

      // Review item still open
      expect(reviewItem?.resolvedAt).toBeNull();

      // 4. Discard row 3
      discardSetAsideRow(alexCtx, {
        rowId: badAmountRow.id,
        reason: "Row 3 cannot be corrected",
      });

      // Review item auto-resolved
      const resolvedReviewItem = uow.state.reviewItems.find(
        (ri) => ri.dedupeKey === `import.set_aside:${importRes.batchId}`,
      );
      expect(resolvedReviewItem?.resolvedAt).not.toBeNull();
      expect(resolvedReviewItem?.resolution).toBe("all rows resolved");

      // Set aside list is now empty
      const remainingRows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      expect(remainingRows).toHaveLength(0);
    });
  });

  describe("row_interpret and proposal confirmation flow (AD-6)", () => {
    function createMockProvider(data: unknown): LlmProvider {
      return {
        generateStructured: async <T>(_prompt: StructuredPrompt<T>): Promise<StructuredResponse<T>> => ({
          data: data as T,
          raw: JSON.stringify(data),
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
          model: "test-model",
        }),
      };
    }

    it("interprets set-aside rows with local provider and saves proposal in import_row", async () => {
      const { alexCtx, sharedAccountId, uow } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      expect(importRes.setAsideCount).toBe(1);
      const rows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      expect(rows).toHaveLength(1);
      const targetRow = rows[0]!;
      expect(targetRow.proposal).toBeNull();

      const mockProvider = createMockProvider({
        proposals: [
          {
            index: 0,
            rowId: targetRow.id,
            postedOn: "2026-09-30",
            amountCents: -3600,
            description: "BWS NEWTOWN",
            confidence: 0.95,
            explanation: "Adjusted 31 Sept to last day of month 30 Sept",
          },
        ],
      });

      const interpretCtx: InterpretSetAsideRowsContext = {
        ...alexCtx,
        provider: mockProvider,
        providerIsLocal: true,
      };

      const result = await interpretSetAsideRows(interpretCtx, {
        batchId: importRes.batchId,
      });

      expect(result.interpretedCount).toBe(1);
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]?.proposal.postedOn).toBe("2026-09-30");
      expect(result.proposals[0]?.proposal.amountCents).toBe(-3600);
      expect(result.proposals[0]?.proposal.description).toBe("BWS NEWTOWN");

      // Verify row proposal in UOW
      const updatedRow = uow.state.importRows.find((r) => r.id === targetRow.id);
      expect(updatedRow?.proposal).not.toBeNull();
      const parsed = JSON.parse(updatedRow!.proposal!);
      expect(parsed.postedOn).toBe("2026-09-30");
      expect(parsed.amountCents).toBe(-3600);
      expect(parsed.description).toBe("BWS NEWTOWN");
    });

    it("refuses to send private account rows to a cloud provider", async () => {
      const { alexCtx, alexPrivateAccountId } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-50.00,PRIVATE STORE",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: alexPrivateAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const mockProvider = createMockProvider({ proposals: [] });
      const interpretCtx: InterpretSetAsideRowsContext = {
        ...alexCtx,
        provider: mockProvider,
        providerIsLocal: false,
        providerCloudRows: true, // even with cloudRows opt-in, private account is strictly forbidden!
      };

      await expect(
        interpretSetAsideRows(interpretCtx, { batchId: importRes.batchId }),
      ).rejects.toThrowError(
        new AppError(
          "PermissionDenied",
          "Cannot send private account rows to a cloud LLM provider",
        ),
      );
    });

    it("refuses cloud provider without cloud_rows opt-in", async () => {
      const { alexCtx, sharedAccountId } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const mockProvider = createMockProvider({ proposals: [] });
      const interpretCtx: InterpretSetAsideRowsContext = {
        ...alexCtx,
        provider: mockProvider,
        providerIsLocal: false,
        providerCloudRows: false, // no opt-in
      };

      await expect(
        interpretSetAsideRows(interpretCtx, { batchId: importRes.batchId }),
      ).rejects.toThrowError(
        new AppError(
          "PermissionDenied",
          "Cloud provider not permitted for row interpretation without cloud_rows opt-in",
        ),
      );
    });

    it("permits cloud provider with cloud_rows opt-in on shared account", async () => {
      const { alexCtx, sharedAccountId } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const mockProvider = createMockProvider({
        proposals: [
          {
            index: 0,
            postedOn: "2026-09-30",
            amountCents: -3600,
            description: "BWS NEWTOWN",
          },
        ],
      });

      const interpretCtx: InterpretSetAsideRowsContext = {
        ...alexCtx,
        provider: mockProvider,
        providerIsLocal: false,
        providerCloudRows: true, // opt-in enabled
      };

      const result = await interpretSetAsideRows(interpretCtx, {
        batchId: importRes.batchId,
      });
      expect(result.interpretedCount).toBe(1);
    });

    it("interprets multiple set-aside rows in batch mapping proposals by index and rowId", async () => {
      const { alexCtx, sharedAccountId, uow } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
        "31/11/2026,-42.50,COLES EXPRESS",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const setAsideRows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      expect(setAsideRows).toHaveLength(2);
      const [row0, row1] = setAsideRows;

      const mockProvider = createMockProvider({
        proposals: [
          // row 0 mapped by rowId
          {
            rowId: row0.id,
            postedOn: "2026-09-30",
            amountCents: -3600,
            description: "BWS NEWTOWN",
            confidence: 0.95,
          },
          // duplicate proposal for row 0 (should be deduplicated)
          {
            rowId: row0.id,
            postedOn: "2026-09-30",
            amountCents: -3600,
            description: "BWS NEWTOWN DUPE",
            confidence: 0.5,
          },
          // row 1 mapped by index
          {
            index: 1,
            postedOn: "2026-11-30",
            amountCents: -4250,
            description: "COLES EXPRESS",
            confidence: 0.9,
          },
        ],
      });

      const interpretCtx: InterpretSetAsideRowsContext = {
        ...alexCtx,
        provider: mockProvider,
        providerIsLocal: true,
      };

      const result = await interpretSetAsideRows(interpretCtx, {
        batchId: importRes.batchId,
      });

      expect(result.interpretedCount).toBe(2);
      expect(result.proposals).toHaveLength(2);

      const updatedRow0 = uow.state.importRows.find((r) => r.id === row0.id);
      const updatedRow1 = uow.state.importRows.find((r) => r.id === row1.id);

      expect(updatedRow0?.proposal).not.toBeNull();
      const prop0 = JSON.parse(updatedRow0!.proposal!);
      expect(prop0.description).toBe("BWS NEWTOWN");
      expect(prop0.amountCents).toBe(-3600);
      expect(prop0.postedOn).toBe("2026-09-30");

      expect(updatedRow1?.proposal).not.toBeNull();
      const prop1 = JSON.parse(updatedRow1!.proposal!);
      expect(prop1.description).toBe("COLES EXPRESS");
      expect(prop1.amountCents).toBe(-4250);
      expect(prop1.postedOn).toBe("2026-11-30");
    });

    it("catches LLM malformed JSON or schema failure", async () => {
      const { alexCtx, sharedAccountId } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const failingProvider: LlmProvider = {
        generateStructured: async () => {
          throw new Error("Invalid JSON returned from model");
        },
      };

      const interpretCtx: InterpretSetAsideRowsContext = {
        ...alexCtx,
        provider: failingProvider,
        providerIsLocal: true,
      };

      await expect(
        interpretSetAsideRows(interpretCtx, { batchId: importRes.batchId }),
      ).rejects.toThrowError(AppError);
    });

    it("confirms proposal, committing transaction to ledger through original batch", async () => {
      const { alexCtx, sharedAccountId, uow } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const rows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      const targetRow = rows[0]!;

      const mockProvider = createMockProvider({
        proposals: [
          {
            index: 0,
            rowId: targetRow.id,
            postedOn: "2026-09-30",
            amountCents: -3600,
            description: "BWS NEWTOWN",
          },
        ],
      });

      await interpretSetAsideRows(
        { ...alexCtx, provider: mockProvider, providerIsLocal: true },
        { batchId: importRes.batchId },
      );

      // Confirm proposal
      const confirmRes = confirmSetAsideProposal(alexCtx, { rowId: targetRow.id });
      expect(confirmRes.transactionId).toBeDefined();

      // Transaction committed to ledger with batch id
      const txn = uow.state.transactions.find((t) => t.id === confirmRes.transactionId);
      expect(txn).toBeDefined();
      expect(txn?.postedOn).toBe("2026-09-30");
      expect(txn?.amountCents).toBe(-3600);
      expect(txn?.descriptionRaw).toBe("BWS NEWTOWN");
      expect(txn?.importId).toBe(importRes.batchId);

      // Row status is committed and reason cleared
      const row = uow.state.importRows.find((r) => r.id === targetRow.id);
      expect(row?.status).toBe("committed");
      expect(row?.reason).toBeNull();

      // Batch newCount incremented
      const batch = uow.state.importBatches.find((b) => b.id === importRes.batchId);
      expect(batch?.newCount).toBe(1);

      // Review item auto-resolved
      const ri = uow.state.reviewItems.find(
        (item) => item.dedupeKey === `import.set_aside:${importRes.batchId}`,
      );
      expect(ri?.resolvedAt).not.toBeNull();
      expect(ri?.resolution).toBe("all rows resolved");
    });

    it("throws Validation when confirming a row that is not set_aside", async () => {
      const { alexCtx, sharedAccountId, uow } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const rows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      const targetRow = rows[0]!;

      // Mark row as already discarded
      uow.state.importRows = uow.state.importRows.map((r) =>
        r.id === targetRow.id ? { ...r, status: "discarded", proposal: JSON.stringify({ postedOn: "2026-09-30", amountCents: -3600, description: "BWS" }) } : r,
      );

      expect(() =>
        confirmSetAsideProposal(alexCtx, { rowId: targetRow.id }),
      ).toThrowError(/Cannot confirm proposal for row with status "discarded"/);
    });

    it("discards row with proposal and resolves review item", async () => {
      const { alexCtx, sharedAccountId, uow } = setup();

      const csvContent = [
        "Date,Amount,Description",
        "31/09/2026,-36.00,BWS NEWTOWN",
      ].join("\n");

      const importRes = importStatement(alexCtx, {
        accountId: sharedAccountId,
        format: "commbank_csv",
        content: csvContent,
      });

      const rows = listSetAsideRowsForBatch(alexCtx, importRes.batchId);
      const targetRow = rows[0]!;

      const mockProvider = createMockProvider({
        proposals: [
          {
            index: 0,
            rowId: targetRow.id,
            postedOn: "2026-09-30",
            amountCents: -3600,
            description: "BWS NEWTOWN",
          },
        ],
      });

      await interpretSetAsideRows(
        { ...alexCtx, provider: mockProvider, providerIsLocal: true },
        { batchId: importRes.batchId },
      );

      discardSetAsideRow(alexCtx, { rowId: targetRow.id, reason: "User discarded" });

      const row = uow.state.importRows.find((r) => r.id === targetRow.id);
      expect(row?.status).toBe("discarded");

      const ri = uow.state.reviewItems.find(
        (item) => item.dedupeKey === `import.set_aside:${importRes.batchId}`,
      );
      expect(ri?.resolvedAt).not.toBeNull();
      expect(ri?.resolution).toBe("all rows resolved");
    });
  });
});
