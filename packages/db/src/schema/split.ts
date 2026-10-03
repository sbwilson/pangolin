import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { transaction } from "./transaction.ts";

/**
 * Where the money went: at least one per transaction. `beneficiary` is `shared` or a person ID
 * (a private account's splits carry its owner). `category_id`, `property_id` and
 * `tax_category_id` have no foreign keys until those tables exist.
 */
export const split = sqliteTable(
  "split",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transaction.id),
    amountCents: integer("amount_cents").notNull(),
    categoryId: text("category_id"),
    beneficiary: text("beneficiary").notNull(),
    propertyId: text("property_id"),
    taxCategoryId: text("tax_category_id"),
    memo: text("memo"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("split_transaction_idx").on(t.transactionId)],
);
