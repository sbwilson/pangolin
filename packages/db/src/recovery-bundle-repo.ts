import type { RecoveryBundleRepo } from "@pangolin/app";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { recoveryBundle } from "./schema/recovery-bundle.ts";

type Orm = BetterSQLite3Database;

const ROW_ID = 1;

/** The `recovery_bundle` repository (story 1.17). `check` throws once the transaction ended. */
export function createRecoveryBundleRepo(orm: Orm, check: () => void): RecoveryBundleRepo {
  return {
    get: () => {
      check();
      return orm
        .select({ bundleId: recoveryBundle.bundleId, confirmedAt: recoveryBundle.confirmedAt })
        .from(recoveryBundle)
        .where(eq(recoveryBundle.id, ROW_ID))
        .get();
    },

    set: (row) => {
      check();
      orm
        .insert(recoveryBundle)
        .values({ id: ROW_ID, bundleId: row.bundleId, confirmedAt: row.confirmedAt })
        .onConflictDoUpdate({
          target: recoveryBundle.id,
          set: { bundleId: row.bundleId, confirmedAt: row.confirmedAt },
        })
        .run();
    },
  };
}
