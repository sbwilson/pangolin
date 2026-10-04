import { sql } from "drizzle-orm";
import { sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/** A free-form label. Scope as on `payee` (AD-18); a live name is unique per scope. */
export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    scopePersonId: text("scope_person_id").references(() => person.id),
    originAccountId: text("origin_account_id").references(() => account.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("tag_name_shared_idx")
      .on(t.name)
      .where(sql`scope_person_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("tag_name_scoped_idx")
      .on(t.scopePersonId, t.name)
      .where(sql`scope_person_id IS NOT NULL AND deleted_at IS NULL`),
  ],
);
