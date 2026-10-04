import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { categoryGroup } from "./category-group.ts";

/** A leaf category. Soft-deleted with `deleted_at`; a live name is unique within its group. */
export const category = sqliteTable(
  "category",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => categoryGroup.id),
    name: text("name").notNull(),
    isFixedCost: integer("is_fixed_cost", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("category_group_idx").on(t.groupId),
    uniqueIndex("category_group_name_live_idx")
      .on(t.groupId, t.name)
      .where(sql`deleted_at IS NULL`),
    check("category_is_fixed_cost", sql`${t.isFixedCost} IN (0, 1)`),
  ],
);
