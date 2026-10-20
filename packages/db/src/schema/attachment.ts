import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * One encrypted file on disk (AD-21), deduplicated by `name`: the HMAC of its content, which is
 * also its file name under `data/attachments`. Nothing here is plaintext statement content.
 * Fetched only through a row that links it (`import_handoff.attachment_id`), never by name.
 */
export const attachment = sqliteTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("attachment_name_idx").on(t.name)],
);
