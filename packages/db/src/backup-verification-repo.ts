import type { BackupVerificationRepo, BackupVerificationRow } from "@pangolin/app";
import { desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { backupVerification } from "./schema/backup-verification.ts";

type Orm = BetterSQLite3Database;

/** The `backup_verification` repository (story 1.14). `check` throws once the transaction ended. */
export function createBackupVerificationRepo(orm: Orm, check: () => void): BackupVerificationRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(backupVerification).values(row).run();
    },

    latest: (kind) => {
      check();
      return orm
        .select()
        .from(backupVerification)
        .where(eq(backupVerification.kind, kind))
        .orderBy(desc(backupVerification.at), desc(backupVerification.id))
        .limit(1)
        .get() as BackupVerificationRow | undefined;
    },
  };
}
