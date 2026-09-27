// Test support only (not exported from the package): an in-memory `UnitOfWork` with rollback,
// so `app` tests can check transaction behaviour without importing an adapter. The job and
// review-item repositories mirror the SQLite adapter's semantics (partial unique keys, leased
// claims, visibility); `packages/db` tests prove the adapter on real SQLite.
import type { Id } from "@pangolin/shared";
import type {
  AuditRow,
  BackupSnapshotRepo,
  BackupSnapshotRow,
  CredentialRepo,
  HouseholdSettingsRow,
  JobRepo,
  JobRow,
  LoginAttemptRepo,
  LoginAttemptRow,
  PersonRepo,
  PersonRow,
  RecoveryCodeRepo,
  RecoveryCodeRow,
  ReEnrolmentLinkRepo,
  ReEnrolmentLinkRow,
  ReviewItemRepo,
  ReviewItemRow,
  SetupLinkRepo,
  SetupLinkRow,
  TxRepos,
  UnitOfWork,
  UserEnrolment,
  UserRepo,
} from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

export interface MemoryState {
  settings: HouseholdSettingsRow;
  people: PersonRow[];
  audit: AuditRow[];
  jobs: JobRow[];
  reviewItems: ReviewItemRow[];
  backups: BackupSnapshotRow[];
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
        .sort((a, b) => (`${a.pushedAt}|${a.id}` < `${b.pushedAt}|${b.id}` ? 1 : -1))[0];
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

function visible(viewer: Viewer, row: ReviewItemRow): boolean {
  if (viewer.kind === "system") return true;
  return row.accountId === null && (row.personId === null || row.personId === viewer.personId);
}

function reviewItemRepo(working: MemoryState, check: () => void): ReviewItemRepo {
  const open = (dedupeKey: string) =>
    working.reviewItems.find((row) => row.dedupeKey === dedupeKey && row.resolvedAt === null);
  return {
    raise: (row) => {
      check();
      const existing = open(row.dedupeKey);
      if (existing !== undefined) return { item: existing, inserted: false };
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
    listOpenFor: (viewer) => {
      if (viewer === undefined || viewer === null) throw new TypeError("a viewer is required");
      check();
      return working.reviewItems
        .filter((row) => row.resolvedAt === null && visible(viewer, row))
        .sort((a, b) => (`${a.createdAt}|${a.id}` < `${b.createdAt}|${b.id}` ? -1 : 1));
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
      backups: [],
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
        backups: [...uow.state.backups],
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
        audit: {
          append: (row) => {
            check();
            if (uow.failAudit) throw new Error("audit append failed");
            working.audit.push(row);
          },
        },
        jobs: jobRepo(working, check),
        reviewItems: reviewItemRepo(working, check),
        backups: backupRepo(working, check),
      };
      try {
        const result = fn(tx);
        uow.state.settings = working.settings;
        uow.state.people = working.people;
        uow.state.audit = working.audit;
        uow.state.jobs = working.jobs;
        uow.state.reviewItems = working.reviewItems;
        uow.state.backups = working.backups;
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
          countByStatus: jobRepo(uow.state, check).countByStatus,
          find: jobRepo(uow.state, check).find,
        },
        reviewItems: { listOpenFor: reviewItemRepo(uow.state, check).listOpenFor },
        backups: {
          find: backupRepo(uow.state, check).find,
          latestPushed: backupRepo(uow.state, check).latestPushed,
        },
      });
    },
  };
  return uow;
}
