import type {
  AttachmentRepo,
  AttachmentRow,
  HandoffStatus,
  ImportHandoffRepo,
  ImportHandoffRow,
} from "@pangolin/app";
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { attachment } from "../schema/attachment.ts";
import { importBatch } from "../schema/import-batch.ts";
import { importHandoff } from "../schema/import-handoff.ts";

type Orm = BetterSQLite3Database;

export function createAttachmentRepo(orm: Orm, check: () => void): AttachmentRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(attachment).values(row).run();
    },
    findByName: (name) => {
      check();
      return orm.select().from(attachment).where(eq(attachment.name, name)).get() as
        | AttachmentRow
        | undefined;
    },
    find: (id) => {
      check();
      return orm.select().from(attachment).where(eq(attachment.id, id)).get() as
        | AttachmentRow
        | undefined;
    },
    deleteIfUnlinked: (id) => {
      check();
      const row = orm.select().from(attachment).where(eq(attachment.id, id)).get();
      if (row === undefined) return undefined;
      const result = orm
        .delete(attachment)
        .where(
          and(
            eq(attachment.id, id),
            sql`NOT EXISTS (SELECT 1 FROM ${importHandoff} WHERE ${importHandoff.attachmentId} = ${attachment.id})`,
            sql`NOT EXISTS (SELECT 1 FROM ${importBatch} WHERE ${importBatch.attachmentId} = ${attachment.id})`,
          ),
        )
        .run();
      return result.changes > 0 ? row.name : undefined;
    },
  };
}

export function createImportHandoffRepo(orm: Orm, check: () => void): ImportHandoffRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(importHandoff).values(row).run();
    },

    findForRecipient: (viewer, id) => {
      check();
      if (viewer === undefined || viewer === null) {
        throw new TypeError("findForRecipient: a viewer is required");
      }
      const mine =
        viewer.kind === "system" ? undefined : eq(importHandoff.recipientId, viewer.personId);
      return orm
        .select()
        .from(importHandoff)
        .where(and(eq(importHandoff.id, id), mine))
        .get() as ImportHandoffRow | undefined;
    },

    listForSender: (viewer) => {
      check();
      if (viewer === undefined || viewer === null) {
        throw new TypeError("listForSender: a viewer is required");
      }
      // Only these four columns are ever selected: no batch, no attachment, no mapping.
      const mine =
        viewer.kind === "system" ? undefined : eq(importHandoff.senderId, viewer.personId);
      const rows = orm
        .select({
          id: importHandoff.id,
          recipient: importHandoff.recipientId,
          filename: importHandoff.filename,
          status: importHandoff.status,
        })
        .from(importHandoff)
        .where(mine)
        .orderBy(asc(importHandoff.createdAt), asc(importHandoff.id))
        .all();
      return rows as HandoffStatus[];
    },

    markImported: (id, batchId, at) => {
      check();
      return (
        orm
          .update(importHandoff)
          .set({ status: "imported", batchId, updatedAt: at })
          .where(and(eq(importHandoff.id, id), eq(importHandoff.status, "pending")))
          .run().changes > 0
      );
    },

    markDismissed: (id, at) => {
      check();
      return (
        orm
          .update(importHandoff)
          .set({ status: "dismissed", attachmentId: null, updatedAt: at })
          .where(and(eq(importHandoff.id, id), eq(importHandoff.status, "pending")))
          .run().changes > 0
      );
    },

    deleteForPerson: (personId) => {
      check();
      const mine = or(
        eq(importHandoff.senderId, personId),
        eq(importHandoff.recipientId, personId),
      );
      const rows = orm
        .select({ id: importHandoff.id, attachmentId: importHandoff.attachmentId })
        .from(importHandoff)
        .where(mine)
        .all();
      orm.delete(importHandoff).where(mine).run();
      return rows;
    },
  };
}
