import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { ImportBatchRow, ImportRowRow } from "../ports/unit-of-work.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import {
  correctPdfRow,
  listPdfRowsForBatch,
  pdfFailedDedupeKey,
  recheckPdfStatement,
} from "./pdf-review.ts";

const now = Temporal.Instant.from("2026-10-27T12:00:00.000Z");
const clock = manualClock("2026-10-27T12:00:00.000Z");

interface Fixture {
  ctx: UseCaseContext;
  accountId: Id<"Account">;
  batchId: Id<"ImportBatch">;
  rowIds: Id<"ImportRow">[];
  uow: ReturnType<typeof memoryUnitOfWork>;
}

function patchBatch(uow: Fixture["uow"], patch: Partial<ImportBatchRow>): void {
  uow.state.importBatches[0] = { ...uow.state.importBatches[0], ...patch } as ImportBatchRow;
}

function seedFailedPdfBatch(withReviewItem = true): Fixture {
  const uow = memoryUnitOfWork();
  let idCounter = 1;
  const newId = <T extends string>() => `id_${idCounter++}` as Id<T>;

  const personId = newId<"Person">();
  uow.state.people.push({
    id: personId,
    userId: null,
    displayName: "Alex",
    colour: "#000000",
    createdAt: now.toString(),
    updatedAt: now.toString(),
    deletedAt: null,
  });
  const viewer = personViewer(personId, now);

  const accountId = newId<"Account">();
  uow.state.accounts.push({
    id: accountId,
    name: "Everyday Checking",
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
  uow.state.accountOwners.push({
    accountId,
    personId,
    shareBp: 10000,
    createdAt: now.toString(),
    updatedAt: now.toString(),
  });

  const batchId = newId<"ImportBatch">();
  const reason = "Running balance mismatch at row 2: expected 147999 cents, printed 148000 cents";
  const batch: ImportBatchRow = {
    id: batchId,
    accountId,
    source: "statement_pdf",
    fileSha256: "a".repeat(64),
    rowCount: 3,
    newCount: 0,
    dupCount: 0,
    status: "failed",
    importedByPersonId: personId,
    undoneAt: null,
    reconcileStatus: "gap",
    reconcileGapCents: 1,
    openingBalanceCents: 100_000,
    closingBalanceCents: 158_000,
    firstPostedOn: "2024-09-02",
    lastPostedOn: "2024-09-20",
    attachmentId: null,
    statementMeta: JSON.stringify({
      startDate: "2024-09-01",
      endDate: "2024-09-30",
      accountNumberLast4: "1234",
    }),
    createdAt: now.toString(),
    updatedAt: now.toString(),
  };
  uow.state.importBatches.push(batch);

  const seeded: Array<{
    postedOn: string;
    description: string;
    amountCents: number;
    runningBalanceCents: number;
  }> = [
    {
      postedOn: "2024-09-02",
      description: "SALARY",
      amountCents: 50_000,
      runningBalanceCents: 150_000,
    },
    {
      postedOn: "2024-09-05",
      description: "WOOLWORTHS",
      amountCents: -2_001,
      runningBalanceCents: 148_000,
    },
    {
      postedOn: "2024-09-20",
      description: "PAYME",
      amountCents: 10_000,
      runningBalanceCents: 158_000,
    },
  ];
  const rowIds: Id<"ImportRow">[] = [];
  const rows: ImportRowRow[] = seeded.map((r, idx) => {
    rowIds.push(newId<"ImportRow">());
    return {
      id: rowIds[idx] as Id<"ImportRow">,
      batchId,
      rowNumber: idx + 1,
      rawLine: `${r.postedOn}, ${r.description}, ${r.amountCents}`,
      status: "staged",
      reason,
      proposal: JSON.stringify({
        postedOn: r.postedOn,
        amountCents: r.amountCents,
        description: r.description,
        runningBalanceCents: r.runningBalanceCents,
      }),
      pdfPage: 1,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    };
  });
  uow.state.importRows.push(...rows);

  if (withReviewItem) {
    uow.state.reviewItems.push({
      id: newId<"ReviewItem">(),
      kind: "import.pdf_failed",
      accountId,
      personId: null,
      entityRef: `import_batch:${batchId}`,
      dedupeKey: pdfFailedDedupeKey(batchId),
      createdAt: now.toString(),
      resolvedAt: null,
      resolution: null,
    });
  }

  return { ctx: { viewer, clock, newId, uow }, accountId, batchId, rowIds, uow };
}

describe("listPdfRowsForBatch", () => {
  it("lists the staged rows of a failed PDF batch", () => {
    const { ctx, batchId } = seedFailedPdfBatch();
    const rows = listPdfRowsForBatch(ctx, batchId);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.rowNumber).toBe(1);
    expect(rows[1]?.reason).toContain("Running balance mismatch at row 2");
    expect(rows[1]?.pdfPage).toBe(1);
  });

  it("returns nothing for a ready batch", () => {
    const { ctx, batchId, uow } = seedFailedPdfBatch();
    patchBatch(uow, { status: "ready" });
    expect(listPdfRowsForBatch(ctx, batchId)).toEqual([]);
  });

  it("throws NotFound for a batch the viewer cannot see", () => {
    const { ctx } = seedFailedPdfBatch();
    expect(() => listPdfRowsForBatch(ctx, "nope")).toThrowError(AppError);
    try {
      listPdfRowsForBatch(ctx, "nope");
    } catch (err) {
      expect((err as AppError).code).toBe("NotFound");
    }
  });
});

describe("correctPdfRow", () => {
  it("records a correction merged with the saved proposal and keeps the row staged", () => {
    const { ctx, rowIds, uow } = seedFailedPdfBatch();
    const rowId = rowIds[1] as Id<"ImportRow">;

    const result = correctPdfRow(ctx, { rowId, amountCents: -2_000 });

    expect(result.rowId).toBe(rowId);
    expect(result.proposal).toEqual({
      postedOn: "2024-09-05",
      amountCents: -2_000,
      description: "WOOLWORTHS",
      runningBalanceCents: 148_000,
    });

    const row = uow.state.importRows.find((r) => r.id === rowId);
    expect(row?.proposal).toContain("-2000");
    expect(row?.status).toBe("staged");
    expect(row?.reason).toContain("Running balance mismatch");
    expect(uow.state.audit.some((a) => a.entity === "import_row" && a.entityId === rowId)).toBe(
      true,
    );
  });

  it("falls back to the raw line when no proposal is stored", () => {
    const { ctx, rowIds, uow } = seedFailedPdfBatch();
    const rowId = rowIds[0] as Id<"ImportRow">;
    uow.state.importRows[0] = { ...uow.state.importRows[0], proposal: null } as ImportRowRow;

    const result = correctPdfRow(ctx, { rowId, description: "SALARY AC" });
    expect(result.proposal).toEqual({
      postedOn: "2024-09-02",
      amountCents: 50_000,
      description: "SALARY AC",
      runningBalanceCents: null,
    });
  });

  it("requires at least one field", () => {
    const { ctx, rowIds } = seedFailedPdfBatch();
    expect(() => correctPdfRow(ctx, { rowId: rowIds[0] as Id<"ImportRow"> })).toThrowError(
      AppError,
    );
    try {
      correctPdfRow(ctx, { rowId: rowIds[0] as Id<"ImportRow"> });
    } catch (err) {
      expect((err as AppError).code).toBe("Validation");
    }
  });

  it("refuses a row of a batch that is not failed", () => {
    const { ctx, rowIds, uow } = seedFailedPdfBatch();
    patchBatch(uow, { status: "ready" });
    try {
      correctPdfRow(ctx, { rowId: rowIds[0] as Id<"ImportRow">, amountCents: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe("Validation");
    }
  });

  it("throws NotFound for an unknown row", () => {
    const { ctx } = seedFailedPdfBatch();
    try {
      correctPdfRow(ctx, { rowId: "nope" as Id<"ImportRow">, amountCents: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe("NotFound");
    }
  });
});

describe("recheckPdfStatement", () => {
  it("returns the exact remaining error and changes nothing while a gap remains", () => {
    const { ctx, batchId, uow } = seedFailedPdfBatch();

    const result = recheckPdfStatement(ctx, { batchId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exact gap of 1 cents");

    const batch = uow.state.importBatches.find((b) => b.id === batchId);
    expect(batch?.status).toBe("failed");
    expect(batch?.reconcileStatus).toBe("gap");
    const item = uow.state.reviewItems.find((r) => r.dedupeKey === pdfFailedDedupeKey(batchId));
    expect(item?.resolvedAt).toBeNull();
  });

  it("passes after one correction: batch becomes ready, reasons clear, item resolves", () => {
    const { ctx, batchId, rowIds, uow } = seedFailedPdfBatch();
    correctPdfRow(ctx, { rowId: rowIds[1] as Id<"ImportRow">, amountCents: -2_000 });

    const result = recheckPdfStatement(ctx, { batchId });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.verification.gapCents).toBe(0);

    const batch = uow.state.importBatches.find((b) => b.id === batchId);
    expect(batch?.status).toBe("ready");
    expect(batch?.reconcileStatus).toBe("ok");
    expect(batch?.reconcileGapCents).toBe(0);
    expect(batch?.newCount).toBe(3);
    expect(batch?.firstPostedOn).toBe("2024-09-02");
    expect(batch?.lastPostedOn).toBe("2024-09-20");

    for (const row of uow.state.importRows.filter((r) => r.batchId === batchId)) {
      expect(row.reason).toBeNull();
    }

    const item = uow.state.reviewItems.find((r) => r.dedupeKey === pdfFailedDedupeKey(batchId));
    expect(item?.resolvedAt).not.toBeNull();
    expect(item?.resolution).toBe("verified on re-check");
  });

  it("re-checks LLM-free from the saved header (dates and last4)", () => {
    const { ctx, batchId, rowIds } = seedFailedPdfBatch();
    correctPdfRow(ctx, { rowId: rowIds[1] as Id<"ImportRow">, amountCents: -2_000 });
    // Move row 3 outside the saved statement period.
    correctPdfRow(ctx, { rowId: rowIds[2] as Id<"ImportRow">, postedOn: "2024-11-01" });

    const result = recheckPdfStatement(ctx, { batchId });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("2024-11-01");
    expect(result.error).toContain("statement period");
  });

  it("refuses a batch that has already been verified", () => {
    const { ctx, batchId, uow } = seedFailedPdfBatch();
    patchBatch(uow, { status: "ready" });
    try {
      recheckPdfStatement(ctx, { batchId });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe("Validation");
      expect((err as AppError).message).toContain("already been verified");
    }
  });

  it("refuses a non-PDF batch", () => {
    const { ctx, batchId, uow } = seedFailedPdfBatch();
    patchBatch(uow, { source: "csv" });
    try {
      recheckPdfStatement(ctx, { batchId });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe("Validation");
    }
  });

  it("throws NotFound for an unknown batch", () => {
    const { ctx } = seedFailedPdfBatch();
    try {
      recheckPdfStatement(ctx, { batchId: "nope" });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe("NotFound");
    }
  });
});
