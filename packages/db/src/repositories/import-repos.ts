import type { ImportBatchRepo, ImportBatchRow, ImportRowRepo, ImportRowRow } from "@pangolin/app";
import { and, asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { visibleAccountId } from "../privacy.ts";
import { importBatch } from "../schema/import-batch.ts";
import { importRow } from "../schema/import-row.ts";

type Orm = BetterSQLite3Database;

export function createImportBatchRepo(orm: Orm, check: () => void): ImportBatchRepo {
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
