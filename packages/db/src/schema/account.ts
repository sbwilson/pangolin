import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { institution } from "./institution.ts";

/**
 * Any balance we track (`type` is one of the ten account types). A private account
 * (`is_private`) is seen only by its owner (AD-3).
 */
export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currency: text("currency").notNull(),
    isPrivate: integer("is_private", { mode: "boolean" }).notNull(),
    institutionId: text("institution_id").references(() => institution.id),
    openedOn: text("opened_on"),
    closedOn: text("closed_on"),
    isSavings: integer("is_savings", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    check(
      "account_type",
      sql`${t.type} IN ('transaction', 'savings', 'offset', 'credit_card', 'home_loan', 'brokerage', 'super', 'property', 'vehicle', 'other')`,
    ),
    check("account_is_private", sql`${t.isPrivate} IN (0, 1)`),
    check("account_is_savings", sql`${t.isSavings} IN (0, 1)`),
  ],
);
