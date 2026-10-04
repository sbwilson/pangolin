import { sql } from "drizzle-orm";
import { check, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/**
 * The one review inbox (AD-17), owned by `system`. An item is open while `resolved_at` is
 * NULL. Its scope is `account_id` (the account's scope), `person_id` (that person only) or
 * neither (the household).
 */
export const reviewItem = sqliteTable(
  "review_item",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    accountId: text("account_id").references(() => account.id),
    personId: text("person_id").references(() => person.id),
    entityRef: text("entity_ref").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolution: text("resolution"),
  },
  (t) => [
    // Raising is idempotent among open items; a resolved item frees its key.
    uniqueIndex("review_item_dedupe_key_open_idx").on(t.dedupeKey).where(sql`resolved_at IS NULL`),
    check("review_item_resolution", sql`(${t.resolvedAt} IS NULL) = (${t.resolution} IS NULL)`),
    // An item is scoped to an account or a person, never both.
    check("review_item_scope", sql`${t.accountId} IS NULL OR ${t.personId} IS NULL`),
  ],
);
