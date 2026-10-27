import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { importBatch } from "./import-batch.ts";

export const IMPORT_ROW_STATUSES = ["staged", "committed", "set_aside", "discarded"] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/**
 * Parsed statement rows staged in `import_row` before commit or set-aside (AD-1, AD-10).
 */
export const importRow = sqliteTable(
  "import_row",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatch.id),
    rowNumber: integer("row_number").notNull(),
    rawLine: text("raw_line").notNull(),
    status: text("status").notNull(),
    reason: text("reason"),
    proposal: text("proposal"),
    pdfPage: integer("pdf_page"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("import_row_batch_idx").on(t.batchId),
    uniqueIndex("import_row_batch_row_number_idx").on(t.batchId, t.rowNumber),
    check(
      "import_row_status",
      sql`${t.status} IN ('staged', 'committed', 'set_aside', 'discarded')`,
    ),
  ],
);
