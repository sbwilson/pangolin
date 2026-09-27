// The write-transaction port (AD-1, AD-2). Implemented in `packages/db`. Every repository
// method is synchronous: a use case does its async I/O first, then opens one short transaction.
import type { Id } from "@pangolin/shared";
import type { Viewer } from "../viewer.ts";

/** `household_settings`: the single row of household-wide configuration. */
export interface HouseholdSettingsRow {
  /** ISO 4217 code, e.g. `AUD`. */
  readonly baseCurrency: string;
  /** First day of the financial year as `MM-DD`; `07-01` in v1. */
  readonly fyStart: string;
  /** IANA time zone of the household, e.g. `Australia/Sydney`. */
  readonly timezone: string;
  readonly sharedAttribution: "contribution" | "even";
  /** UTC ISO-8601 timestamp. */
  readonly updatedAt: string;
}

/** `person`: one of us. `userId` links their better-auth login (story 1.5). */
export interface PersonRow {
  readonly id: Id<"Person">;
  readonly userId: string | null;
  readonly displayName: string;
  /** `#RRGGBB`. */
  readonly colour: string;
  /** UTC ISO-8601 timestamp. */
  readonly createdAt: string;
  /** UTC ISO-8601 timestamp. */
  readonly updatedAt: string;
  /** UTC ISO-8601 timestamp, or null while the person is active. */
  readonly deletedAt: string | null;
}

/** One `audit_log` row, fully stamped. Only the `write` helper builds these. */
export interface AuditRow {
  readonly id: Id<"AuditLog">;
  /** UTC ISO-8601 timestamp from `clock.now()`. */
  readonly at: string;
  /** `person:<id>`, `job:<kind>` or `cli:<command>`. */
  readonly actor: string;
  readonly entity: string;
  readonly entityId: string;
  readonly accountId: string | null;
  readonly personId: string | null;
  readonly action: string;
  /** JSON text, or null. */
  readonly before: string | null;
  /** JSON text, or null. */
  readonly after: string | null;
}

/** The job lanes (AD-8): `llm` model calls, `net` outbound fetches, `local` in-process work. */
export type JobLane = "llm" | "net" | "local";

export type JobStatus = "pending" | "running" | "done" | "dead";

/** One `job` row. Times are `formatInstant` text, so text order is time order. */
export interface JobRow {
  readonly id: Id<"Job">;
  readonly kind: string;
  readonly lane: JobLane;
  /** JSON text. */
  readonly payload: string;
  readonly dedupeKey: string | null;
  readonly status: JobStatus;
  /** Claims so far, including ones whose lease expired. */
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: string | null;
  /** Server-side only; never sent over HTTP. */
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt: string | null;
}

/** A dead job as the status page shows it: kind and time only (AD-9). */
export interface DeadJobRow {
  readonly kind: string;
  readonly failedAt: string;
}

/**
 * Job bookkeeping. Every method that changes a claimed job checks `owner` against
 * `lease_owner` and returns false, changing nothing, when this runner no longer holds it.
 */
export interface JobRepo {
  /**
   * Inserts `row` unless a pending or running job has the same non-null `dedupeKey`; then
   * nothing changes and that job's ID comes back with `inserted: false`.
   */
  insertOrGetPending(row: JobRow): { readonly id: Id<"Job">; readonly inserted: boolean };
  /**
   * Atomically claims the oldest runnable job in `lane` (pending and due, or running with an
   * expired lease): sets it running under `owner` until `leaseUntil` and adds one attempt.
   */
  claimNext(lane: JobLane, owner: string, now: string, leaseUntil: string): JobRow | undefined;
  renewLease(id: Id<"Job">, owner: string, now: string, leaseUntil: string): boolean;
  complete(id: Id<"Job">, owner: string, now: string): boolean;
  /** Back to pending at `runAt`, keeping the error for the server's eyes only. */
  retry(id: Id<"Job">, owner: string, now: string, runAt: string, error: string): boolean;
  markDead(id: Id<"Job">, owner: string, now: string, error: string): boolean;
  /** Dead jobs, newest failure first. */
  listDead(limit: number): DeadJobRow[];
}

/** One `review_item` row (AD-17). Open while `resolvedAt` is null. */
export interface ReviewItemRow {
  readonly id: Id<"ReviewItem">;
  readonly kind: string;
  readonly accountId: string | null;
  readonly personId: string | null;
  /** What the item is about, e.g. `job:<id>`. */
  readonly entityRef: string;
  readonly dedupeKey: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: string | null;
}

