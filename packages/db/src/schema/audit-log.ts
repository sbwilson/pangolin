import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Who changed what (AD-1). Appended by every use case in the same transaction as the change.
 * `before` and `after` are JSON text or NULL. `account_id` and `person_id` carry the scope of
 * the entity described; they have no foreign keys, so audit rows outlive what they describe.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    accountId: text("account_id"),
    personId: text("person_id"),
    action: text("action").notNull(),
    before: text("before"),
    after: text("after"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId),
    index("audit_log_at_idx").on(t.at),
    check("audit_log_before_json", sql`${t.before} IS NULL OR json_valid(${t.before})`),
    check("audit_log_after_json", sql`${t.after} IS NULL OR json_valid(${t.after})`),
  ],
);
