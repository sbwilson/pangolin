import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Links both sides of a transfer between our own accounts. */
export const transferGroup = sqliteTable(
  "transfer_group",
  {
    id: text("id").primaryKey(),
    matchedBy: text("matched_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [check("transfer_group_matched_by", sql`${t.matchedBy} IN ('rule', 'manual', 'auto')`)],
);
