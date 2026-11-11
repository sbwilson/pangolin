// Budget schema (AD-10, AD-22, CAP-4).
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { category } from "./category.ts";
import { categoryGroup } from "./category-group.ts";
import { person } from "./person.ts";

/**
 * Budget table. Scoped to a person (personal) or null (shared) (AD-22).
 * Targets either a category or a category group (mutually exclusive, exactly one).
 * Limit is stored in positive integer cents (AD-13).
 * `funding_account_id` is the account the forecast charges its pro-rated spend to; null means
 * the scope's pay deposit account (AD-25 default).
 */
export const budget = sqliteTable(
  "budget",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").references(() => person.id),
    categoryId: text("category_id").references(() => category.id),
    categoryGroupId: text("category_group_id").references(() => categoryGroup.id),
    fundingAccountId: text("funding_account_id").references(() => account.id),
    cadence: text("cadence", { enum: ["fortnight", "month"] }).notNull(),
    limitCents: integer("limit_cents").notNull(),
    rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("budget_person_idx").on(t.personId),
    index("budget_category_idx").on(t.categoryId),
    index("budget_category_group_idx").on(t.categoryGroupId),
    index("budget_funding_account_idx").on(t.fundingAccountId),
    check("budget_cadence", sql`${t.cadence} IN ('fortnight', 'month')`),
    check("budget_limit_cents", sql`${t.limitCents} > 0`),
    check("budget_rollover", sql`${t.rollover} IN (0, 1)`),
    check(
      "budget_target_check",
      sql`(${t.categoryId} IS NOT NULL AND ${t.categoryGroupId} IS NULL) OR (${t.categoryId} IS NULL AND ${t.categoryGroupId} IS NOT NULL)`,
    ),
  ],
);
