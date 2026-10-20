import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { attachment } from "./attachment.ts";
import { importBatch } from "./import-batch.ts";
import { person } from "./person.ts";

export const IMPORT_HANDOFF_STATUSES = ["pending", "imported", "dismissed"] as const;

/**
 * A statement file one person hands to another to import (AD-5). Person-scoped: the sender
 * reads only id, recipient, filename and status; `batch_id` (set on accept) is the recipient's.
 * `attachment_id` is cleared when the hand-off is dismissed, so the file can be deleted once no
 * row links it.
 */
export const importHandoff = sqliteTable(
  "import_handoff",
  {
    id: text("id").primaryKey(),
    attachmentId: text("attachment_id").references(() => attachment.id),
    senderId: text("sender_id")
      .notNull()
      .references(() => person.id),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => person.id),
    filename: text("filename").notNull(),
    format: text("format").notNull(),
    csvMapping: text("csv_mapping"),
    status: text("status").notNull(),
    batchId: text("batch_id").references(() => importBatch.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("import_handoff_sender_idx").on(t.senderId),
    index("import_handoff_recipient_idx").on(t.recipientId),
    index("import_handoff_attachment_idx").on(t.attachmentId),
    check("import_handoff_status", sql`${t.status} IN ('pending', 'imported', 'dismissed')`),
    check("import_handoff_batch", sql`(${t.status} = 'imported') = (${t.batchId} IS NOT NULL)`),
    check("import_handoff_people", sql`${t.senderId} <> ${t.recipientId}`),
  ],
);
