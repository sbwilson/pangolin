import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/** A trip or event ("Japan Trip 2026"). Scope as on `payee` (AD-18); a live name is unique per scope. */
export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    budgetCents: integer("budget_cents"),
    scopePersonId: text("scope_person_id").references(() => person.id),
    originAccountId: text("origin_account_id").references(() => account.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("activity_name_shared_idx")
      .on(t.name)
      .where(sql`scope_person_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("activity_name_scoped_idx")
      .on(t.scopePersonId, t.name)
      .where(sql`scope_person_id IS NOT NULL AND deleted_at IS NULL`),
    check("activity_budget_cents", sql`${t.budgetCents} IS NULL OR ${t.budgetCents} >= 0`),
  ],
);
