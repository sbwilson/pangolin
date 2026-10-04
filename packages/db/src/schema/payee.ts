import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { category } from "./category.ts";
import { person } from "./person.ts";

/**
 * A clean merchant identity. Scope (AD-18): both `scope_person_id` and `origin_account_id` NULL
 * means shared; `scope_person_id` makes it owner-only, and `origin_account_id` records the
 * account it came from (never serialised). A live name is unique per scope.
 * `logo_attachment_id` has no foreign key until attachments exist.
 */
export const payee = sqliteTable(
  "payee",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    websiteUrl: text("website_url"),
    logoAttachmentId: text("logo_attachment_id"),
    defaultCategoryId: text("default_category_id").references(() => category.id),
    scopePersonId: text("scope_person_id").references(() => person.id),
    originAccountId: text("origin_account_id").references(() => account.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("payee_name_shared_idx")
      .on(t.name)
      .where(sql`scope_person_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("payee_name_scoped_idx")
      .on(t.scopePersonId, t.name)
      .where(sql`scope_person_id IS NOT NULL AND deleted_at IS NULL`),
    index("payee_default_category_idx").on(t.defaultCategoryId),
  ],
);
