import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { split } from "./split.ts";
import { tag } from "./tag.ts";

/** Which tags a split carries (many to many). */
export const splitTag = sqliteTable(
  "split_tag",
  {
    splitId: text("split_id")
      .notNull()
      .references(() => split.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.splitId, t.tagId] }), index("split_tag_tag_idx").on(t.tagId)],
);
