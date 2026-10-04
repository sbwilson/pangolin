import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { activity } from "./activity.ts";
import { category } from "./category.ts";
import { taxCategory } from "./tax-category.ts";
import { transaction } from "./transaction.ts";

/**
 * Where the money went: at least one per transaction. `beneficiary` is `shared` or a person ID
 * (a private account's splits carry its owner). `property_id` has no foreign key until the
 * property table exists.
 */
export const split = sqliteTable(
  "split",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transaction.id),
    amountCents: integer("amount_cents").notNull(),
    categoryId: text("category_id").references(() => category.id),
    activityId: text("activity_id").references(() => activity.id),
    beneficiary: text("beneficiary").notNull(),
    propertyId: text("property_id"),
    taxCategoryId: text("tax_category_id").references(() => taxCategory.id),
    deductibleBp: integer("deductible_bp"),
    memo: text("memo"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("split_transaction_idx").on(t.transactionId),
    index("split_category_idx").on(t.categoryId),
    index("split_activity_idx").on(t.activityId),
    check(
      "split_deductible_bp",
      sql`${t.deductibleBp} IS NULL OR ${t.deductibleBp} BETWEEN 0 AND 10000`,
    ),
  ],
);
