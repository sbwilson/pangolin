import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** An ATO deduction label (D1 to D10 and so on) with its default deductible share. */
export const taxCategory = sqliteTable(
  "tax_category",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    defaultDeductibleBp: integer("default_deductible_bp").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("tax_category_code_idx").on(t.code),
    check("tax_category_default_deductible_bp", sql`${t.defaultDeductibleBp} BETWEEN 0 AND 10000`),
  ],
);
