import type {
  AuditRow,
  AuditView,
  HouseholdSettingsRow,
  ReadRepos,
  TxRepos,
  UnitOfWork,
} from "@pangolin/app";
import { and, asc, eq, sql } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { createBackupSnapshotRepo } from "./backup-snapshot-repo.ts";
import { createBackupVerificationRepo } from "./backup-verification-repo.ts";
import {
  createActivityRepo,
  createCategoryGroupRepo,
  createCategoryRepo,
  createPayeeAliasRepo,
  createPayeeRepo,
  createTagRepo,
  createTaxCategoryRepo,
} from "./classify-repos.ts";
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
import {
  createAccountRepo,
  createBalanceSnapshotRepo,
  createInstitutionRepo,
  createTransactionRepo,
  createTransferGroupRepo,
} from "./ledger-repos.ts";
import type { Db } from "./open.ts";
import { auditHiddenUntil, auditPayeeHidden, visibleAudit } from "./privacy.ts";
import { createRecoveryBundleRepo } from "./recovery-bundle-repo.ts";
import { createReviewItemRepo } from "./review-item-repo.ts";
import { auditLog } from "./schema/audit-log.ts";
import { householdSettings } from "./schema/household-settings.ts";

type Orm = BetterSQLite3Database & { readonly $client: Db };

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
      listVisible: (viewer, today) => {
        const visible = visibleAudit(viewer);
        const hidden = auditHiddenUntil(viewer, today);
        guard(scope);
        // The stored JSON is the true state. While a name is hidden its keys are nulled here
        // (kept, never added: `json_replace`), and `redact` writes the placeholder into them.
        // A payee the viewer may not see (another person's scoped one) is nulled the same way.
        // JSON that is not valid comes back NULL, never as raw text (fail closed).
        const scrub = (json: SQLiteColumn) =>
          sql<string | null>`(CASE WHEN ${json} IS NULL OR NOT json_valid(${json}) THEN NULL
            WHEN ${hidden} IS NOT NULL THEN json_replace(${json}, '$.descriptionRaw', NULL, '$.payeeId', NULL, '$.fingerprint', NULL, '$.externalId', NULL)
            WHEN ${auditPayeeHidden(viewer, json)} = 1 THEN json_replace(${json}, '$.payeeId', NULL)
            ELSE ${json} END)`;
        return orm
          .select({
            id: auditLog.id,
            at: auditLog.at,
            actor: auditLog.actor,
            entity: auditLog.entity,
            entityId: auditLog.entityId,
            accountId: auditLog.accountId,
            personId: auditLog.personId,
            action: auditLog.action,
            before: scrub(auditLog.before),
            after: scrub(auditLog.after),
            hiddenUntil: sql<string | null>`${hidden}`,
          })
          .from(auditLog)
          .where(and(visible))
          .orderBy(asc(auditLog.at), asc(auditLog.id))
          .all() as AuditView[];
      },
    },
    jobs: createJobRepo(orm, () => guard(scope)),
    reviewItems: createReviewItemRepo(orm, () => guard(scope)),
    accounts: createAccountRepo(orm, () => guard(scope)),
    transactions: createTransactionRepo(orm, () => guard(scope)),
    institutions: createInstitutionRepo(orm, () => guard(scope)),
    balanceSnapshots: createBalanceSnapshotRepo(orm, () => guard(scope)),
    transferGroups: createTransferGroupRepo(orm, () => guard(scope)),
    categoryGroups: createCategoryGroupRepo(orm, () => guard(scope)),
    categories: createCategoryRepo(orm, () => guard(scope)),
    taxCategories: createTaxCategoryRepo(orm, () => guard(scope)),
    tags: createTagRepo(orm, () => guard(scope)),
    activities: createActivityRepo(orm, () => guard(scope)),
    payees: createPayeeRepo(orm, () => guard(scope)),
    payeeAliases: createPayeeAliasRepo(orm, () => guard(scope)),
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
              listPending: repos.jobs.listPending,
              listRunning: repos.jobs.listRunning,
              countByStatus: repos.jobs.countByStatus,
              find: repos.jobs.find,
              firstCreatedAt: repos.jobs.firstCreatedAt,
            },
            audit: { listVisible: repos.audit.listVisible },
            reviewItems: { listOpenFor: repos.reviewItems.listOpenFor },
            accounts: {
              findVisible: repos.accounts.findVisible,
              list: repos.accounts.list,
              owners: repos.accounts.owners,
              any: repos.accounts.any,
            },
            transactions: {
              listVisible: repos.transactions.listVisible,
              findVisible: repos.transactions.findVisible,
            },
            institutions: { find: repos.institutions.find, list: repos.institutions.list },
            balanceSnapshots: {
              listVisible: repos.balanceSnapshots.listVisible,
              balanceAsOf: repos.balanceSnapshots.balanceAsOf,
            },
            transferGroups: { find: repos.transferGroups.find },
            categoryGroups: { find: repos.categoryGroups.find, list: repos.categoryGroups.list },
            categories: { find: repos.categories.find, list: repos.categories.list },
            taxCategories: { find: repos.taxCategories.find, list: repos.taxCategories.list },
            tags: {
              find: repos.tags.find,
              list: repos.tags.list,
              listForSplit: repos.tags.listForSplit,
              listForSplits: repos.tags.listForSplits,
            },
            activities: { find: repos.activities.find, list: repos.activities.list },
            payees: { find: repos.payees.find, list: repos.payees.list },
            payeeAliases: { find: repos.payeeAliases.find, list: repos.payeeAliases.list },
            backups: { find: repos.backups.find, latestPushed: repos.backups.latestPushed },
            backupVerifications: { latest: repos.backupVerifications.latest },
            recoveryBundle: { get: repos.recoveryBundle.get },
          };
        },
        fn,
      ),
  };
}