export interface ReviewItemRepo {
  /**
   * Inserts `row` unless an open item has the same `dedupeKey`; then nothing changes and that
   * item comes back with `inserted: false`.
   */
  raise(row: ReviewItemRow): { readonly item: ReviewItemRow; readonly inserted: boolean };
  /**
   * Resolves the open item with `dedupeKey`. Returns it before and after, or undefined when no
   * item with that key is open.
   */
  resolve(
    dedupeKey: string,
    resolvedAt: string,
    resolution: string,
  ): { readonly before: ReviewItemRow; readonly after: ReviewItemRow } | undefined;
  /**
   * Open items `viewer` may see, oldest first (AD-3, AD-17). Throws when given no viewer.
   * A person sees household items and their own; items with an account are hidden from people
   * until epic 2 supplies `visibleAccounts`. A system viewer sees every item.
   */
  listOpenFor(viewer: Viewer): ReviewItemRow[];
}

export interface HouseholdSettingsRepo {
  get(): HouseholdSettingsRow;
  update(row: HouseholdSettingsRow): void;
}

export interface PersonRepo {
  insert(row: PersonRow): void;
  /** The active person linked to login `userId`, if any. */
  findByUserId(userId: string): PersonRow | undefined;
  /** Active (not deleted) people, oldest first. */
  listActive(): PersonRow[];
}

/** `setup_link`: a one-time sign-up link. Only the token's hash is stored. */
export interface SetupLinkRow {
  readonly id: Id<"SetupLink">;
  /** SHA-256 of the token, hex. */
  readonly tokenHash: string;
  /** `cli`, or `person:<id>` for a partner invite. */
  readonly issuedBy: string;
  /** UTC ISO-8601 timestamp. */
  readonly createdAt: string;
  /** UTC ISO-8601 timestamp, 24 h after `createdAt`. */
  readonly expiresAt: string;
  /** UTC ISO-8601 timestamp, or null while unused. */
  readonly usedAt: string | null;
}

export interface SetupLinkRepo {
  insert(row: SetupLinkRow): void;
  findByTokenHash(tokenHash: string): SetupLinkRow | undefined;
  /** Sets `usedAt` on an unused link. Returns false, changing nothing, when it was already used. */
  markUsed(id: Id<"SetupLink">, usedAt: string): boolean;
  /** True when some unused link expires after `now`. */
  hasLive(now: string): boolean;
  /** Unused links that expire after `now`, oldest first. */
  listLive(now: string): SetupLinkRow[];
  /** Ends an unused link at `at` (sets `expiresAt`). False when it was already used. */
  expire(id: Id<"SetupLink">, at: string): boolean;
}

/** What a login has enrolled besides its password. */
export interface UserEnrolment {
  /** TOTP confirmed (`auth_user.two_factor_enabled`). */
  readonly totp: boolean;
  readonly passkeys: number;
}

/** better-auth's users (`auth_user`). better-auth writes them; `identity` only reads them. */
export interface UserRepo {
  count(): number;
  /** Undefined when there is no such user. */
  enrolment(userId: string): UserEnrolment | undefined;
}

/** `recovery_code`: one of a person's one-time recovery codes. Only the code's hash is stored. */
export interface RecoveryCodeRow {
  readonly id: Id<"RecoveryCode">;
  readonly personId: Id<"Person">;
  /** SHA-256 of the normalised code (10 characters, no hyphen), hex. */
  readonly codeHash: string;
  /** UTC ISO-8601 timestamp. */
  readonly createdAt: string;
  /** UTC ISO-8601 timestamp, or null while unused. */
  readonly usedAt: string | null;
}

export interface RecoveryCodeCounts {
  /** Every code the person has, used or not. Zero means none were ever issued (or all cleared). */
  readonly total: number;
  readonly unused: number;
}

export interface RecoveryCodeRepo {
  insert(row: RecoveryCodeRow): void;
  /** The person's unused code with `codeHash`, if any. */
  findUnused(personId: Id<"Person">, codeHash: string): RecoveryCodeRow | undefined;
  /** Sets `usedAt` on an unused code. False, changing nothing, when it was already used. */
  markUsed(id: Id<"RecoveryCode">, usedAt: string): boolean;
  /** Deletes the person's unused codes; returns how many. */
  deleteUnused(personId: Id<"Person">): number;
  /** Deletes every code the person has; returns how many. */
  deleteAll(personId: Id<"Person">): number;
  counts(personId: Id<"Person">): RecoveryCodeCounts;
}

