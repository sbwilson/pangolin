import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { attachment } from "./attachment.ts";
import { person } from "./person.ts";

/** `ok | gap | unavailable`; null on a batch from before migration 0019. */
export type ReconcileStatus = "ok" | "gap" | "unavailable";

export const IMPORT_BATCH_STATUSES = ["staged", "ready", "committed", "failed"] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

/**
 * One statement upload batch (`import_batch`).
 * `file_sha256` is unique per account, and commit is idempotent per batch (AD-20).
 */
export const importBatch = sqliteTable(
  "import_batch",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    source: text("source").notNull(),
    fileSha256: text("file_sha256").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    dupCount: integer("dup_count").notNull().default(0),
    status: text("status").notNull(),
    importedByPersonId: text("imported_by_person_id").references(() => person.id),
    undoneAt: text("undone_at"),
    reconcileStatus: text("reconcile_status").$type<ReconcileStatus>(),
    reconcileGapCents: integer("reconcile_gap_cents"),
    /** The balance before the file's oldest balanced row, when the file is `ok`; null otherwise. */
    openingBalanceCents: integer("opening_balance_cents"),
    /** The printed balance of the file's newest balanced row, when the file is `ok`; null otherwise. */
    closingBalanceCents: integer("closing_balance_cents"),
    firstPostedOn: text("first_posted_on"),
    lastPostedOn: text("last_posted_on"),
    /** The encrypted statement file behind a PDF batch (AD-21): read only through this row. */
    attachmentId: text("attachment_id").references(() => attachment.id),
    /** A PDF batch's extraction header as JSON (`startDate`, `endDate`, `accountNumberLast4`). */
    statementMeta: text("statement_meta"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("import_batch_account_idx").on(t.accountId),
    uniqueIndex("import_batch_account_file_sha_idx").on(t.accountId, t.fileSha256),
    check("import_batch_status", sql`${t.status} IN ('staged', 'ready', 'committed', 'failed')`),
  ],
);
