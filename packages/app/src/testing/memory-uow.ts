// Test support only (not exported from the package): an in-memory `UnitOfWork` with rollback,
// so `app` tests can check transaction behaviour without importing an adapter. The job and
// review-item repositories mirror the SQLite adapter's semantics (partial unique keys, leased
// claims, visibility); `packages/db` tests prove the adapter on real SQLite, and the parity tests
// beside this file (`*-parity.test.ts`, which may import `@pangolin/db`) hold the two together.
import type { Id } from "@pangolin/shared";
import type {
  AccountOwnerRow,
  AccountRepo,
  AccountRow,
  ActivityRepo,
  ActivityRow,
  AuditedOwner,
  AuditRow,
  AuditView,
  BackupSnapshotRepo,
  BackupSnapshotRow,
  BackupVerificationRepo,
  BackupVerificationRow,
  BalanceSnapshotRepo,
  BalanceSnapshotRow,
  CategoryGroupRepo,
  CategoryGroupRow,
  CategoryRepo,
  CategoryRow,
  CredentialRepo,
  HouseholdSettingsRow,
  InstitutionRepo,
  InstitutionRow,
  JobRepo,
  JobRow,
  LoginAttemptRepo,
  LoginAttemptRow,
  OwnedAccount,
  OwnerChange,
  PayeeAliasRepo,
  PayeeAliasRow,
  PayeeRepo,
  PayeeRow,
  PersonRepo,
  PersonRow,
  RecoveryBundleRow,
  RecoveryCodeRepo,
  RecoveryCodeRow,
  ReEnrolmentLinkRepo,
  ReEnrolmentLinkRow,
  ReviewItemRepo,
  ReviewItemRow,
  ScopedReference,
  SetupLinkRepo,
  SetupLinkRow,
  SplitRow,
  SplitTagged,
  SplitTagRow,
  TagRepo,
  TagRow,
  TaxCategoryRepo,
  TaxCategoryRow,
  TransactionCursor,
  TransactionFilter,
  TransactionRepo,
  TransactionRow,
  TransferGroupRepo,
  TransferGroupRow,
  TxRepos,
  UnitOfWork,
  UserEnrolment,
  UserRepo,
  VisibleTransaction,
} from "../ports/unit-of-work.ts";
import {
  ACCOUNT_TYPES,
  BALANCE_SOURCES,
  CATEGORY_GROUP_KINDS,
  INSTITUTION_KINDS,
  SPLIT_SOURCES,
  TRANSFER_MATCHES,
} from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

export interface MemoryState {
  settings: HouseholdSettingsRow;
  people: PersonRow[];
  audit: AuditRow[];
  jobs: JobRow[];
  reviewItems: ReviewItemRow[];
  accounts: AccountRow[];
  accountOwners: AccountOwnerRow[];
  transactions: TransactionRow[];
  splits: SplitRow[];
  institutions: InstitutionRow[];
  balanceSnapshots: BalanceSnapshotRow[];
  transferGroups: TransferGroupRow[];
  categoryGroups: CategoryGroupRow[];
  categories: CategoryRow[];
  taxCategories: TaxCategoryRow[];
  tags: TagRow[];
  splitTags: SplitTagRow[];
  activities: ActivityRow[];
  payees: PayeeRow[];
  payeeAliases: PayeeAliasRow[];
  /** IDs of soft-deleted rows (ULIDs are unique across tables); the rows stay, as in SQLite. */
  deleted: Set<string>;
  /** The origin account of each scoped row (AD-18), by row ID; never part of a row type. */
  origins: Map<string, string | null>;
  backups: BackupSnapshotRow[];
  backupVerifications: BackupVerificationRow[];
  /** The confirmed recovery bundle; undefined until the first confirmation. */
  recoveryBundle: RecoveryBundleRow | undefined;
  /** IDs of better-auth users; tests add them to stand in for better-auth's inserts. */
  users: string[];
  /** Email per user ID, standing in for `auth_user.email`. */
  emails: Record<string, string>;
  /** Enrolment per user ID; a user without an entry has enrolled nothing. */
  enrolments: Record<string, UserEnrolment>;
  setupLinks: SetupLinkRow[];
  loginAttempts: LoginAttemptRow[];
  recoveryCodes: RecoveryCodeRow[];
  reEnrolmentLinks: ReEnrolmentLinkRow[];
  /** Open sessions per user ID, standing in for `auth_session`. */
  sessions: Record<string, number>;
  /** Password hash per user ID, standing in for `auth_account.password`. */
  passwords: Record<string, string>;
}

export interface MemoryUnitOfWork extends UnitOfWork {
  readonly state: MemoryState;
  /** Makes the next `audit.append` calls throw, to test rollback. */
  failAudit: boolean;
}

