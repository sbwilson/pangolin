import type { BackupSnapshotRepo, BackupSnapshotRow } from "@pangolin/app";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { backupSnapshot } from "./schema/backup-snapshot.ts";

type Orm = BetterSQLite3Database;

/** The `backup_snapshot` repository (story 1.10). `check` throws once the transaction ended. */
export function createBackupSnapshotRepo(orm: Orm, check: () => void): BackupSnapshotRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(backupSnapshot).values(row).run();
    },

    find: (id) => {
      check();
      return orm.select().from(backupSnapshot).where(eq(backupSnapshot.id, id)).get() as
        | BackupSnapshotRow
        | undefined;
    },

    markPushed: (id, resticSnapshotId, pushedAt) => {
      check();
      return (
        orm
          .update(backupSnapshot)
          .set({ resticSnapshotId, pushedAt, updatedAt: pushedAt })
          .where(and(eq(backupSnapshot.id, id), isNull(backupSnapshot.resticSnapshotId)))
          .run().changes === 1
      );
    },

    latestPushed: () => {
      check();
      return (
        orm
          .select()
          .from(backupSnapshot)
          .where(isNotNull(backupSnapshot.pushedAt))
          // By when the database was taken, not pushed: a retried older push never wins.
          .orderBy(desc(backupSnapshot.takenAt), desc(backupSnapshot.id))
          .limit(1)
          .get() as BackupSnapshotRow | undefined
      );
    },
  };
}
