import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** A bank, broker or super fund. Soft-deleted with `deleted_at`. */
export const institution = sqliteTable(
  "institution",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    websiteUrl: text("website_url"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [check("institution_kind", sql`${t.kind} IN ('bank', 'broker', 'super_fund', 'other')`)],
);
