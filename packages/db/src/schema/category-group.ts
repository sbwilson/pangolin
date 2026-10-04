import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** A report group of categories (Income, Housing, Food, a rental property). */
export const categoryGroup = sqliteTable(
  "category_group",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    sort: integer("sort").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("category_group_name_idx").on(t.name),
    check("category_group_kind", sql`${t.kind} IN ('income', 'expense', 'transfer')`),
  ],
);