export const DEFAULT_SETTINGS: HouseholdSettingsRow = {
  baseCurrency: "AUD",
  fyStart: "07-01",
  timezone: "Australia/Sydney",
  sharedAttribution: "contribution",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const isLive = (row: JobRow) => row.status === "pending" || row.status === "running";

function jobRepo(working: MemoryState, check: () => void): JobRepo {
  /** Replaces the job `id` held by `owner` with `patch`; false when `owner` does not hold it. */
  const update = (id: Id<"Job">, owner: string, patch: Partial<JobRow>): boolean => {
    check();
    const index = working.jobs.findIndex(
      (row) => row.id === id && row.status === "running" && row.leaseOwner === owner,
    );
    const row = working.jobs[index];
    if (row === undefined) return false;
    working.jobs[index] = { ...row, ...patch };
    return true;
  };
  return {
    insertOrGetPending: (row) => {
      check();
      const existing =
        row.dedupeKey === null
          ? undefined
          : working.jobs.find((job) => job.dedupeKey === row.dedupeKey && isLive(job));
      if (existing !== undefined) return { id: existing.id, inserted: false };
      if (working.jobs.some((job) => job.id === row.id)) {
        throw new Error("UNIQUE constraint failed: job.id");
      }
      working.jobs.push(row);
      return { id: row.id, inserted: true };
    },
    claimNext: (lane, owner, now, leaseUntil) => {
      check();
      const next = working.jobs
        .filter(
          (job) =>
            job.lane === lane &&
            ((job.status === "pending" && job.runAt <= now) ||
              (job.status === "running" && (job.leaseExpiresAt ?? "") <= now)),
        )
        .sort((a, b) =>
          a.runAt === b.runAt ? (a.id < b.id ? -1 : 1) : a.runAt < b.runAt ? -1 : 1,
        )[0];
      if (next === undefined) return undefined;
      const claimed: JobRow = {
        ...next,
        status: "running",
        leaseOwner: owner,
        leaseExpiresAt: leaseUntil,
        attempts: next.attempts + 1,
        updatedAt: now,
      };
      working.jobs[working.jobs.indexOf(next)] = claimed;
      return claimed;
    },
    renewLease: (id, owner, now, leaseUntil) =>
      update(id, owner, { leaseExpiresAt: leaseUntil, updatedAt: now }),
    complete: (id, owner, now) =>
      update(id, owner, {
        status: "done",
        leaseOwner: null,
        leaseExpiresAt: null,
        finishedAt: now,
        updatedAt: now,
      }),
    retry: (id, owner, now, runAt, error) =>
      update(id, owner, {
        status: "pending",
        runAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: error,
        updatedAt: now,
      }),
    markDead: (id, owner, now, error) =>
      update(id, owner, {
        status: "dead",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: error,
        finishedAt: now,
        updatedAt: now,
      }),
    listDead: (limit) => {
      check();
      return working.jobs
        .filter((job) => job.status === "dead")
        .sort((a, b) => {
          const x = `${a.finishedAt}|${a.id}`;
          const y = `${b.finishedAt}|${b.id}`;
          return x < y ? 1 : x > y ? -1 : 0;
        })
        .slice(0, limit)
        .map((job) => ({ kind: job.kind, failedAt: job.finishedAt ?? "" }));
    },
    listPending: (limit) => {
      check();
      return working.jobs
        .filter((job) => job.status === "pending")
        .sort((a, b) => {
          const x = `${a.runAt}|${a.id}`;
          const y = `${b.runAt}|${b.id}`;
          return x < y ? -1 : x > y ? 1 : 0;
        })
        .slice(0, limit)
        .map((job) => ({ kind: job.kind, runAt: job.runAt }));
    },
    listRunning: (limit) => {
      check();
      return working.jobs
        .filter((job) => job.status === "running")
        .sort((a, b) => {
          const x = `${a.leaseExpiresAt}|${a.id}`;
          const y = `${b.leaseExpiresAt}|${b.id}`;
          return x < y ? -1 : x > y ? 1 : 0;
        })
        .slice(0, limit)
        .map((job) => ({ kind: job.kind, leaseExpiresAt: job.leaseExpiresAt ?? "" }));
    },
    countByStatus: () => {
      check();
      const counts = { pending: 0, running: 0, done: 0, dead: 0 };
      for (const job of working.jobs) counts[job.status]++;
      return counts;
    },
    find: (id) => {
      check();
      return working.jobs.find((job) => job.id === id);
    },
    firstCreatedAt: (kind) => {
      check();
      return working.jobs
        .filter((job) => job.kind === kind)
        .map((job) => job.createdAt)
        .sort()[0];
    },
    cancelLive: (kinds, now, reason) => {
      check();
      let changed = 0;
      working.jobs = working.jobs.map((job) => {
        if (!kinds.includes(job.kind) || !isLive(job)) return job;
        changed++;
        return {
          ...job,
          status: "dead",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: reason,
          finishedAt: now,
          updatedAt: now,
        };
      });
      return changed;
    },
  };
}

function backupRepo(working: MemoryState, check: () => void): BackupSnapshotRepo {
  return {
    insert: (row) => {
      check();
      if (working.backups.some((b) => b.id === row.id)) {
        throw new Error("UNIQUE constraint failed: backup_snapshot.id");
      }
      working.backups.push(row);
    },
    find: (id) => {
      check();
      return working.backups.find((b) => b.id === id);
    },
    markPushed: (id, resticSnapshotId, pushedAt) => {
      check();
      const index = working.backups.findIndex((b) => b.id === id && b.resticSnapshotId === null);
      const row = working.backups[index];
      if (row === undefined) return false;
      working.backups[index] = { ...row, resticSnapshotId, pushedAt, updatedAt: pushedAt };
      return true;
    },
    latestPushed: () => {
      check();
      return working.backups
        .filter((b) => b.pushedAt !== null)
        .sort((a, b) => (`${a.takenAt}|${a.id}` < `${b.takenAt}|${b.id}` ? 1 : -1))[0];
    },
  };
}

function backupVerificationRepo(working: MemoryState, check: () => void): BackupVerificationRepo {
  return {
    insert: (row) => {
      check();
      if (working.backupVerifications.some((v) => v.id === row.id)) {
        throw new Error("UNIQUE constraint failed: backup_verification.id");
      }
      working.backupVerifications.push(row);
    },
    latest: (kind) => {
      check();
      return working.backupVerifications
        .filter((v) => v.kind === kind)
        .sort((a, b) => (`${a.at}|${a.id}` < `${b.at}|${b.id}` ? 1 : -1))[0];
    },
  };
}

function personRepo(working: MemoryState, check: () => void): PersonRepo {
  const active = () => working.people.filter((p) => p.deletedAt === null);
  return {
    insert: (row) => {
      check();
      if (working.people.some((p) => p.id === row.id)) {
        throw new Error("UNIQUE constraint failed: person.id");
      }
      if (row.userId !== null && working.people.some((p) => p.userId === row.userId)) {
        throw new Error("UNIQUE constraint failed: person.user_id");
      }
      working.people.push(row);
    },
    findByUserId: (userId) => {
      check();
      return active().find((p) => p.userId === userId);
    },
    listActive: () => {
      check();
      return [...active()].sort((a, b) =>
        `${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1,
      );
    },
    markLeft: (id, at) => {
      check();
      const index = working.people.findIndex((p) => p.id === id && p.deletedAt === null);
      const row = working.people[index];
      if (row === undefined) return false;
      working.people[index] = { ...row, deletedAt: at, updatedAt: at };
      return true;
    },
    listLogins: () => {
      check();
      return [...active()]
        .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1))
        .flatMap((p) =>
          p.userId !== null && working.users.includes(p.userId)
            ? [
                {
                  personId: p.id,
                  displayName: p.displayName,
                  email: working.emails[p.userId] ?? "",
                },
              ]
            : [],
        );
    },
  };
}

function setupLinkRepo(working: MemoryState, check: () => void): SetupLinkRepo {
  return {
    insert: (row) => {
      check();
      if (working.setupLinks.some((l) => l.id === row.id || l.tokenHash === row.tokenHash)) {
        throw new Error("UNIQUE constraint failed: setup_link");
      }
      working.setupLinks.push(row);
    },
    findByTokenHash: (tokenHash) => {
      check();
      return working.setupLinks.find((l) => l.tokenHash === tokenHash);
    },
    markUsed: (id, usedAt) => {
      check();
      const index = working.setupLinks.findIndex((l) => l.id === id && l.usedAt === null);
      const row = working.setupLinks[index];
      if (row === undefined) return false;
      working.setupLinks[index] = { ...row, usedAt };
      return true;
    },
    hasLive: (now) => {
      check();
      return working.setupLinks.some((l) => l.usedAt === null && l.expiresAt > now);
    },
    listLive: (now) => {
      check();
      return working.setupLinks
        .filter((l) => l.usedAt === null && l.expiresAt > now)
        .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1));
    },
    expire: (id, at) => {
      check();
      const index = working.setupLinks.findIndex((l) => l.id === id && l.usedAt === null);
      const row = working.setupLinks[index];
      if (row === undefined) return false;
      working.setupLinks[index] = { ...row, expiresAt: at };
      return true;
    },
  };
}

function userRepo(working: MemoryState, check: () => void): UserRepo {
  return {
    count: () => {
      check();
      return working.users.length;
    },
    enrolment: (userId) => {
      check();
      if (!working.users.includes(userId)) return undefined;
      return working.enrolments[userId] ?? { totp: false, passkeys: 0 };
    },
  };
}

function loginAttemptRepo(working: MemoryState, check: () => void): LoginAttemptRepo {
  return {
    insert: (row) => {
      check();
      working.loginAttempts.push(row);
    },
    listSince: (email, since) => {
      check();
      return working.loginAttempts
        .filter((a) => a.email === email && a.at >= since)
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    },
    deleteBefore: (before) => {
      check();
      working.loginAttempts = working.loginAttempts.filter((a) => a.at >= before);
    },
    deleteNewestFailure: (email) => {
      check();
      // Newest by `at`, then by insertion order (the SQLite adapter's `id`).
      let newest = -1;
      working.loginAttempts.forEach((a, index) => {
        if (a.email !== email || a.ok) return;
        const best = working.loginAttempts[newest];
        if (best === undefined || a.at >= best.at) newest = index;
      });
      if (newest >= 0) {
        working.loginAttempts = working.loginAttempts.filter((_, index) => index !== newest);
      }
    },
  };
}

function recoveryCodeRepo(working: MemoryState, check: () => void): RecoveryCodeRepo {
  return {
    insert: (row) => {
      check();
      if (working.recoveryCodes.some((c) => c.id === row.id)) {
        throw new Error("UNIQUE constraint failed: recovery_code.id");
      }
      working.recoveryCodes.push(row);
    },
    findUnused: (personId, codeHash) => {
      check();
      return working.recoveryCodes.find(
        (c) => c.personId === personId && c.codeHash === codeHash && c.usedAt === null,
      );
    },
    markUsed: (id, usedAt) => {
      check();
      const index = working.recoveryCodes.findIndex((c) => c.id === id && c.usedAt === null);
      const row = working.recoveryCodes[index];
      if (row === undefined) return false;
      working.recoveryCodes[index] = { ...row, usedAt };
      return true;
    },
    deleteUnused: (personId) => {
      check();
      const before = working.recoveryCodes.length;
      working.recoveryCodes = working.recoveryCodes.filter(
        (c) => !(c.personId === personId && c.usedAt === null),
      );
      return before - working.recoveryCodes.length;
    },
    deleteAll: (personId) => {
      check();
      const before = working.recoveryCodes.length;
      working.recoveryCodes = working.recoveryCodes.filter((c) => c.personId !== personId);
      return before - working.recoveryCodes.length;
    },
    counts: (personId) => {
      check();
      const mine = working.recoveryCodes.filter((c) => c.personId === personId);
      return { total: mine.length, unused: mine.filter((c) => c.usedAt === null).length };
    },
  };
}

function reEnrolmentLinkRepo(working: MemoryState, check: () => void): ReEnrolmentLinkRepo {
  return {
    insert: (row) => {
      check();
      if (working.reEnrolmentLinks.some((l) => l.id === row.id || l.tokenHash === row.tokenHash)) {
        throw new Error("UNIQUE constraint failed: re_enrolment_link");
      }
      working.reEnrolmentLinks.push(row);
    },
    findByTokenHash: (tokenHash) => {
      check();
      return working.reEnrolmentLinks.find((l) => l.tokenHash === tokenHash);
    },
    findById: (id) => {
      check();
      return working.reEnrolmentLinks.find((l) => l.id === id);
    },
    markUsed: (id, usedAt) => {
      check();
      const index = working.reEnrolmentLinks.findIndex((l) => l.id === id && l.usedAt === null);
      const row = working.reEnrolmentLinks[index];
      if (row === undefined) return false;
      working.reEnrolmentLinks[index] = { ...row, usedAt };
      return true;
    },
    listLive: (personId, now) => {
      check();
      return working.reEnrolmentLinks
        .filter((l) => l.personId === personId && l.usedAt === null && l.expiresAt > now)
        .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1));
    },
    expire: (id, at) => {
      check();
      const index = working.reEnrolmentLinks.findIndex((l) => l.id === id && l.usedAt === null);
      const row = working.reEnrolmentLinks[index];
      if (row === undefined) return false;
      working.reEnrolmentLinks[index] = { ...row, expiresAt: at };
      return true;
    },
  };
}

function credentialRepo(working: MemoryState, check: () => void): CredentialRepo {
  const enrolment = (userId: string) => working.enrolments[userId] ?? { totp: false, passkeys: 0 };
  return {
    deletePasskeys: (userId) => {
      check();
      const { passkeys } = enrolment(userId);
      working.enrolments = {
        ...working.enrolments,
        [userId]: { ...enrolment(userId), passkeys: 0 },
      };
      return passkeys;
    },
    disableTwoFactor: (userId) => {
      check();
      const { totp } = enrolment(userId);
      working.enrolments = {
        ...working.enrolments,
        [userId]: { ...enrolment(userId), totp: false },
      };
      return totp;
    },
    revokeSessions: (userId) => {
      check();
      const n = working.sessions[userId] ?? 0;
      working.sessions = { ...working.sessions, [userId]: 0 };
      return n;
    },
    setPasswordHash: (userId, passwordHash) => {
      check();
      if (!working.users.includes(userId)) return false;
      working.passwords = { ...working.passwords, [userId]: passwordHash };
      return true;
    },
  };
}

function visible(working: MemoryState, viewer: Viewer, row: ReviewItemRow): boolean {
  if (viewer.kind === "system") return true;
  const account =
    row.accountId === null ? undefined : working.accounts.find((a) => a.id === row.accountId);
  const accountOk =
    row.accountId === null || (account !== undefined && accountVisible(working, viewer, account));
  return accountOk && (row.personId === null || row.personId === viewer.personId);
}

function reviewItemRepo(working: MemoryState, check: () => void): ReviewItemRepo {
  const open = (dedupeKey: string) =>
    working.reviewItems.find((row) => row.dedupeKey === dedupeKey && row.resolvedAt === null);
  return {
    raise: (row) => {
      check();
      const existing = open(row.dedupeKey);
      if (existing !== undefined) return { item: existing, inserted: false };
      references(working.accounts, row.accountId, "review_item.account_id");
      working.reviewItems.push(row);
      return { item: row, inserted: true };
    },
    resolve: (dedupeKey, resolvedAt, resolution) => {
      check();
      const before = open(dedupeKey);
      if (before === undefined) return undefined;
      const after = { ...before, resolvedAt, resolution };
      working.reviewItems[working.reviewItems.indexOf(before)] = after;
      return { before, after };
    },
    countOpenForEntity: (entityRef) => {
      check();
      return working.reviewItems.filter(
        (row) => row.entityRef === entityRef && row.resolvedAt === null,
      ).length;
    },
    resolveOpenForEntity: (entityRef, resolvedAt, resolution) => {
      check();
      return working.reviewItems
        .filter((row) => row.entityRef === entityRef && row.resolvedAt === null)
        .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1))
        .map((before) => {
          const after = { ...before, resolvedAt, resolution };
          working.reviewItems[working.reviewItems.indexOf(before)] = after;
          return { before, after };
        });
    },
    listOpenFor: (viewer) => {
      if (viewer === undefined || viewer === null) throw new TypeError("a viewer is required");
      check();
      return working.reviewItems
        .filter((row) => row.resolvedAt === null && visible(working, viewer, row))
        .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1));
    },
    deleteForAccount: (accountId) => {
      check();
      const before = working.reviewItems.length;
      working.reviewItems = working.reviewItems.filter((row) => row.accountId !== accountId);
      return before - working.reviewItems.length;
    },
    deleteForPerson: (personId) => {
      check();
      const before = working.reviewItems.length;
      working.reviewItems = working.reviewItems.filter((row) => row.personId !== personId);
      return before - working.reviewItems.length;
    },
  };
}

function accountVisible(working: MemoryState, viewer: Viewer, account: AccountRow): boolean {
  if (working.deleted.has(account.id)) return false;
  if (viewer.kind === "system" || !account.isPrivate) return true;
  return working.accountOwners.some(
    (owner) => owner.accountId === account.id && owner.personId === viewer.personId,
  );
}

function accountRepo(working: MemoryState, check: () => void): AccountRepo {
  return {
    insert: (row, owners) => {
      check();
      checked(oneOf(ACCOUNT_TYPES, row.type), "account_type");
      references(working.institutions, row.institutionId, "account.institution_id");
      requireOwnersInsertable(working, owners, () => true, [row.id]);
      working.accounts.push(row);
      working.accountOwners.push(...owners);
    },
    findVisible: (viewer, id) => {
      if (viewer === undefined || viewer === null) throw new TypeError("a viewer is required");
      check();
      const account = working.accounts.find((row) => row.id === id);
      return account !== undefined && accountVisible(working, viewer, account)
        ? account
        : undefined;
    },
    list: (viewer) => {
      requireViewer(viewer);
      check();
      return working.accounts
        .filter((row) => accountVisible(working, viewer, row))
        .sort((a, b) => byText(`${a.createdAt}|${a.id}`, `${b.createdAt}|${b.id}`));
    },
    any: () => {
      check();
      return working.accounts.length > 0;
    },
    owners: (accountId) => {
      check();
      return working.accountOwners
        .filter((owner) => owner.accountId === accountId)
        .sort((a, b) => byText(`${a.createdAt}|${a.personId}`, `${b.createdAt}|${b.personId}`));
    },
    update: (row) => {
      check();
      const at = working.accounts.findIndex((a) => a.id === row.id && !working.deleted.has(a.id));
      const before = working.accounts[at];
      if (before === undefined) throw new Error(`Account ${row.id} not found`);
      references(working.institutions, row.institutionId, "account.institution_id");
      working.accounts[at] = {
        ...before,
        name: row.name,
        isPrivate: row.isPrivate,
        institutionId: row.institutionId,
        openedOn: row.openedOn,
        closedOn: row.closedOn,
        isSavings: row.isSavings,
        updatedAt: row.updatedAt,
      };
    },
    replaceOwners: (accountId, owners) => {
      check();
      // As SQLite: the old owners go first, so a person kept is not a duplicate.
      requireOwnersInsertable(working, owners, (owner) => owner.accountId !== accountId);
      working.accountOwners = [
        ...working.accountOwners.filter((owner) => owner.accountId !== accountId),
        ...owners,
      ];
    },
    hasSplitForOthers: (accountId, ownerId) => {
      check();
      const live = new Set(
        working.transactions
          .filter((t) => t.accountId === accountId && !working.deleted.has(t.id))
          .map((t) => t.id as string),
      );
      return working.splits.some((s) => live.has(s.transactionId) && s.beneficiary !== ownerId);
    },
    scopedReferences: (accountId) => {
      check();
      // Mirror of the SQL: live transactions only; a soft-deleted scoped row still counts.
      const txns = working.transactions.filter(
        (t) => t.accountId === accountId && !working.deleted.has(t.id),
      );
      const txnIds = new Set(txns.map((t) => t.id as string));
      const splits = working.splits.filter((s) => txnIds.has(s.transactionId));
      const splitIds = new Set(splits.map((s) => s.id as string));
      const listed = (
        rows: readonly { id: string; name: string; scopePersonId: string | null }[],
        used: Set<string>,
      ): ScopedReference[] =>
        rows
          .filter((row) => row.scopePersonId !== null && used.has(row.id))
          .map((row) => ({ id: row.id, name: row.name }))
          .sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id));
      return {
        payees: listed(
          working.payees,
          new Set(txns.flatMap((t) => (t.payeeId === null ? [] : [t.payeeId as string]))),
        ),
        tags: listed(
          working.tags,
          new Set(
            working.splitTags.filter((t) => splitIds.has(t.splitId)).map((t) => t.tagId as string),
          ),
        ),
        activities: listed(
          working.activities,
          new Set(splits.flatMap((s) => (s.activityId === null ? [] : [s.activityId as string]))),
        ),
      };
    },
    ownedBy: (personId) => {
      check();
      const owned = new Set<string>(
        working.accountOwners.filter((o) => o.personId === personId).map((o) => o.accountId),
      );
      return working.accounts
        .filter((row) => owned.has(row.id))
        .sort((a, b) => byText(`${a.createdAt}|${a.id}`, `${b.createdAt}|${b.id}`))
        .map((row): OwnedAccount => ({ row, deleted: working.deleted.has(row.id) }));
    },
    deleteRows: (accountId) => {
      check();
      // As SQLite: foreign keys without cascade, so what still points at the account refuses.
      const scopedOrigins = [
        ...working.payees,
        ...working.payeeAliases,
        ...working.tags,
        ...working.activities,
      ];
      if (
        working.transactions.some((t) => t.accountId === accountId) ||
        working.balanceSnapshots.some((s) => s.accountId === accountId) ||
        working.reviewItems.some((r) => r.accountId === accountId) ||
        scopedOrigins.some((row) => working.origins.get(row.id) === accountId)
      ) {
        throw new Error("FOREIGN KEY constraint failed: account.id");
      }
      working.accountOwners = working.accountOwners.filter((o) => o.accountId !== accountId);
      working.accounts = working.accounts.filter((a) => a.id !== accountId);
      working.deleted.delete(accountId);
    },
  };
}

/** Mirror of the SQL `hidden` expression of `visibleTxn` (AD-4). */
function nameHiddenFor(
  viewer: Viewer,
  row: Pick<TransactionRow, "nameHiddenUntil" | "nameHiddenBy">,
  today: string,
): boolean {
  if (viewer.kind === "system") return false;
  if (row.nameHiddenUntil === null || row.nameHiddenUntil.slice(0, 10) <= today) return false;
  return row.nameHiddenBy !== viewer.personId;
}

/** Mirror of the SQL transfer label: the counterpart sits in another person's private account. */
function transferLabelFor(
  working: MemoryState,
  viewer: Viewer,
  row: TransactionRow,
): string | null {
  if (viewer.kind === "system" || row.transferGroupId === null) return null;
  const counterparts = working.transactions
    .filter(
      (t) =>
        t.transferGroupId === row.transferGroupId && t.id !== row.id && !working.deleted.has(t.id),
    )
    .map((t) => working.accounts.find((a) => a.id === t.accountId))
    .filter(
      (a): a is AccountRow =>
        a !== undefined &&
        !working.deleted.has(a.id) &&
        a.isPrivate &&
        !accountVisible(working, viewer, a),
    );
  for (const account of counterparts) {
    const owner = working.accountOwners
      .filter((o) => o.accountId === account.id)
      .sort((x, y) => byText(`${x.createdAt}|${x.personId}`, `${y.createdAt}|${y.personId}`))[0];
    const name = working.people.find((p) => p.id === owner?.personId)?.displayName;
    if (name !== undefined)
      return `${row.amountCents >= 0 ? "Transfer from" : "Transfer to"} ${name}`;
  }
  return null;
}

function requireDay(today: string, what: string): void {
  if (typeof today !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new TypeError(`${what}: today must be a YYYY-MM-DD string`);
  }
}

const SOURCE_COLUMNS = [
  ["categorySource", "split_category_source"],
  ["activitySource", "split_activity_source"],
  ["taxCategorySource", "split_tax_category_source"],
  ["beneficiarySource", "split_beneficiary_source"],
  ["deductibleBpSource", "split_deductible_bp_source"],
] as const;

/** Mirror of the CHECK constraints on `split`. */
function checkSplit(s: SplitRow): void {
  if (s.deductibleBp !== null && (s.deductibleBp < 0 || s.deductibleBp > 10_000)) {
    throw new Error("CHECK constraint failed: split_deductible_bp");
  }
  for (const [key, name] of SOURCE_COLUMNS) {
    const value = s[key];
    if (value !== null && !(SPLIT_SOURCES as readonly string[]).includes(value)) {
      throw new Error(`CHECK constraint failed: ${name}`);
    }
  }
  if (s.beneficiary.length === 0) throw new Error("CHECK constraint failed: split_beneficiary");
}

/** The foreign keys of a `split` row's classification columns. */
function requireSplitReferences(working: MemoryState, s: SplitRow): void {
  references(working.categories, s.categoryId, "split.category_id");
  references(working.activities, s.activityId, "split.activity_id");
  references(working.taxCategories, s.taxCategoryId, "split.tax_category_id");
}

/** The primary key of `split`: `fresh` rows must not reuse an ID in the table or each other. */
function requireSplitIdsFree(working: MemoryState, fresh: readonly SplitRow[]): void {
  const taken = new Set<string>(working.splits.map((s) => s.id));
  for (const s of fresh) {
    if (taken.has(s.id)) throw uniqueViolation("split.id");
    taken.add(s.id);
  }
}

function transactionRepo(working: MemoryState, check: () => void): TransactionRepo {
  const withSplits = <T extends { readonly id: string }>(row: T): T & { splits: SplitRow[] } => ({
    ...row,
    splits: working.splits
      .filter((split) => split.transactionId === row.id)
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  });
  const view = (viewer: Viewer, row: TransactionRow, today: string): VisibleTransaction => {
    const hidden = nameHiddenFor(viewer, row, today);
    const payee =
      row.payeeId === null || hidden
        ? undefined
        : working.payees.find(
            (p) =>
              p.id === row.payeeId &&
              (viewer.kind === "system" ||
                p.scopePersonId === null ||
                p.scopePersonId === viewer.personId),
          );
    return withSplits({
      ...row,
      descriptionRaw: hidden ? null : row.descriptionRaw,
      fingerprint: hidden ? null : row.fingerprint,
      externalId: hidden ? null : row.externalId,
      payeeId: payee === undefined ? null : row.payeeId,
      payeeName: payee?.name ?? null,
      logoAttachmentId: payee?.logoAttachmentId ?? null,
      nameHidden: hidden,
      transferLabel: transferLabelFor(working, viewer, row),
      splits: [],
    });
  };
  const visibleRows = (viewer: Viewer) => {
    const visibleIds = new Set(
      working.accounts.filter((a) => accountVisible(working, viewer, a)).map((a) => a.id),
    );
    return working.transactions.filter(
      (row) => visibleIds.has(row.accountId) && !working.deleted.has(row.id),
    );
  };
  /** Rows of `visibleRows` a filter keeps, in list order (mirror of `filterConditions`). */
  const filtered = (viewer: Viewer, today: string, f: TransactionFilter): TransactionRow[] => {
    const tagVisible =
      f.tagId === undefined
        ? undefined
        : tagRepo(working, check)
            .list(viewer)
            .some((t) => t.id === f.tagId);
    return visibleRows(viewer)
      .filter((row) => {
        const splits = working.splits.filter((s) => s.transactionId === row.id);
        if (f.accountId !== undefined && row.accountId !== f.accountId) return false;
        if (f.from !== undefined && row.postedOn < f.from) return false;
        if (f.to !== undefined && row.postedOn > f.to) return false;
        if (f.categoryId !== undefined && !splits.some((s) => s.categoryId === f.categoryId)) {
          return false;
        }
        if (f.tagId !== undefined) {
          const carries = splits.some((s) =>
            working.splitTags.some((st) => st.splitId === s.id && st.tagId === f.tagId),
          );
          if (!tagVisible || !carries) return false;
        }
        if (f.payeeId !== undefined && view(viewer, row, today).payeeId !== f.payeeId) {
          return false;
        }
        const size = Math.abs(row.amountCents);
        if (f.minCents !== undefined && size < f.minCents) return false;
        if (f.maxCents !== undefined && size > f.maxCents) return false;
        if (f.type === "in" && row.amountCents <= 0) return false;
        if (f.type === "out" && row.amountCents >= 0) return false;
        if (f.uncategorised === true && !splits.some((s) => s.categoryId === null)) return false;
        if (f.transfers === true && row.transferGroupId === null) return false;
        if (f.hidden === true && !nameHiddenFor(viewer, row, today)) return false;
        return true;
      })
      .sort((a, b) => byText(`${b.postedOn}|${b.id}`, `${a.postedOn}|${a.id}`));
  };
  /** After `cursor` in list order (older, then lower `id`). */
  const follows = (r: TransactionRow, c: TransactionCursor) =>
    byText(`${r.postedOn}|${r.id}`, `${c.postedOn}|${c.id}`) < 0;
  /** Before `cursor` in list order (newer, then higher `id`). */
  const precedes = (r: TransactionRow, c: TransactionCursor) =>
    byText(`${r.postedOn}|${r.id}`, `${c.postedOn}|${c.id}`) > 0;
  return {
    insert: (row, splits) => {
      check();
      // SQLite's order for each statement: CHECK, then UNIQUE, then foreign keys.
      checkTransaction(row);
      // Deleted lines count: the row stays so the same line is not imported again.
      for (const other of working.transactions) {
        if (other.accountId !== row.accountId) continue;
        if (other.fingerprint === row.fingerprint) {
          throw uniqueViolation("transaction.account_id, transaction.fingerprint");
        }
        if (row.externalId !== null && other.externalId === row.externalId) {
          throw uniqueViolation("transaction.account_id, transaction.external_id");
        }
      }
      references(working.accounts, row.accountId, "transaction.account_id");
      references(working.payees, row.payeeId, "transaction.payee_id");
      references(working.people, row.performedBy, "transaction.performed_by");
      references(working.transferGroups, row.transferGroupId, "transaction.transfer_group_id");
      references(working.people, row.nameHiddenBy, "transaction.name_hidden_by");
      for (const s of splits) checkSplit(s);
      requireSplitIdsFree(working, splits);
      for (const s of splits) requireSplitReferences(working, s);
      working.transactions.push(row);
      working.splits.push(...splits);
    },
    findVisible: (viewer, id, today) => {
      requireViewer(viewer);
      requireDay(today, "visibleTxn");
      check();
      const row = visibleRows(viewer).find((r) => r.id === id);
      return row === undefined ? undefined : view(viewer, row, today);
    },
    findStored: (viewer, id) => {
      requireViewer(viewer);
      check();
      const row = visibleRows(viewer).find((r) => r.id === id);
      return row === undefined ? undefined : withSplits({ ...row });
    },
    update: (viewer, change) => {
      requireViewer(viewer);
      check();
      const row = visibleRows(viewer).find((r) => r.id === change.id);
      if (row === undefined) return false;
      checked(isDayFormat(change.postedOn), "transaction_posted_on");
      working.transactions[working.transactions.indexOf(row)] = {
        ...row,
        postedOn: change.postedOn,
        amountCents: change.amountCents,
        descriptionRaw: change.descriptionRaw ?? row.descriptionRaw,
        notes: change.notes,
        updatedAt: change.updatedAt,
      };
      return true;
    },
    updateSplitAmount: (splitId, amountCents, at) => {
      check();
      const index = working.splits.findIndex((s) => s.id === splitId);
      const row = working.splits[index];
      if (row === undefined) return false;
      working.splits[index] = { ...row, amountCents, updatedAt: at };
      return true;
    },
    replaceSplits: (transactionId, splits) => {
      check();
      for (const s of splits) {
        if (s.transactionId !== transactionId) {
          throw new Error(`Split ${s.id} belongs to another transaction`);
        }
      }
      for (const s of splits) checkSplit(s);
      // As SQLite: a split not already on this transaction is inserted, so a split ID that
      // another transaction holds (or that the list repeats) is a primary key violation.
      const mine = new Set<string>(
        working.splits.filter((s) => s.transactionId === transactionId).map((s) => s.id),
      );
      requireSplitIdsFree(
        working,
        splits.filter((s) => !mine.has(s.id)),
      );
      for (const s of splits) requireSplitReferences(working, s);
      const keep = new Set<string>(splits.map((s) => s.id));
      const gone = new Set([...mine].filter((id) => !keep.has(id)));
      working.splitTags = working.splitTags.filter((t) => !gone.has(t.splitId));
      working.splits = working.splits
        .filter((s) => !gone.has(s.id))
        .map((s) => {
          if (s.transactionId !== transactionId) return s;
          const next = splits.find((n) => n.id === s.id);
          return next === undefined ? s : { ...next, createdAt: s.createdAt };
        });
      working.splits.push(...splits.filter((s) => !mine.has(s.id)));
    },
    updateSplit: (row) => {
      check();
      checkSplit(row);
      requireSplitReferences(working, row);
      const index = working.splits.findIndex((s) => s.id === row.id);
      const before = working.splits[index];
      if (before === undefined) return false;
      working.splits[index] = {
        ...row,
        transactionId: before.transactionId,
        createdAt: before.createdAt,
      };
      return true;
    },
    setNeedsReview: (id, value, at) => {
      check();
      const row = working.transactions.find((r) => r.id === id);
      if (row === undefined || row.needsReview === value) return false;
      working.transactions[working.transactions.indexOf(row)] = {
        ...row,
        needsReview: value,
        updatedAt: at,
      };
      return true;
    },
    setNameHidden: (viewer, id, by, until, at) => {
      requireViewer(viewer);
      check();
      const row = visibleRows(viewer).find((r) => r.id === id);
      if (row === undefined) return false;
      const person = by as TransactionRow["nameHiddenBy"];
      references(working.people, person, "transaction.name_hidden_by");
      working.transactions[working.transactions.indexOf(row)] = {
        ...row,
        nameHiddenBy: person,
        nameHiddenUntil: until,
        updatedAt: at,
      };
      return true;
    },
    setTransferGroup: (ids, groupId, at) => {
      check();
      const group = groupId as TransactionRow["transferGroupId"];
      references(working.transferGroups, group, "transaction.transfer_group_id");
      let changed = 0;
      for (const id of ids) {
        const row = working.transactions.find((r) => r.id === id);
        if (row === undefined) continue;
        working.transactions[working.transactions.indexOf(row)] = {
          ...row,
          transferGroupId: group,
          updatedAt: at,
        };
        changed += 1;
      }
      return changed;
    },
    softDelete: (viewer, id, at) => {
      requireViewer(viewer);
      check();
      const row = visibleRows(viewer).find((r) => r.id === id);
      if (row === undefined) return false;
      working.deleted.add(id);
      working.transactions[working.transactions.indexOf(row)] = { ...row, updatedAt: at };
      return true;
    },
    hidingsBy: (personId) => {
      check();
      return working.transactions
        .filter((t) => t.nameHiddenBy === personId)
        .sort((a, b) => byText(a.id, b.id))
        .map((row) => withSplits({ ...row }));
    },
    clearNameHidden: (ids, at) => {
      check();
      const wanted = new Set<string>(ids);
      let changed = 0;
      working.transactions = working.transactions.map((row) => {
        if (!wanted.has(row.id)) return row;
        changed += 1;
        return { ...row, nameHiddenBy: null, nameHiddenUntil: null, updatedAt: at };
      });
      return changed;
    },
    clearScopedPayees: (personId) => {
      check();
      const mine = new Set<string>(
        working.payees.filter((p) => p.scopePersonId === personId).map((p) => p.id),
      );
      let changed = 0;
      working.transactions = working.transactions.map((row) => {
        if (row.payeeId === null || !mine.has(row.payeeId)) return row;
        changed += 1;
        return { ...row, payeeId: null };
      });
      return changed;
    },
    unlinkGroup: (groupId) => {
      check();
      let changed = 0;
      working.transactions = working.transactions.map((row) => {
        if (row.transferGroupId !== groupId) return row;
        changed += 1;
        return { ...row, transferGroupId: null };
      });
      return changed;
    },
    deleteForAccount: (accountId) => {
      check();
      const gone = new Set<string>(
        working.transactions.filter((t) => t.accountId === accountId).map((t) => t.id),
      );
      const goneSplits = new Set<string>(
        working.splits.filter((s) => gone.has(s.transactionId)).map((s) => s.id),
      );
      working.splitTags = working.splitTags.filter((t) => !goneSplits.has(t.splitId));
      working.splits = working.splits.filter((s) => !gone.has(s.transactionId));
      working.transactions = working.transactions.filter((t) => !gone.has(t.id));
      for (const id of gone) working.deleted.delete(id);
    },
    latestPostedOn: (viewer, accountId) => {
      requireViewer(viewer);
      check();
      let latest: string | undefined;
      for (const row of visibleRows(viewer)) {
        if (row.accountId !== accountId) continue;
        if (latest === undefined || row.postedOn > latest) latest = row.postedOn;
      }
      return latest;
    },
    listManualAfter: (viewer, accountId, day, limit) => {
      requireViewer(viewer);
      check();
      const after = visibleRows(viewer).filter(
        (r) => r.accountId === accountId && r.postedOn > day,
      );
      const isManual = (r: TransactionRow) => r.importId === null && r.externalId === null;
      const manual = after
        .filter(isManual)
        .sort((a, b) => byText(`${a.postedOn}|${a.id}`, `${b.postedOn}|${b.id}`))
        .slice(0, limit)
        .map((r) => ({ id: r.id as string, postedOn: r.postedOn }));
      return { manual, importedCount: after.filter((r) => !isManual(r)).length };
    },
    listVisible: (viewer, today) => {
      requireViewer(viewer);
      requireDay(today, "visibleTxn");
      check();
      return visibleRows(viewer)
        .sort((a, b) => byText(`${b.postedOn}|${b.id}`, `${a.postedOn}|${a.id}`))
        .map((row) => view(viewer, row, today));
    },
    listPage: (viewer, today, filter, at, limit) => {
      requireViewer(viewer);
      requireDay(today, "visibleTxn");
      check();
      const rows = filtered(viewer, today, filter);
      if ("after" in at) {
        return rows
          .filter((r) => follows(r, at.after))
          .slice(0, limit)
          .map((row) => view(viewer, row, today));
      }
      if ("before" in at) {
        const earlier = rows.filter((r) => precedes(r, at.before));
        return earlier
          .slice(Math.max(0, earlier.length - limit))
          .map((row) => view(viewer, row, today));
      }
      return rows.slice(at.offset, at.offset + limit).map((row) => view(viewer, row, today));
    },
    summarise: (viewer, today, filter) => {
      requireViewer(viewer);
      requireDay(today, "visibleTxn");
      check();
      const rows = filtered(viewer, today, filter);
      let inCents = 0;
      let outCents = 0;
      for (const r of rows) {
        if (r.amountCents > 0) inCents += r.amountCents;
        else if (r.amountCents < 0) outCents -= r.amountCents;
      }
      return { count: rows.length, inCents, outCents };
    },
    countBefore: (viewer, today, filter, cursor) => {
      requireViewer(viewer);
      requireDay(today, "visibleTxn");
      check();
      return filtered(viewer, today, filter).filter((r) => precedes(r, cursor)).length;
    },
    dayNets: (viewer, today, filter, days) => {
      requireViewer(viewer);
      requireDay(today, "visibleTxn");
      check();
      const wanted = new Set(days);
      const nets: Record<string, number> = {};
      for (const r of filtered(viewer, today, filter)) {
        if (wanted.has(r.postedOn)) nets[r.postedOn] = (nets[r.postedOn] ?? 0) + r.amountCents;
      }
      return nets;
    },
  };
}

/** Mirror of `visibleAudit` and `auditHiddenUntil` (AD-3, AD-4). */
function auditVisible(working: MemoryState, viewer: Viewer, row: AuditRow): boolean {
  if (viewer.kind === "system") return true;
  const account =
    row.accountId === null ? undefined : working.accounts.find((a) => a.id === row.accountId);
  const accountOk =
    row.accountId === null || (account !== undefined && accountVisible(working, viewer, account));
  return accountOk && (row.personId === null || row.personId === viewer.personId);
}

function auditHiddenUntil(
  working: MemoryState,
  viewer: Viewer,
  row: AuditRow,
  today: string,
): string | null {
  if (viewer.kind === "system" || row.entity !== "transaction") return null;
  const hide = (until: unknown, by: unknown): string | null => {
    if (typeof until !== "string" || until.slice(0, 10) <= today) return null;
    return by === viewer.personId ? null : until;
  };
  const candidates: (string | null)[] = [];
  const txn = working.transactions.find((t) => t.id === row.entityId);
  candidates.push(txn === undefined ? null : hide(txn.nameHiddenUntil, txn.nameHiddenBy));
  for (const json of [row.before, row.after]) {
    const state = parseJson(json) as Record<string, unknown> | null;
    candidates.push(
      state === null || typeof state !== "object"
        ? null
        : hide(state.nameHiddenUntil, state.nameHiddenBy),
    );
  }
  const found = candidates.filter((c): c is string => c !== null);
  return found.length === 0 ? null : found.reduce((a, b) => (a >= b ? a : b));
}

/** `JSON.parse`, or null when `json` is null or not valid JSON (SQLite's `json_valid` guard). */
function parseJson(json: string | null): unknown {
  if (json === null) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** The `owners` list of an account's audit JSON, or undefined when there is none (mirror of the SQL adapter). */
function ownersOf(json: string | null): AuditedOwner[] | undefined {
  const owners = (parseJson(json) as { owners?: unknown } | null)?.owners;
  if (!Array.isArray(owners)) return undefined;
  const out: AuditedOwner[] = [];
  for (const owner of owners as { personId?: unknown; shareBp?: unknown }[]) {
    if (typeof owner?.personId !== "string" || typeof owner.shareBp !== "number") return undefined;
    out.push({ personId: owner.personId, shareBp: owner.shareBp });
  }
  return out;
}

/** The keys the audit scrub nulls while a name is hidden (mirror of `json_replace`). */
const HIDDEN_AUDIT_KEYS = ["descriptionRaw", "payeeId", "fingerprint", "externalId"] as const;

function auditRepo(working: MemoryState, check: () => void, failAudit: () => boolean) {
  // Mirror of the SQL scrub: JSON that is not valid comes back null (fail closed); while hidden,
  // the name keys present are nulled and none is added; a payee the viewer may not see (the
  // payee scope rule of `visibleTxn`) is nulled the same way.
  const payeeVisible = (viewer: Viewer, id: string): boolean =>
    viewer.kind === "system" ||
    working.payees.some(
      (p) => p.id === id && (p.scopePersonId === null || p.scopePersonId === viewer.personId),
    );
  const scrub = (viewer: Viewer, json: string | null, hidden: boolean): string | null => {
    if (json === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return json;
    const out: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    if (hidden) {
      for (const key of HIDDEN_AUDIT_KEYS) if (key in out) out[key] = null;
    } else if (typeof out.payeeId === "string" && !payeeVisible(viewer, out.payeeId)) {
      out.payeeId = null;
    } else {
      return json;
    }
    return JSON.stringify(out);
  };
  return {
    append: (row: AuditRow) => {
      check();
      if (failAudit()) throw new Error("audit append failed");
      working.audit.push(row);
    },
    scopeToPerson: (accountId: string, personId: string): void => {
      check();
      // Mirror of the SQL UPDATE: rows are replaced (they are readonly), only person_id changes.
      const order = (row: AuditRow) => `${row.at}|${row.id}`;
      const flip = working.audit
        .filter((row) => {
          if (row.accountId !== accountId || row.entity !== "account") return false;
          if (row.action !== "set_privacy") return false;
          // A transition only: a redundant private → private switch does not restart the era.
          const before = parseJson(row.before) as Record<string, unknown> | null;
          const after = parseJson(row.after) as Record<string, unknown> | null;
          return (
            before !== null &&
            typeof before === "object" &&
            before.isPrivate === false &&
            after !== null &&
            typeof after === "object" &&
            after.isPrivate === true
          );
        })
        .reduce<AuditRow | undefined>(
          (latest, row) =>
            latest === undefined || byText(order(row), order(latest)) > 0 ? row : latest,
          undefined,
        );
      working.audit = working.audit.map((row) =>
        row.accountId === accountId &&
        row.personId === null &&
        (flip === undefined || byText(order(row), order(flip)) > 0)
          ? { ...row, personId }
          : row,
      );
    },
    deleteForAccount: (accountId: string): number => {
      check();
      const before = working.audit.length;
      working.audit = working.audit.filter((row) => row.accountId !== accountId);
      return before - working.audit.length;
    },
    deleteForPerson: (personId: string): number => {
      check();
      const before = working.audit.length;
      working.audit = working.audit.filter((row) => row.personId !== personId);
      return before - working.audit.length;
    },
    ownerChanges: (viewer: Viewer, accountId: string): OwnerChange[] => {
      requireViewer(viewer);
      check();
      return working.audit
        .filter(
          (row) =>
            row.accountId === accountId &&
            row.entity === "account" &&
            row.action === "update" &&
            auditVisible(working, viewer, row),
        )
        .sort((a, b) => byText(`${a.at}|${a.id}`, `${b.at}|${b.id}`))
        .flatMap((row) => {
          const before = ownersOf(row.before);
          const after = ownersOf(row.after);
          return before === undefined || after === undefined
            ? []
            : [{ id: row.id, at: row.at, actor: row.actor, before, after }];
        });
    },
    listVisible: (viewer: Viewer, today: string): AuditView[] => {
      requireViewer(viewer);
      requireDay(today, "auditHiddenUntil");
      check();
      return working.audit
        .filter((row) => auditVisible(working, viewer, row))
        .sort((a, b) => byText(`${a.at}|${a.id}`, `${b.at}|${b.id}`))
        .map((row) => {
          const hiddenUntil = auditHiddenUntil(working, viewer, row, today);
          const hidden = hiddenUntil !== null;
          return {
            ...row,
            before: scrub(viewer, row.before, hidden),
            after: scrub(viewer, row.after, hidden),
            hiddenUntil,
          };
        });
    },
  };
}

/** Throws SQLite's CHECK error, named as the schema names the constraint, unless `ok`. */
function checked(ok: boolean, name: string): void {
  if (!ok) throw new Error(`CHECK constraint failed: ${name}`);
}

const oneOf = (list: readonly string[], value: string) => list.includes(value);

/** SQLite's `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`. */
const isDayFormat = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function assertGroupKind(kind: string): void {
  checked(oneOf(CATEGORY_GROUP_KINDS, kind), "category_group_kind");
}

function assertMatchKind(kind: string): void {
  checked(oneOf(["exact", "contains", "prefix", "regex"], kind), "payee_alias_match_kind");
}

/** Mirror of the CHECK constraints on `transaction`. */
function checkTransaction(row: Pick<TransactionRow, "status" | "postedOn">): void {
  checked(row.status === "pending" || row.status === "posted", "transaction_status");
  checked(isDayFormat(row.postedOn), "transaction_posted_on");
}

/**
 * Mirror of inserting `account_owner` rows, in SQLite's order: the share CHECK, the primary key
 * (account, person) against the owners that stay (`keep`) and each other, then the foreign
 * keys. `alsoAccounts` are accounts inserted in the same statement batch.
 */
function requireOwnersInsertable(
  working: MemoryState,
  owners: readonly AccountOwnerRow[],
  keep: (owner: AccountOwnerRow) => boolean,
  alsoAccounts: readonly string[] = [],
): void {
  for (const owner of owners) {
    checked(owner.shareBp >= 1 && owner.shareBp <= 10_000, "account_owner_share_bp");
  }
  const taken = new Set(
    working.accountOwners.filter(keep).map((o) => `${o.accountId}|${o.personId}`),
  );
  for (const owner of owners) {
    const key = `${owner.accountId}|${owner.personId}`;
    if (taken.has(key)) {
      throw uniqueViolation("account_owner.account_id, account_owner.person_id");
    }
    taken.add(key);
  }
  for (const owner of owners) {
    if (!alsoAccounts.includes(owner.accountId)) {
      references(working.accounts, owner.accountId, "account_owner.account_id");
    }
    references(working.people, owner.personId, "account_owner.person_id");
  }
}

const uniqueViolation = (what: string) => new Error(`UNIQUE constraint failed: ${what}`);

/** Throws SQLite's foreign key error unless `id` is null or among `rows`. */
function references(rows: readonly { readonly id: string }[], id: string | null, what: string) {
  if (id !== null && !rows.some((row) => row.id === id)) {
    throw new Error(`FOREIGN KEY constraint failed: ${what}`);
  }
}

function requireViewer(viewer: Viewer | undefined): asserts viewer is Viewer {
  if (viewer === undefined || viewer === null) throw new TypeError("a viewer is required");
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const inScope = (viewer: Viewer, row: { readonly scopePersonId: string | null }) =>
  viewer.kind === "system" || row.scopePersonId === null || row.scopePersonId === viewer.personId;

function institutionRepo(working: MemoryState, check: () => void): InstitutionRepo {
  const live = () => working.institutions.filter((row) => !working.deleted.has(row.id));
  return {
    insert: (row) => {
      check();
      checked(oneOf(INSTITUTION_KINDS, row.kind), "institution_kind");
      working.institutions.push(row);
    },
    find: (viewer, id) => {
      requireViewer(viewer);
      check();
      return live().find((row) => row.id === id);
    },
    list: (viewer) => {
      requireViewer(viewer);
      check();
      return live().sort((a, b) => byText(`${a.name}|${a.id}`, `${b.name}|${b.id}`));
    },
    update: (row) => {
      check();
      const at = working.institutions.findIndex(
        (r) => r.id === row.id && !working.deleted.has(r.id),
      );
      const before = working.institutions[at];
      if (before === undefined) throw new Error(`Institution ${row.id} not found`);
      checked(oneOf(INSTITUTION_KINDS, row.kind), "institution_kind");
      working.institutions[at] = {
        ...before,
        name: row.name,
        kind: row.kind,
        websiteUrl: row.websiteUrl,
        updatedAt: row.updatedAt,
      };
    },
    softDelete: (id, at) => {
      check();
      if (!live().some((row) => row.id === id)) return false;
      working.deleted.add(id);
      working.institutions = working.institutions.map((row) =>
        row.id === id ? { ...row, updatedAt: at } : row,
      );
      return true;
    },
  };
}

function balanceSnapshotRepo(working: MemoryState, check: () => void): BalanceSnapshotRepo {
  return {
    insert: (row) => {
      check();
      checked(oneOf(BALANCE_SOURCES, row.source), "balance_snapshot_source");
      checked(isDayFormat(row.asOf), "balance_snapshot_as_of");
      references(working.accounts, row.accountId, "balance_snapshot.account_id");
      working.balanceSnapshots.push(row);
    },
    listVisible: (viewer, accountId) => {
      requireViewer(viewer);
      check();
      const account = working.accounts.find((row) => row.id === accountId);
      if (account === undefined || !accountVisible(working, viewer, account)) return [];
      return working.balanceSnapshots
        .filter((row) => row.accountId === accountId)
        .sort((a, b) => byText(`${b.asOf}|${b.id}`, `${a.asOf}|${a.id}`));
    },
    deleteForAccount: (accountId) => {
      check();
      const before = working.balanceSnapshots.length;
      working.balanceSnapshots = working.balanceSnapshots.filter((s) => s.accountId !== accountId);
      return before - working.balanceSnapshots.length;
    },
    balanceAsOf: (viewer, accountId, date) => {
      requireViewer(viewer);
      check();
      const account = working.accounts.find((row) => row.id === accountId);
      if (account === undefined || !accountVisible(working, viewer, account)) return undefined;
      // Mirror of `balance.ts` in packages/db: the same snapshot pick and window.
      const snapshot = working.balanceSnapshots
        .filter((row) => row.accountId === accountId && row.asOf <= date)
        .sort((a, b) =>
          byText(`${b.asOf}|${b.createdAt}|${b.id}`, `${a.asOf}|${a.createdAt}|${a.id}`),
        )[0];
      const after = snapshot?.asOf ?? "";
      return (
        (snapshot?.balanceCents ?? 0) +
        working.transactions
          .filter(
            (t) =>
              t.accountId === accountId &&
              !working.deleted.has(t.id) &&
              t.postedOn <= date &&
              t.postedOn > after,
          )
          .reduce((sum, t) => sum + t.amountCents, 0)
      );
    },
  };
}

function transferGroupRepo(working: MemoryState, check: () => void): TransferGroupRepo {
  return {
    insert: (row) => {
      check();
      checked(oneOf(TRANSFER_MATCHES, row.matchedBy), "transfer_group_matched_by");
      working.transferGroups.push(row);
    },
    find: (viewer, id) => {
      requireViewer(viewer);
      check();
      const group = working.transferGroups.find((row) => row.id === id);
      if (group === undefined) return undefined;
      const seen = working.transactions.some((txn) => {
        if (txn.transferGroupId !== id || working.deleted.has(txn.id)) return false;
        const account = working.accounts.find((row) => row.id === txn.accountId);
        return account !== undefined && accountVisible(working, viewer, account);
      });
      return seen ? group : undefined;
    },
    delete: (id) => {
      check();
      if (working.transactions.some((t) => t.transferGroupId === id)) {
        throw new Error("FOREIGN KEY constraint failed: transaction.transfer_group_id");
      }
      const index = working.transferGroups.findIndex((row) => row.id === id);
      if (index < 0) return false;
      working.transferGroups.splice(index, 1);
      return true;
    },
    members: (viewer, id) => {
      requireViewer(viewer);
      check();
      const live = working.transactions
        .filter((t) => t.transferGroupId === id && !working.deleted.has(t.id))
        .sort((a, b) => byText(a.id, b.id));
      const rows = live.filter((t) => {
        const account = working.accounts.find((row) => row.id === t.accountId);
        return account !== undefined && accountVisible(working, viewer, account);
      });
      return { rows, hidden: live.length - rows.length };
    },
    upkeepMembers: (id) => {
      check();
      return working.transactions
        .filter((t) => t.transferGroupId === id && !working.deleted.has(t.id))
        .sort((a, b) => byText(a.id, b.id));
    },
    idsInAccount: (accountId) => {
      check();
      return [
        ...new Set(
          working.transactions.flatMap((t) =>
            t.accountId === accountId && t.transferGroupId !== null
              ? [t.transferGroupId as string]
              : [],
          ),
        ),
      ].sort(byText);
    },
  };
}

function categoryGroupRepo(working: MemoryState, check: () => void): CategoryGroupRepo {
  return {
    insert: (row) => {
      check();
      if (working.categoryGroups.some((g) => g.name === row.name)) {
        throw uniqueViolation("category_group.name");
      }
      assertGroupKind(row.kind);
      working.categoryGroups.push(row);
    },
    update: (row) => {
      check();
      const at = working.categoryGroups.findIndex((g) => g.id === row.id);
      const before = working.categoryGroups[at];
      if (before === undefined) throw new Error(`Category group ${row.id} not found`);
      if (working.categoryGroups.some((g) => g.id !== row.id && g.name === row.name)) {
        throw uniqueViolation("category_group.name");
      }
      assertGroupKind(row.kind);
      working.categoryGroups[at] = {
        ...before,
        name: row.name,
        kind: row.kind,
        sort: row.sort,
        updatedAt: row.updatedAt,
      };
    },
    find: (viewer, id) => {
      requireViewer(viewer);
      check();
      return working.categoryGroups.find((row) => row.id === id);
    },
    list: (viewer) => {
      requireViewer(viewer);
      check();
      return [...working.categoryGroups].sort(
        (a, b) => a.sort - b.sort || byText(a.name, b.name) || byText(a.id, b.id),
      );
    },
  };
}

function categoryRepo(working: MemoryState, check: () => void): CategoryRepo {
  const live = () => working.categories.filter((row) => !working.deleted.has(row.id));
  return {
    insert: (row) => {
      check();
      references(working.categoryGroups, row.groupId, "category.group_id");
      if (live().some((c) => c.groupId === row.groupId && c.name === row.name)) {
        throw uniqueViolation("category.group_id, category.name");
      }
      working.categories.push(row);
    },
    update: (row) => {
      check();
      const at = working.categories.findIndex((c) => c.id === row.id && !working.deleted.has(c.id));
      const before = working.categories[at];
      if (before === undefined) throw new Error(`Category ${row.id} not found`);
      references(working.categoryGroups, row.groupId, "category.group_id");
      if (live().some((c) => c.id !== row.id && c.groupId === row.groupId && c.name === row.name)) {
        throw uniqueViolation("category.group_id, category.name");
      }
      working.categories[at] = {
        ...before,
        groupId: row.groupId,
        name: row.name,
        isFixedCost: row.isFixedCost,
        updatedAt: row.updatedAt,
      };
    },
    find: (viewer, id) => {
      requireViewer(viewer);
      check();
      return live().find((row) => row.id === id);
    },
    list: (viewer) => {
      requireViewer(viewer);
      check();
      return live().sort((a, b) => byText(`${a.name}|${a.id}`, `${b.name}|${b.id}`));
    },
    softDelete: (id, at) => {
      check();
      if (!live().some((row) => row.id === id)) return false;
      working.deleted.add(id);
      working.categories = working.categories.map((row) =>
        row.id === id ? { ...row, updatedAt: at } : row,
      );
      return true;
    },
  };
}

function taxCategoryRepo(working: MemoryState, check: () => void): TaxCategoryRepo {
  return {
    insert: (row) => {
      check();
      if (working.taxCategories.some((t) => t.code === row.code)) {
        throw uniqueViolation("tax_category.code");
      }
      if (row.defaultDeductibleBp < 0 || row.defaultDeductibleBp > 10_000) {
        throw new Error("CHECK constraint failed: tax_category_default_deductible_bp");
      }
      working.taxCategories.push(row);
    },
    update: (row) => {
      check();
      const at = working.taxCategories.findIndex((t) => t.id === row.id);
      const before = working.taxCategories[at];
      if (before === undefined) throw new Error(`Tax category ${row.id} not found`);
      if (working.taxCategories.some((t) => t.id !== row.id && t.code === row.code)) {
        throw uniqueViolation("tax_category.code");
      }
      if (row.defaultDeductibleBp < 0 || row.defaultDeductibleBp > 10_000) {
        throw new Error("CHECK constraint failed: tax_category_default_deductible_bp");
      }
      working.taxCategories[at] = {
        ...before,
        code: row.code,
        label: row.label,
        defaultDeductibleBp: row.defaultDeductibleBp,
        updatedAt: row.updatedAt,
      };
    },
    find: (viewer, id) => {
      requireViewer(viewer);
      check();
      return working.taxCategories.find((row) => row.id === id);
    },
    list: (viewer) => {
      requireViewer(viewer);
      check();
      return [...working.taxCategories].sort((a, b) =>
        byText(`${a.code}|${a.id}`, `${b.code}|${b.id}`),
      );
    },
  };
}

/** Shared bookkeeping for the four scoped tables (AD-18). */
function scoped<R extends { readonly id: string; readonly scopePersonId: string | null }>(
  working: MemoryState,
  check: () => void,
  rows: () => R[],
  setRows: (next: R[]) => void,
  key: (row: R) => string,
  order: (row: R) => string,
  what: string,
) {
  const live = () => rows().filter((row) => !working.deleted.has(row.id));
  return {
    insertRow: (row: R, originAccountId: string | null) => {
      check();
      references(working.people, row.scopePersonId, `${what}.scope_person_id`);
      references(working.accounts, originAccountId, `${what}.origin_account_id`);
      if (live().some((r) => r.scopePersonId === row.scopePersonId && key(r) === key(row))) {
        throw uniqueViolation(what);
      }
      rows().push(row);
      working.origins.set(row.id, originAccountId);
    },
    find: (viewer: Viewer, id: string): R | undefined => {
      requireViewer(viewer);
      check();
      return live().find((row) => row.id === id && inScope(viewer, row));
    },
    list: (viewer: Viewer): R[] => {
      requireViewer(viewer);
      check();
      return live()
        .filter((row) => inScope(viewer, row))
        .sort((a, b) => byText(`${order(a)}|${a.id}`, `${order(b)}|${b.id}`));
    },
    /**
     * SQLite checks a matched row's CHECKs (`checkRow`), then UNIQUE, then foreign keys
     * (`checkReferences`); a row that does not match is never checked.
     */
    update: (
      viewer: Viewer,
      row: R,
      merge: (before: R, next: R) => R,
      checks: { checkRow?: (next: R) => void; checkReferences?: (next: R) => void } = {},
    ): boolean => {
      requireViewer(viewer);
      check();
      const before = live().find((r) => r.id === row.id && inScope(viewer, r));
      if (before === undefined) return false;
      const next = merge(before, row);
      checks.checkRow?.(next);
      if (
        live().some(
          (r) =>
            r.id !== row.id && r.scopePersonId === before.scopePersonId && key(r) === key(next),
        )
      ) {
        throw uniqueViolation(what);
      }
      checks.checkReferences?.(next);
      setRows(rows().map((r) => (r.id === row.id ? next : r)));
      return true;
    },
    softDelete: (viewer: Viewer, id: string, at: string): boolean => {
      requireViewer(viewer);
      check();
      const row = live().find((r) => r.id === id && inScope(viewer, r));
      if (row === undefined) return false;
      working.deleted.add(id);
      setRows(rows().map((r) => (r.id === id ? { ...r, updatedAt: at } : r)));
      return true;
    },
    originOf: (viewer: Viewer, id: string): Id<"Account"> | null | undefined => {
      requireViewer(viewer);
      check();
      const row = live().find((r) => r.id === id && inScope(viewer, r));
      if (row === undefined) return undefined;
      return (working.origins.get(id) ?? null) as Id<"Account"> | null;
    },
    /** Hard-deletes the rows (live or deleted) that match `where`; returns their IDs. */
    removeWhere: (where: (row: R) => boolean): Set<string> => {
      check();
      const gone = new Set<string>(
        rows()
          .filter(where)
          .map((row) => row.id),
      );
      setRows(rows().filter((row) => !gone.has(row.id)));
      for (const id of gone) {
        working.deleted.delete(id);
        working.origins.delete(id);
      }
      return gone;
    },
  };
}

function tagRepo(working: MemoryState, check: () => void): TagRepo {
  const base = scoped(
    working,
    check,
    () => working.tags,
    (next) => {
      working.tags = next;
    },
    (row) => row.name,
    (row) => row.name,
    "tag.name",
  );
  return {
    insert: base.insertRow,
    find: base.find,
    list: base.list,
    update: (viewer, row) =>
      base.update(viewer, row, (before, next) => ({
        ...before,
        name: next.name,
        updatedAt: next.updatedAt,
      })),
    softDelete: base.softDelete,
    originOf: base.originOf,
    deleteScopedTo: (personId) => {
      const gone = base.removeWhere((row) => row.scopePersonId === personId);
      working.splitTags = working.splitTags.filter((t) => !gone.has(t.tagId));
      return gone.size;
    },
    replaceForSplit: (viewer, splitId, tagIds, at) => {
      requireViewer(viewer);
      check();
      references(working.splits, splitId, "split_tag.split_id");
      const wanted = new Set<string>(tagIds);
      for (const id of wanted) references(working.tags, id, "split_tag.tag_id");
      const seen = new Set<string>(base.list(viewer).map((t) => t.id));
      working.splitTags = working.splitTags.filter(
        (t) => t.splitId !== splitId || !seen.has(t.tagId) || wanted.has(t.tagId),
      );
      const have = new Set<string>(
        working.splitTags.filter((t) => t.splitId === splitId).map((t) => t.tagId),
      );
      for (const id of wanted) {
        if (!have.has(id)) {
          working.splitTags.push({
            splitId: splitId as Id<"Split">,
            tagId: id as Id<"Tag">,
            createdAt: at,
            updatedAt: at,
          });
        }
      }
    },
    listForSplits: (viewer, splitIds) => {
      const out: SplitTagged[] = [];
      for (const splitId of new Set(splitIds)) {
        for (const tag of tagRepo(working, check).listForSplit(viewer, splitId)) {
          out.push({ splitId: splitId as Id<"Split">, tag });
        }
      }
      return out.sort((a, b) => byText(a.splitId, b.splitId));
    },
    listForSplit: (viewer, splitId) => {
      requireViewer(viewer);
      check();
      const split = working.splits.find((row) => row.id === splitId);
      const txn = working.transactions.find((row) => row.id === split?.transactionId);
      const account = working.accounts.find((row) => row.id === txn?.accountId);
      if (
        txn === undefined ||
        working.deleted.has(txn.id) ||
        account === undefined ||
        !accountVisible(working, viewer, account)
      ) {
        return [];
      }
      const ids = new Set(
        working.splitTags.filter((row) => row.splitId === splitId).map((row) => row.tagId),
      );
      return base.list(viewer).filter((row) => ids.has(row.id));
    },
  };
}

const checkBudget = (budgetCents: number | null) =>
  checked(budgetCents === null || budgetCents >= 0, "activity_budget_cents");

function activityRepo(working: MemoryState, check: () => void): ActivityRepo {
  const base = scoped(
    working,
    check,
    () => working.activities,
    (next) => {
      working.activities = next;
    },
    (row) => row.name,
    (row) => row.name,
    "activity.name",
  );
  return {
    insert: (row, origin) => {
      check();
      checkBudget(row.budgetCents);
      base.insertRow(row, origin);
    },
    find: base.find,
    list: base.list,
    update: (viewer, row) =>
      base.update(
        viewer,
        row,
        (before, next) => ({
          ...before,
          name: next.name,
          startsOn: next.startsOn,
          endsOn: next.endsOn,
          budgetCents: next.budgetCents,
          updatedAt: next.updatedAt,
        }),
        { checkRow: (next) => checkBudget(next.budgetCents) },
      ),
    softDelete: base.softDelete,
    originOf: base.originOf,
    deleteScopedTo: (personId) => {
      const gone = base.removeWhere((row) => row.scopePersonId === personId);
      working.splits = working.splits.map((s) =>
        s.activityId !== null && gone.has(s.activityId) ? { ...s, activityId: null } : s,
      );
      return gone.size;
    },
  };
}

function payeeRepo(working: MemoryState, check: () => void): PayeeRepo {
  const base = scoped(
    working,
    check,
    () => working.payees,
    (next) => {
      working.payees = next;
    },
    (row) => row.name,
    (row) => row.name,
    "payee.name",
  );
  return {
    insert: (row, origin) => {
      check();
      references(working.categories, row.defaultCategoryId, "payee.default_category_id");
      base.insertRow(row, origin);
    },
    clearDefaultCategory: (categoryId, at) => {
      check();
      const hit = working.payees.filter(
        (p) => p.defaultCategoryId === categoryId && !working.deleted.has(p.id),
      );
      const out = hit
        .map((before) => ({
          before,
          originAccountId: (working.origins.get(before.id) ?? null) as Id<"Account"> | null,
        }))
        .sort((a, b) => byText(a.before.id, b.before.id));
      working.payees = working.payees.map((p) =>
        hit.includes(p) ? { ...p, defaultCategoryId: null, updatedAt: at } : p,
      );
      return out;
    },
    find: base.find,
    list: base.list,
    update: (viewer, row) =>
      base.update(
        viewer,
        row,
        (before, next) => ({
          ...before,
          name: next.name,
          websiteUrl: next.websiteUrl,
          defaultCategoryId: next.defaultCategoryId,
          updatedAt: next.updatedAt,
        }),
        {
          checkReferences: (next) =>
            references(working.categories, next.defaultCategoryId, "payee.default_category_id"),
        },
      ),
    softDelete: base.softDelete,
    originOf: base.originOf,
    deleteScopedTo: (personId) => {
      const mine = working.payees.filter((p) => p.scopePersonId === personId).map((p) => p.id);
      // As SQLite: foreign keys without cascade, so a transaction or alias that still names one
      // of them refuses.
      if (
        working.transactions.some((t) => t.payeeId !== null && mine.includes(t.payeeId)) ||
        working.payeeAliases.some((a) => mine.includes(a.payeeId))
      ) {
        throw new Error("FOREIGN KEY constraint failed: payee.id");
      }
      return base.removeWhere((row) => row.scopePersonId === personId).size;
    },
  };
}

function payeeAliasRepo(working: MemoryState, check: () => void): PayeeAliasRepo {
  const base = scoped(
    working,
    check,
    () => working.payeeAliases,
    (next) => {
      working.payeeAliases = next;
    },
    (row) => `${row.matchKind}|${row.pattern}`,
    (row) => row.pattern,
    "payee_alias.pattern",
  );
  return {
    insert: (row, origin) => {
      check();
      assertMatchKind(row.matchKind);
      references(working.payees, row.payeeId, "payee_alias.payee_id");
      base.insertRow(row, origin);
    },
    softDeleteForPayee: (payeeId, at) => {
      check();
      const hit = working.payeeAliases.filter(
        (a) => a.payeeId === payeeId && !working.deleted.has(a.id),
      );
      const out = hit
        .map((before) => ({
          before,
          originAccountId: (working.origins.get(before.id) ?? null) as Id<"Account"> | null,
        }))
        .sort((a, b) => byText(a.before.id, b.before.id));
      for (const { before } of out) working.deleted.add(before.id);
      working.payeeAliases = working.payeeAliases.map((a) =>
        hit.includes(a) ? { ...a, updatedAt: at } : a,
      );
      return out;
    },
    find: base.find,
    list: base.list,
    update: (viewer, row) =>
      base.update(
        viewer,
        row,
        (before, next) => ({
          ...before,
          pattern: next.pattern,
          matchKind: next.matchKind,
          updatedAt: next.updatedAt,
        }),
        { checkRow: (next) => assertMatchKind(next.matchKind) },
      ),
    softDelete: base.softDelete,
    originOf: base.originOf,
    deleteScopedTo: (personId) => {
      const payees = new Set<string>(
        working.payees.filter((p) => p.scopePersonId === personId).map((p) => p.id),
      );
      return base.removeWhere((row) => row.scopePersonId === personId || payees.has(row.payeeId))
        .size;
    },
  };
}

export function memoryUnitOfWork(
  settings: HouseholdSettingsRow = DEFAULT_SETTINGS,
): MemoryUnitOfWork {
  const uow: MemoryUnitOfWork = {
    state: {
      settings,
      people: [],
      audit: [],
      jobs: [],
      reviewItems: [],
      accounts: [],
      accountOwners: [],
      transactions: [],
      splits: [],
      institutions: [],
      balanceSnapshots: [],
      transferGroups: [],
      categoryGroups: [],
      categories: [],
      taxCategories: [],
      tags: [],
      splitTags: [],
      activities: [],
      payees: [],
      payeeAliases: [],
      deleted: new Set(),
      origins: new Map(),
      backups: [],
      backupVerifications: [],
      recoveryBundle: undefined,
      users: [],
      emails: {},
      enrolments: {},
      setupLinks: [],
      loginAttempts: [],
      recoveryCodes: [],
      reEnrolmentLinks: [],
      sessions: {},
      passwords: {},
    },
    failAudit: false,
    transaction<T>(fn: (tx: TxRepos) => T): T {
      const working: MemoryState = {
        settings: uow.state.settings,
        people: [...uow.state.people],
        audit: [...uow.state.audit],
        jobs: [...uow.state.jobs],
        reviewItems: [...uow.state.reviewItems],
        accounts: [...uow.state.accounts],
        accountOwners: [...uow.state.accountOwners],
        transactions: [...uow.state.transactions],
        splits: [...uow.state.splits],
        institutions: [...uow.state.institutions],
        balanceSnapshots: [...uow.state.balanceSnapshots],
        transferGroups: [...uow.state.transferGroups],
        categoryGroups: [...uow.state.categoryGroups],
        categories: [...uow.state.categories],
        taxCategories: [...uow.state.taxCategories],
        tags: [...uow.state.tags],
        splitTags: [...uow.state.splitTags],
        activities: [...uow.state.activities],
        payees: [...uow.state.payees],
        payeeAliases: [...uow.state.payeeAliases],
        deleted: new Set(uow.state.deleted),
        origins: new Map(uow.state.origins),
        backups: [...uow.state.backups],
        backupVerifications: [...uow.state.backupVerifications],
        recoveryBundle: uow.state.recoveryBundle,
        users: [...uow.state.users],
        emails: uow.state.emails,
        enrolments: uow.state.enrolments,
        setupLinks: [...uow.state.setupLinks],
        loginAttempts: [...uow.state.loginAttempts],
        recoveryCodes: [...uow.state.recoveryCodes],
        reEnrolmentLinks: [...uow.state.reEnrolmentLinks],
        sessions: uow.state.sessions,
        passwords: uow.state.passwords,
      };
      let active = true;
      const check = () => {
        if (!active) throw new Error("Repository used outside its transaction");
      };
      const tx: TxRepos = {
        householdSettings: {
          get: () => {
            check();
            return working.settings;
          },
          update: (row) => {
            check();
            working.settings = row;
          },
        },
        person: personRepo(working, check),
        users: userRepo(working, check),
        setupLinks: setupLinkRepo(working, check),
        loginAttempts: loginAttemptRepo(working, check),
        recoveryCodes: recoveryCodeRepo(working, check),
        reEnrolmentLinks: reEnrolmentLinkRepo(working, check),
        credentials: credentialRepo(working, check),
        audit: auditRepo(working, check, () => uow.failAudit),
        jobs: jobRepo(working, check),
        reviewItems: reviewItemRepo(working, check),
        accounts: accountRepo(working, check),
        transactions: transactionRepo(working, check),
        institutions: institutionRepo(working, check),
        balanceSnapshots: balanceSnapshotRepo(working, check),
        transferGroups: transferGroupRepo(working, check),
        categoryGroups: categoryGroupRepo(working, check),
        categories: categoryRepo(working, check),
        taxCategories: taxCategoryRepo(working, check),
        tags: tagRepo(working, check),
        activities: activityRepo(working, check),
        payees: payeeRepo(working, check),
        payeeAliases: payeeAliasRepo(working, check),
        backups: backupRepo(working, check),
        backupVerifications: backupVerificationRepo(working, check),
        recoveryBundle: {
          get: () => {
            check();
            return working.recoveryBundle;
          },
          set: (row) => {
            check();
            working.recoveryBundle = row;
          },
        },
      };
      try {
        const result = fn(tx);
        uow.state.settings = working.settings;
        uow.state.people = working.people;
        uow.state.audit = working.audit;
        uow.state.jobs = working.jobs;
        uow.state.reviewItems = working.reviewItems;
        uow.state.accounts = working.accounts;
        uow.state.accountOwners = working.accountOwners;
        uow.state.transactions = working.transactions;
        uow.state.splits = working.splits;
        uow.state.institutions = working.institutions;
        uow.state.balanceSnapshots = working.balanceSnapshots;
        uow.state.transferGroups = working.transferGroups;
        uow.state.categoryGroups = working.categoryGroups;
        uow.state.categories = working.categories;
        uow.state.taxCategories = working.taxCategories;
        uow.state.tags = working.tags;
        uow.state.splitTags = working.splitTags;
        uow.state.activities = working.activities;
        uow.state.payees = working.payees;
        uow.state.payeeAliases = working.payeeAliases;
        uow.state.deleted = working.deleted;
        uow.state.origins = working.origins;
        uow.state.backups = working.backups;
        uow.state.backupVerifications = working.backupVerifications;
        uow.state.recoveryBundle = working.recoveryBundle;
        uow.state.users = working.users;
        uow.state.setupLinks = working.setupLinks;
        uow.state.loginAttempts = working.loginAttempts;
        uow.state.enrolments = working.enrolments;
        uow.state.recoveryCodes = working.recoveryCodes;
        uow.state.reEnrolmentLinks = working.reEnrolmentLinks;
        uow.state.sessions = working.sessions;
        uow.state.passwords = working.passwords;
        return result;
      } finally {
        active = false;
      }
    },
    read(fn) {
      const check = () => {};
      const person = personRepo(uow.state, check);
      const links = setupLinkRepo(uow.state, check);
      return fn({
        householdSettings: { get: () => uow.state.settings },
        person: {
          findByUserId: person.findByUserId,
          listActive: person.listActive,
          listLogins: person.listLogins,
        },
        users: userRepo(uow.state, check),
        setupLinks: { findByTokenHash: links.findByTokenHash, hasLive: links.hasLive },
        loginAttempts: { listSince: loginAttemptRepo(uow.state, check).listSince },
        recoveryCodes: { counts: recoveryCodeRepo(uow.state, check).counts },
        reEnrolmentLinks: {
          findByTokenHash: reEnrolmentLinkRepo(uow.state, check).findByTokenHash,
          findById: reEnrolmentLinkRepo(uow.state, check).findById,
        },
        jobs: {
          listDead: jobRepo(uow.state, check).listDead,
          listPending: jobRepo(uow.state, check).listPending,
          listRunning: jobRepo(uow.state, check).listRunning,
          countByStatus: jobRepo(uow.state, check).countByStatus,
          find: jobRepo(uow.state, check).find,
          firstCreatedAt: jobRepo(uow.state, check).firstCreatedAt,
        },
        audit: {
          listVisible: auditRepo(uow.state, check, () => false).listVisible,
          ownerChanges: auditRepo(uow.state, check, () => false).ownerChanges,
        },
        reviewItems: { listOpenFor: reviewItemRepo(uow.state, check).listOpenFor },
        accounts: {
          findVisible: accountRepo(uow.state, check).findVisible,
          list: accountRepo(uow.state, check).list,
          owners: accountRepo(uow.state, check).owners,
          any: accountRepo(uow.state, check).any,
        },
        transactions: {
          listVisible: transactionRepo(uow.state, check).listVisible,
          findVisible: transactionRepo(uow.state, check).findVisible,
          listPage: transactionRepo(uow.state, check).listPage,
          summarise: transactionRepo(uow.state, check).summarise,
          countBefore: transactionRepo(uow.state, check).countBefore,
          dayNets: transactionRepo(uow.state, check).dayNets,
        },
        institutions: {
          find: institutionRepo(uow.state, check).find,
          list: institutionRepo(uow.state, check).list,
        },
        balanceSnapshots: {
          listVisible: balanceSnapshotRepo(uow.state, check).listVisible,
          balanceAsOf: balanceSnapshotRepo(uow.state, check).balanceAsOf,
        },
        transferGroups: { find: transferGroupRepo(uow.state, check).find },
        categoryGroups: {
          find: categoryGroupRepo(uow.state, check).find,
          list: categoryGroupRepo(uow.state, check).list,
        },
        categories: {
          find: categoryRepo(uow.state, check).find,
          list: categoryRepo(uow.state, check).list,
        },
        taxCategories: {
          find: taxCategoryRepo(uow.state, check).find,
          list: taxCategoryRepo(uow.state, check).list,
        },
        tags: {
          find: tagRepo(uow.state, check).find,
          list: tagRepo(uow.state, check).list,
          listForSplit: tagRepo(uow.state, check).listForSplit,
          listForSplits: tagRepo(uow.state, check).listForSplits,
        },
        activities: {
          find: activityRepo(uow.state, check).find,
          list: activityRepo(uow.state, check).list,
        },
        payees: {
          find: payeeRepo(uow.state, check).find,
          list: payeeRepo(uow.state, check).list,
        },
        payeeAliases: {
          find: payeeAliasRepo(uow.state, check).find,
          list: payeeAliasRepo(uow.state, check).list,
        },
        backups: {
          find: backupRepo(uow.state, check).find,
          latestPushed: backupRepo(uow.state, check).latestPushed,
        },
        backupVerifications: { latest: backupVerificationRepo(uow.state, check).latest },
        recoveryBundle: {
          get: () => {
            check();
            return uow.state.recoveryBundle;
          },
        },
      });
    },
  };
  return uow;
}