/** `re_enrolment_link`: a partner-assisted (or CLI) re-enrolment link. Only the hash is stored. */
export interface ReEnrolmentLinkRow {
  readonly id: Id<"ReEnrolmentLink">;
  /** The person whose access the link resets. */
  readonly personId: Id<"Person">;
  /** `person:<id>` (the partner) or `cli:reset-user`. */
  readonly issuedBy: string;
  /** SHA-256 of the token, hex. */
  readonly tokenHash: string;
  /** UTC ISO-8601 timestamp. */
  readonly createdAt: string;
  /** UTC ISO-8601 timestamp, 24 h after `createdAt` unless revoked earlier. */
  readonly expiresAt: string;
  /** UTC ISO-8601 timestamp, or null while unused. */
  readonly usedAt: string | null;
}

export interface ReEnrolmentLinkRepo {
  insert(row: ReEnrolmentLinkRow): void;
  findByTokenHash(tokenHash: string): ReEnrolmentLinkRow | undefined;
  findById(id: string): ReEnrolmentLinkRow | undefined;
  /** Sets `usedAt` on an unused link. False, changing nothing, when it was already used. */
  markUsed(id: Id<"ReEnrolmentLink">, usedAt: string): boolean;
  /** The person's unused links that expire after `now`, oldest first. */
  listLive(personId: Id<"Person">, now: string): ReEnrolmentLinkRow[];
  /** Ends an unused link at `at` (sets `expiresAt`). False when it was already used. */
  expire(id: Id<"ReEnrolmentLink">, at: string): boolean;
}

/**
 * better-auth's credential rows for one login, cleared by account recovery (story 1.6). The
 * `identity` use cases write them here, inside their own transaction, so the clearing and its
 * audit commit together.
 */
export interface CredentialRepo {
  /** Deletes every passkey of the login; returns how many. */
  deletePasskeys(userId: string): number;
  /** Deletes the login's TOTP secret and turns two-factor off. True when it was on or set up. */
  disableTwoFactor(userId: string): boolean;
  /** Deletes every session of the login; returns how many. */
  revokeSessions(userId: string): number;
  /**
   * Replaces the password hash (better-auth's format) of the login's email-and-password account,
   * stamping `updated_at` with `at`. False when the login has no such account.
   */
  setPasswordHash(userId: string, passwordHash: string, at: string): boolean;
}

/** One `login_attempt` row: a password or TOTP attempt for a lower-cased email. */
export interface LoginAttemptRow {
  readonly email: string;
  /** UTC ISO-8601 timestamp. */
  readonly at: string;
  /** True when the attempt ended in a session. */
  readonly ok: boolean;
}

export interface LoginAttemptRepo {
  insert(row: LoginAttemptRow): void;
  /** Attempts for `email` at or after `since`, oldest first. */
  listSince(email: string, since: string): LoginAttemptRow[];
  /** Deletes every attempt (any email) before `before`. */
  deleteBefore(before: string): void;
}

export interface AuditRepo {
  append(row: AuditRow): void;
}

/** Repositories bound to one open transaction. They throw once that transaction has ended. */
export interface TxRepos {
  readonly householdSettings: HouseholdSettingsRepo;
  readonly person: PersonRepo;
  readonly users: UserRepo;
  readonly setupLinks: SetupLinkRepo;
  readonly loginAttempts: LoginAttemptRepo;
  readonly recoveryCodes: RecoveryCodeRepo;
  readonly reEnrolmentLinks: ReEnrolmentLinkRepo;
  readonly credentials: CredentialRepo;
  readonly audit: AuditRepo;
  readonly jobs: JobRepo;
  readonly reviewItems: ReviewItemRepo;
}

/** The read-only subset of `TxRepos`, for queries. */
export interface ReadRepos {
  readonly householdSettings: Pick<HouseholdSettingsRepo, "get">;
  readonly person: Pick<PersonRepo, "findByUserId" | "listActive">;
  readonly users: UserRepo;
  readonly setupLinks: Pick<SetupLinkRepo, "findByTokenHash" | "hasLive">;
  readonly loginAttempts: Pick<LoginAttemptRepo, "listSince">;
  readonly recoveryCodes: Pick<RecoveryCodeRepo, "counts">;
  readonly reEnrolmentLinks: Pick<ReEnrolmentLinkRepo, "findByTokenHash" | "findById">;
  readonly jobs: Pick<JobRepo, "listDead">;
  readonly reviewItems: Pick<ReviewItemRepo, "listOpenFor">;
}

export interface UnitOfWork {
  /**
   * Runs `fn` synchronously inside one write transaction (`BEGIN IMMEDIATE`). Commits when `fn`
   * returns and rolls back when it throws. Use cases reach this through `write`; only the
   * unaudited `login_attempt` log (`identity/lockout.ts`) opens one directly.
   */
  transaction<T>(fn: (tx: TxRepos) => T): T;
  /** Runs `fn` synchronously inside one read transaction, for a consistent snapshot. */
  read<T>(fn: (repos: ReadRepos) => T): T;
}
