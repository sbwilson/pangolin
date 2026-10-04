import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { payee } from "./payee.ts";
import { person } from "./person.ts";
import { transferGroup } from "./transfer-group.ts";

/**
 * One bank line. `amount_cents` is signed integer minor units; `posted_on` is `YYYY-MM-DD`.
 * `fingerprint` (hashed by `fingerprint_version`) and `external_id` are unique per account and
 * kept on soft-deleted rows, so a deleted line is not imported again. `import_id` has no foreign
 * key until the import epic adds `import_batch`.
 */
export const transaction = sqliteTable(
  "transaction",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    postedOn: text("posted_on").notNull(),
    amountCents: integer("amount_cents").notNull(),
    descriptionRaw: text("description_raw").notNull(),
    payeeId: text("payee_id").references(() => payee.id),
    status: text("status").notNull(),
    externalId: text("external_id"),
    fingerprint: text("fingerprint").notNull(),
    fingerprintVersion: integer("fingerprint_version").notNull(),
    importId: text("import_id"),
    performedBy: text("performed_by").references(() => person.id),
    transferGroupId: text("transfer_group_id").references(() => transferGroup.id),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    isHidden: integer("is_hidden", { mode: "boolean" }).notNull().default(false),
    nameHiddenBy: text("name_hidden_by").references(() => person.id),
    nameHiddenUntil: text("name_hidden_until"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("transaction_account_posted_idx").on(t.accountId, t.postedOn),
    uniqueIndex("transaction_account_external_id_idx").on(t.accountId, t.externalId),
    uniqueIndex("transaction_account_fingerprint_idx").on(t.accountId, t.fingerprint),
    index("transaction_payee_idx").on(t.payeeId),
    index("transaction_transfer_group_idx").on(t.transferGroupId),
    check("transaction_needs_review", sql`${t.needsReview} IN (0, 1)`),
    check("transaction_is_hidden", sql`${t.isHidden} IN (0, 1)`),
    check("transaction_status", sql`${t.status} IN ('pending', 'posted')`),
    check(
      "transaction_posted_on",
      sql`${t.postedOn} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
