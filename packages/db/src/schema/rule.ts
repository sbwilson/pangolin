import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/**
 * Deterministic categorisation rule. Scope (AD-18): both `scope_person_id` and
 * `origin_account_id` NULL means shared; `scope_person_id` makes it owner-only,
 * and `origin_account_id` records the account it came from (never serialised).
 * A live name is unique per scope. Rules evaluate in ascending priority order.
 */
export const rule = sqliteTable(
  "rule",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    conditions: text("conditions").notNull(),
    actions: text("actions").notNull(),
    origin: text("origin").notNull(),
    scopePersonId: text("scope_person_id").references(() => person.id),
    originAccountId: text("origin_account_id").references(() => account.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("rule_name_shared_idx")
      .on(t.name)
      .where(sql`scope_person_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("rule_name_scoped_idx")
      .on(t.scopePersonId, t.name)
      .where(sql`scope_person_id IS NOT NULL AND deleted_at IS NULL`),
    index("rule_priority_idx").on(t.priority),
    check("rule_origin", sql`${t.origin} IN ('user', 'correction', 'llm_suggested')`),
  ],
);
