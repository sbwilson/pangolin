import type { ImportBatchRepo, ImportBatchRow, ImportRowRepo, ImportRowRow } from "@pangolin/app";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { visibleAccountId } from "../privacy.ts";
import { importBatch } from "../schema/import-batch.ts";
import { importRow } from "../schema/import-row.ts";

type Orm = BetterSQLite3Database;

/** The `transaction` reads the batch repo needs, kept in `ledger-repos.ts` (AD-3, AD-4). */
export interface BatchTransactionReads {
  liveIds(batchId: string): string[];
  newestLivePostedOn(batchIds: readonly string[]): string | undefined;
}

export function createImportBatchRepo(
  orm: Orm,
  check: () => void,
  reads: BatchTransactionReads,
): ImportBatchRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(importBatch).values(row).run();
    },

    find: (viewer, id) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const row = orm
        .select()
        .from(importBatch)
        .where(and(eq(importBatch.id, id), visible))
        .get();
      return row as ImportBatchRow | undefined;
    },

    findByAccountAndFileSha: (viewer, accountId, fileSha256) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const row = orm
        .select()
        .from(importBatch)
        .where(
          and(
            eq(importBatch.accountId, accountId),
            eq(importBatch.fileSha256, fileSha256),
            visible,
          ),
        )
        .get();
      return row as ImportBatchRow | undefined;
    },

    updateCountsAndStatus: (id, changes, at) => {
      check();
      const result = orm
        .update(importBatch)
        .set({
          ...(changes.rowCount !== undefined ? { rowCount: changes.rowCount } : {}),
          ...(changes.newCount !== undefined ? { newCount: changes.newCount } : {}),
          ...(changes.dupCount !== undefined ? { dupCount: changes.dupCount } : {}),
          ...(changes.reconcileStatus !== undefined
            ? { reconcileStatus: changes.reconcileStatus }
            : {}),
          ...(changes.reconcileGapCents !== undefined
            ? { reconcileGapCents: changes.reconcileGapCents }
            : {}),
          ...(changes.firstPostedOn !== undefined ? { firstPostedOn: changes.firstPostedOn } : {}),
          ...(changes.lastPostedOn !== undefined ? { lastPostedOn: changes.lastPostedOn } : {}),
          status: changes.status,
          updatedAt: at,
        })
        .where(eq(importBatch.id, id))
        .run();
      return result.changes > 0;
    },

    listVisible: (viewer, accountId) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const rows = orm
        .select()
        .from(importBatch)
        .where(and(eq(importBatch.accountId, accountId), visible))
        .orderBy(desc(importBatch.createdAt))
        .all();
      return rows as ImportBatchRow[];
    },

    listCommittedForAccount: (viewer, accountId) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const rows = orm
        .select()
        .from(importBatch)
        .where(
          and(
            eq(importBatch.accountId, accountId),
            eq(importBatch.status, "committed"),
            isNull(importBatch.undoneAt),
            visible,
          ),
        )
        .orderBy(asc(importBatch.createdAt), asc(importBatch.id))
        .all();
      return rows as ImportBatchRow[];
    },

    markUndone: (id, at) => {
      check();
      return (
        orm
          .update(importBatch)
          .set({ undoneAt: at, updatedAt: at })
          .where(and(eq(importBatch.id, id), isNull(importBatch.undoneAt)))
          .run().changes > 0
      );
    },

    listLiveTransactionIds: (batchId) => {
      check();
      return reads.liveIds(batchId);
    },

    latestImportFor: (viewer, accountId) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const batches = orm
        .select()
        .from(importBatch)
        .where(
          and(
            eq(importBatch.accountId, accountId),
            eq(importBatch.status, "committed"),
            isNull(importBatch.undoneAt),
            visible,
          ),
        )
        .orderBy(desc(importBatch.createdAt), desc(importBatch.id))
        .all();
      const newest = batches[0];
      if (newest === undefined) return undefined;
      const through = reads.newestLivePostedOn(batches.map((b) => b.id));
      if (through === undefined) return undefined;
      return { through: through, source: newest.source, importedAt: newest.createdAt };
    },
  };
}

export function createImportRowRepo(orm: Orm, check: () => void): ImportRowRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(importRow).values(row).run();
    },

    insertMany: (rows) => {
      check();
      if (rows.length === 0) return;
      orm
        .insert(importRow)
        .values(rows as ImportRowRow[])
        .run();
    },

    listForBatch: (viewer, batchId) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const rows = orm
        .select({
          id: importRow.id,
          batchId: importRow.batchId,
          rowNumber: importRow.rowNumber,
          rawLine: importRow.rawLine,
          status: importRow.status,
          reason: importRow.reason,
          pdfPage: importRow.pdfPage,
          createdAt: importRow.createdAt,
          updatedAt: importRow.updatedAt,
        })
        .from(importRow)
        .innerJoin(importBatch, eq(importRow.batchId, importBatch.id))
        .where(and(eq(importRow.batchId, batchId), visible))
        .orderBy(asc(importRow.rowNumber))
        .all();
      return rows as ImportRowRow[];
    },

    find: (viewer, id) => {
      check();
      const visible = visibleAccountId(importBatch.accountId, viewer);
      const row = orm
        .select({
          id: importRow.id,
          batchId: importRow.batchId,
          rowNumber: importRow.rowNumber,
          rawLine: importRow.rawLine,
          status: importRow.status,
          reason: importRow.reason,
          pdfPage: importRow.pdfPage,
          createdAt: importRow.createdAt,
          updatedAt: importRow.updatedAt,
        })
        .from(importRow)
        .innerJoin(importBatch, eq(importRow.batchId, importBatch.id))
        .where(and(eq(importRow.id, id), visible))
        .get();
      return row as ImportRowRow | undefined;
    },

    updateStatus: (id, status, at, reason) => {
      check();
      const updateData: {
        status: ImportRowRow["status"];
        updatedAt: string;
        reason?: string | null;
      } = {
        status,
        updatedAt: at,
      };
      if (reason !== undefined) {
        updateData.reason = reason;
      }
      const result = orm.update(importRow).set(updateData).where(eq(importRow.id, id)).run();
      return result.changes > 0;
    },
  };
}
