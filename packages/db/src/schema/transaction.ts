import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";

/**
 * One bank line. `amount_cents` is signed integer minor units; `posted_on` is `YYYY-MM-DD`.
 * `payee_id` is a plain column until the payee table exists (no foreign key).
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
    payeeId: text("payee_id"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("transaction_account_posted_idx").on(t.accountId, t.postedOn),
    check("transaction_status", sql`${t.status} IN ('pending', 'posted')`),
    check(
      "transaction_posted_on",
      sql`${t.postedOn} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
