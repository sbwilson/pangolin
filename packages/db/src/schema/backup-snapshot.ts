import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One database snapshot taken for a backup (story 1.10), owned by `system`. `id` is the ID of the
 * `backup-snapshot` job that took it, so a retried job finds its own row. The row is written when
 * the snapshot is staged, and gets its restic snapshot ID once the
 * `backup-push` job (`push_job_id`) has pushed it. Times are `formatInstant` text.
 */
export const backupSnapshot = sqliteTable(
  "backup_snapshot",
  {
    id: text("id").primaryKey(),
    /** When `VACUUM INTO` wrote the snapshot. */
    takenAt: text("taken_at").notNull(),
    /** The snapshot's schema version (applied migrations). */
    schemaVersion: integer("schema_version").notNull(),
    pushJobId: text("push_job_id").notNull(),
    /** restic's snapshot ID (64 hex characters), once pushed. */
    resticSnapshotId: text("restic_snapshot_id"),
    pushedAt: text("pushed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("backup_snapshot_pushed_idx").on(t.pushedAt),
    check("backup_snapshot_pushed", sql`(${t.resticSnapshotId} IS NULL) = (${t.pushedAt} IS NULL)`),
  ],
);
