import type { AuditRow, HouseholdSettingsRow, ReadRepos, TxRepos, UnitOfWork } from "@pangolin/app";
import { eq } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { createBackupSnapshotRepo } from "./backup-snapshot-repo.ts";
import { createBackupVerificationRepo } from "./backup-verification-repo.ts";
import {
  createCredentialRepo,
  createLoginAttemptRepo,
  createPersonRepo,
  createRecoveryCodeRepo,
  createReEnrolmentLinkRepo,
  createSetupLinkRepo,
  createUserRepo,
} from "./identity-repos.ts";
import { createJobRepo } from "./job-repo.ts";
import type { Db } from "./open.ts";
import { createRecoveryBundleRepo } from "./recovery-bundle-repo.ts";
import { createReviewItemRepo } from "./review-item-repo.ts";
import { auditLog } from "./schema/audit-log.ts";
import { householdSettings } from "./schema/household-settings.ts";

type Orm = BetterSQLite3Database;

/** Guards repositories so a call after their transaction ended throws instead of autocommitting. */
interface Scope {
  active: boolean;
}

function guard(scope: Scope): void {
  if (!scope.active) throw new Error("Repository used outside its transaction");
}

const SETTINGS_ID = 1;

function getSettings(orm: Orm): HouseholdSettingsRow {
  const row = orm
    .select({
      baseCurrency: householdSettings.baseCurrency,
      fyStart: householdSettings.fyStart,
      timezone: householdSettings.timezone,
      sharedAttribution: householdSettings.sharedAttribution,
      updatedAt: householdSettings.updatedAt,
    })
    .from(householdSettings)
    .where(eq(householdSettings.id, SETTINGS_ID))
    .get();
  // Migration 0001 inserts the row and nothing deletes it; its absence is a broken database.
  if (row === undefined) throw new Error("household_settings row is missing");
  return row;
}

function txRepos(orm: Orm, scope: Scope): TxRepos {
  return {
    householdSettings: {
      get: () => {
        guard(scope);
        return getSettings(orm);
      },
      update: (row) => {
        guard(scope);
        const result = orm
          .update(householdSettings)
          .set({
            baseCurrency: row.baseCurrency,
            fyStart: row.fyStart,
            timezone: row.timezone,
            sharedAttribution: row.sharedAttribution,
            updatedAt: row.updatedAt,
          })
          .where(eq(householdSettings.id, SETTINGS_ID))
          .run();
        if (result.changes !== 1) throw new Error("household_settings row is missing");
      },
    },
    person: createPersonRepo(orm, () => guard(scope)),
    users: createUserRepo(orm, () => guard(scope)),
    setupLinks: createSetupLinkRepo(orm, () => guard(scope)),
    loginAttempts: createLoginAttemptRepo(orm, () => guard(scope)),
    recoveryCodes: createRecoveryCodeRepo(orm, () => guard(scope)),
    reEnrolmentLinks: createReEnrolmentLinkRepo(orm, () => guard(scope)),
    credentials: createCredentialRepo(orm, () => guard(scope)),
    audit: {
      append: (row: AuditRow) => {
        guard(scope);
        orm.insert(auditLog).values(row).run();
      },
    },
    jobs: createJobRepo(orm, () => guard(scope)),
    reviewItems: createReviewItemRepo(orm, () => guard(scope)),
    backups: createBackupSnapshotRepo(orm, () => guard(scope)),
    backupVerifications: createBackupVerificationRepo(orm, () => guard(scope)),
    recoveryBundle: createRecoveryBundleRepo(orm, () => guard(scope)),
  };
}

/**
 * The `UnitOfWork` adapter. `transaction` runs `fn` with better-sqlite3's
 * `db.transaction(fn).immediate()`, so it takes the write lock up front (`BEGIN IMMEDIATE`); the
 * repositories it hands out are bound to the same connection and stop working once it ends.
 * Nested calls become savepoints.
 */
export function createUnitOfWork(db: Db): UnitOfWork {
  const orm = drizzle({ client: db });

  function run<R, T>(
    mode: "immediate" | "deferred",
    repos: (scope: Scope) => R,
    fn: (r: R) => T,
  ): T {
    const scope: Scope = { active: true };
    try {
      return db.transaction(() => fn(repos(scope)))[mode]();
    } finally {
      scope.active = false;
    }
  }

  return {
    transaction: (fn) => run("immediate", (scope) => txRepos(orm, scope), fn),
    read: (fn) =>
      run(
        "deferred",
        (scope): ReadRepos => {
          const repos = txRepos(orm, scope);
          return {
            householdSettings: { get: repos.householdSettings.get },
            person: {
              findByUserId: repos.person.findByUserId,
              listActive: repos.person.listActive,
              listLogins: repos.person.listLogins,
            },
            users: repos.users,
            setupLinks: {
              findByTokenHash: repos.setupLinks.findByTokenHash,
              hasLive: repos.setupLinks.hasLive,
            },
            loginAttempts: { listSince: repos.loginAttempts.listSince },
            recoveryCodes: { counts: repos.recoveryCodes.counts },
            reEnrolmentLinks: {
              findByTokenHash: repos.reEnrolmentLinks.findByTokenHash,
              findById: repos.reEnrolmentLinks.findById,
            },
            jobs: {
              listDead: repos.jobs.listDead,
              countByStatus: repos.jobs.countByStatus,
              find: repos.jobs.find,
              firstCreatedAt: repos.jobs.firstCreatedAt,
            },
            reviewItems: { listOpenFor: repos.reviewItems.listOpenFor },
            backups: { find: repos.backups.find, latestPushed: repos.backups.latestPushed },
            backupVerifications: { latest: repos.backupVerifications.latest },
            recoveryBundle: { get: repos.recoveryBundle.get },
          };
        },
        fn,
      ),
  };
}
