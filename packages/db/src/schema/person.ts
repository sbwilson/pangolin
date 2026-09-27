import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Each of us, optionally linked to a login (`user_id`, filled in by story 1.5). */
export const person = sqliteTable("person", {
  id: text("id").primaryKey(),
  userId: text("user_id").unique(),
  displayName: text("display_name").notNull(),
  colour: text("colour").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});
