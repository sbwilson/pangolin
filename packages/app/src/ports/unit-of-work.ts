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

/** A pending job as `pangolin status` shows it: kind and due time only (AD-9). */
export interface PendingJobRow {
  readonly kind: string;
  readonly runAt: string;
}

/** A running job as `pangolin status` shows it: kind and lease end only (AD-9). */
export interface RunningJobRow {
  readonly kind: string;
  readonly leaseExpiresAt: string;
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
  /** Pending jobs, soonest `runAt` first, then by ID. */
  listPending(limit: number): PendingJobRow[];
  /** Running jobs, soonest lease end first, then by ID. */
  listRunning(limit: number): RunningJobRow[];
  /** How many jobs have each status; a status with none is 0. */
  countByStatus(): Readonly<Record<JobStatus, number>>;
  /** The job with `id`, if any. Its `lastError` is for the server only. */
  find(id: Id<"Job">): JobRow | undefined;
  /**
   * Makes every pending or running job of one of `kinds` `dead` at `now` with `reason` as its
   * error, whoever holds its lease (restore, AD-16). Returns how many it changed.
   */
  cancelLive(kinds: readonly string[], now: string, reason: string): number;
  /** When the first job of `kind` was created, or undefined when there has been none. */
  firstCreatedAt(kind: string): string | undefined;
}

/** One `backup_snapshot` row (story 1.10). Times are `formatInstant` text. */
export interface BackupSnapshotRow {
  /** The ID of the `backup-snapshot` job that took it. */
  readonly id: string;
  readonly takenAt: string;
  readonly schemaVersion: number;
  readonly tableCount: number;
  readonly rowCount: number;
  /** SHA-256 of the manifest pushed beside the snapshot, hex. */
  readonly manifestSha256: string;
  readonly pushJobId: Id<"Job">;
  /** restic's snapshot ID, once pushed; null until then. */
  readonly resticSnapshotId: string | null;
  readonly pushedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BackupSnapshotRepo {
  insert(row: BackupSnapshotRow): void;
  find(id: string): BackupSnapshotRow | undefined;
  /**
   * Records the push of an unpushed snapshot. False, changing nothing, when there is no such
   * snapshot or it was already pushed.
   */
  markPushed(id: string, resticSnapshotId: string, pushedAt: string): boolean;
  /** Of the pushed snapshots, the one taken last (by `takenAt`, then ID), if any. */
  latestPushed(): BackupSnapshotRow | undefined;
}

export type BackupVerificationKind = "check" | "drill";

/** One `backup_verification` row (story 1.14): the result of a repository check or restore drill. */
export interface BackupVerificationRow {
  readonly id: Id<"BackupVerification">;
  readonly kind: BackupVerificationKind;
  readonly at: string;
  readonly ok: boolean;
  /** What was checked, or what failed; never a secret. */
  readonly summary: string;
}

export interface BackupVerificationRepo {
  insert(row: BackupVerificationRow): void;
  /** The newest result of `kind`, if any. */
  latest(kind: BackupVerificationKind): BackupVerificationRow | undefined;
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
   * A person sees household items, items of an account they can see, and their own. A system
   * viewer sees every item.
   */
  listOpenFor(viewer: Viewer): ReviewItemRow[];
}

/** The kinds of account (`account.type`). */
export const ACCOUNT_TYPES = [
  "transaction",
  "savings",
  "offset",
  "credit_card",
  "home_loan",
  "brokerage",
  "super",
  "property",
  "vehicle",
  "other",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** `account`: any balance we track. A private account is seen only by its owner (AD-3). */
export interface AccountRow {
  readonly id: Id<"Account">;
  readonly name: string;
  readonly type: AccountType;
  /** ISO 4217 code; v1 requires it to match the base currency. */
  readonly currency: string;
  readonly isPrivate: boolean;
  readonly institutionId: Id<"Institution"> | null;
  /** `YYYY-MM-DD`, or null when unknown. */
  readonly openedOn: string | null;
  /** `YYYY-MM-DD`, or null while the account is open. */
  readonly closedOn: string | null;
  /** Counts toward savings (a flag on the account, not its type). */
  readonly isSavings: boolean;
  /** UTC ISO-8601 timestamp. */
  readonly createdAt: string;
  /** UTC ISO-8601 timestamp. */
  readonly updatedAt: string;
}

/** `account_owner`: one owner of an account and their share in basis points. */
export interface AccountOwnerRow {
  readonly accountId: Id<"Account">;
  readonly personId: Id<"Person">;
  readonly shareBp: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountRepo {
  /** Inserts the account and its owners. */
  insert(row: AccountRow, owners: readonly AccountOwnerRow[]): void;
  /**
   * The account `viewer` may see, or undefined when it does not exist or is another person's
   * private account (the two are indistinguishable). Throws when given no viewer.
   */
  findVisible(viewer: Viewer, id: string): AccountRow | undefined;
  /** The accounts `viewer` may see, oldest first. Throws when given no viewer. */
  list(viewer: Viewer): AccountRow[];
  /** Whether any account exists (deleted ones included). */
  any(): boolean;
  /** The owners of an account, by person ID. */
  owners(accountId: string): AccountOwnerRow[];
  /**
   * Overwrites the mutable columns (name, privacy, institution, dates, savings flag, `updatedAt`)
   * of the account with `row.id`. Throws when there is no such live account; callers find it
   * with `findVisible` first.
   */
  update(row: AccountRow): void;
  /** Replaces every owner of an account with `owners`. */
  replaceOwners(accountId: string, owners: readonly AccountOwnerRow[]): void;
  /**
   * Whether any split of a live transaction of the account has `beneficiary = shared` (AD-7).
   * Soft-deleted transactions do not count.
   */
  hasSharedSplit(accountId: string): boolean;
}

/** `transaction`: one bank line. */
export interface TransactionRow {
  readonly id: Id<"Transaction">;
  readonly accountId: Id<"Account">;
  /** `YYYY-MM-DD`. */
  readonly postedOn: string;
  /** Signed integer minor units. */
  readonly amountCents: number;
  readonly descriptionRaw: string;
  readonly payeeId: Id<"Payee"> | null;
  readonly status: "pending" | "posted";
  /** The bank's own ID for the line; unique per account when present. */
  readonly externalId: string | null;
  /** Hash of the line's identity (see `fingerprint_version`); unique per account. */
  readonly fingerprint: string;
  /** 1 for `ledger/fingerprint.ts`; 0 marks a row that predates fingerprints (its own ID). */
  readonly fingerprintVersion: number;
  /** The import that made the line. No foreign key until the import epic. */
  readonly importId: string | null;
  readonly performedBy: Id<"Person"> | null;
  readonly transferGroupId: Id<"TransferGroup"> | null;
  readonly needsReview: boolean;
  readonly isHidden: boolean;
  readonly nameHiddenBy: Id<"Person"> | null;
  /** UTC ISO-8601 timestamp, or null. */
  readonly nameHiddenUntil: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `split`: where part of a transaction's money went. */
export interface SplitRow {
  readonly id: Id<"Split">;
  readonly transactionId: Id<"Transaction">;
  readonly amountCents: number;
  readonly categoryId: Id<"Category"> | null;
  readonly activityId: Id<"Activity"> | null;
  /** `shared` or a person ID. A private account's splits carry its owner. */
  readonly beneficiary: string;
  /** No foreign key until the property table exists. */
  readonly propertyId: string | null;
  readonly taxCategoryId: Id<"TaxCategory"> | null;
  /** Deductible share in basis points, 0 to 10000, or null when not set. */
  readonly deductibleBp: number | null;
  readonly memo: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A transaction with its splits. */
export interface TransactionWithSplits extends TransactionRow {
  readonly splits: readonly SplitRow[];
}

/**
 * A transaction as a read returns it (AD-4): the name fields come from the `visibleTxn` SQL
 * projection, so a name hidden from this viewer is already null. `redact` renders the
 * placeholder from `nameHidden` and `nameHiddenUntil`.
 */
export interface VisibleTransaction extends Omit<TransactionRow, "descriptionRaw" | "payeeId"> {
  /** Null while the name is hidden from the viewer. */
  readonly descriptionRaw: string | null;
  /** Null while hidden, or when the payee is another person's scoped row. */
  readonly payeeId: Id<"Payee"> | null;
  /** The payee's name; null under the same conditions as `payeeId`. */
  readonly payeeName: string | null;
  /** The payee's logo attachment; null under the same conditions as `payeeId`. */
  readonly logoAttachmentId: string | null;
  /** True while the name is hidden from this viewer. */
  readonly nameHidden: boolean;
  /**
   * "Transfer from <owner>" (inflow) or "Transfer to <owner>" (outflow) when the transfer's
   * counterpart is in the other person's private account; nothing else of it leaves.
   */
  readonly transferLabel: string | null;
  readonly splits: readonly SplitRow[];
}

export interface TransactionRepo {
  /**
   * Inserts the transaction and its splits. A second line with the same `(accountId,
   * externalId)` or `(accountId, fingerprint)` is rejected, deleted lines included.
   */
  insert(row: TransactionRow, splits: readonly SplitRow[]): void;
  /** The live transaction `viewer` may see, with its splits, as of `today`. Throws without a viewer. */
  findVisible(viewer: Viewer, id: string, today: string): VisibleTransaction | undefined;
  /**
   * Soft-deletes a transaction `viewer` may see. False when there is none (or it is already
   * deleted). The row stays for dedupe.
   */
  softDelete(viewer: Viewer, id: string, at: string): boolean;
  /**
   * The transactions `viewer` may see (those of public accounts and of their own private ones),
   * newest first, with their splits, names projected for `today` (`YYYY-MM-DD`, from the
   * clock). Throws when given no viewer.
   */
  listVisible(viewer: Viewer, today: string): VisibleTransaction[];
}

/** What kind of body an institution is. */
export const INSTITUTION_KINDS = ["bank", "broker", "super_fund", "other"] as const;
export type InstitutionKind = (typeof INSTITUTION_KINDS)[number];

/** `institution`: a bank, broker or super fund. */
export interface InstitutionRow {
  readonly id: Id<"Institution">;
  readonly name: string;
  readonly kind: InstitutionKind;
  readonly websiteUrl: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Every read here takes the viewer first (throws without one). Institutions, categories and tax
 * categories are household-wide; `softDelete` hides a row from every read and returns false when
 * there was nothing to delete.
 */
export interface InstitutionRepo {
  insert(row: InstitutionRow): void;
  /** Overwrites name, kind, website and `updatedAt` of the live institution with `row.id`. */
  update(row: InstitutionRow): void;
  find(viewer: Viewer, id: string): InstitutionRow | undefined;
  /** Live institutions by name. */
  list(viewer: Viewer): InstitutionRow[];
  softDelete(id: string, at: string): boolean;
}

export const BALANCE_SOURCES = ["statement", "api", "manual"] as const;
export type BalanceSource = (typeof BALANCE_SOURCES)[number];

/** `balance_snapshot`: an account's balance on one day. */
export interface BalanceSnapshotRow {
  readonly id: Id<"BalanceSnapshot">;
  readonly accountId: Id<"Account">;
  /** `YYYY-MM-DD`. */
  readonly asOf: string;
  readonly balanceCents: number;
  readonly source: BalanceSource;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BalanceSnapshotRepo {
  insert(row: BalanceSnapshotRow): void;
  /** Snapshots of an account `viewer` may see, newest day first; empty for any other account. */
  listVisible(viewer: Viewer, accountId: string): BalanceSnapshotRow[];
  /**
   * The balance of an account `viewer` may see on `date` (`YYYY-MM-DD`), or undefined for any
   * other account (AD-19, in cents): the latest snapshot on or before `date` (ties by
   * `createdAt`, then `id`) plus the live transactions, pending or posted, with `postedOn` after
   * that snapshot's `asOf` and up to `date`; 0 is the start when there is no snapshot. It does
   * not check the account's type; `accounts.balanceAsOf` does.
   */
  balanceAsOf(viewer: Viewer, accountId: string, date: string): number | undefined;
}

export const TRANSFER_MATCHES = ["rule", "manual", "auto"] as const;
export type TransferMatch = (typeof TRANSFER_MATCHES)[number];

/** `transfer_group`: links both sides of a transfer between our own accounts. */
export interface TransferGroupRow {
  readonly id: Id<"TransferGroup">;
  readonly matchedBy: TransferMatch;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransferGroupRepo {
  insert(row: TransferGroupRow): void;
  /** The group, when at least one live transaction in it is visible to `viewer`. */
  find(viewer: Viewer, id: string): TransferGroupRow | undefined;
}

export const CATEGORY_GROUP_KINDS = ["income", "expense", "transfer"] as const;
export type CategoryGroupKind = (typeof CATEGORY_GROUP_KINDS)[number];

/** `category_group`: a report group of categories. Never soft-deleted. */
export interface CategoryGroupRow {
  readonly id: Id<"CategoryGroup">;
  readonly name: string;
  readonly kind: CategoryGroupKind;
  readonly sort: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryGroupRepo {
  insert(row: CategoryGroupRow): void;
  find(viewer: Viewer, id: string): CategoryGroupRow | undefined;
  /** By `sort`, then name. */
  list(viewer: Viewer): CategoryGroupRow[];
}

/** `category`: a leaf category. */
export interface CategoryRow {
  readonly id: Id<"Category">;
  readonly groupId: Id<"CategoryGroup">;
  readonly name: string;
  readonly isFixedCost: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryRepo {
  insert(row: CategoryRow): void;
  find(viewer: Viewer, id: string): CategoryRow | undefined;
  /** Live categories by name. */
  list(viewer: Viewer): CategoryRow[];
  softDelete(id: string, at: string): boolean;
}

/** `tax_category`: an ATO deduction label. */
export interface TaxCategoryRow {
  readonly id: Id<"TaxCategory">;
  readonly code: string;
  readonly label: string;
  /** Basis points, 0 to 10000. */
  readonly defaultDeductibleBp: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaxCategoryRepo {
  insert(row: TaxCategoryRow): void;
  find(viewer: Viewer, id: string): TaxCategoryRow | undefined;
  /** By code. */
  list(viewer: Viewer): TaxCategoryRow[];
}

/**
 * Tags, activities, payees and aliases carry a scope (AD-18): `scopePersonId` null is shared,
 * otherwise the row is that person's alone. The account a scoped row came from is stored but
 * never part of a row type; `insert` takes it as its second argument. A system viewer sees every
 * scope; a person sees shared rows and their own. A live name is unique per scope.
 */
export interface ScopedRows {
  readonly scopePersonId: Id<"Person"> | null;
}

/** `tag`: a free-form label. */
export interface TagRow extends ScopedRows {
  readonly id: Id<"Tag">;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `split_tag`: one tag on one split. */
export interface SplitTagRow {
  readonly splitId: Id<"Split">;
  readonly tagId: Id<"Tag">;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TagRepo {
  insert(row: TagRow, originAccountId: Id<"Account"> | null): void;
  find(viewer: Viewer, id: string): TagRow | undefined;
  list(viewer: Viewer): TagRow[];
  softDelete(id: string, at: string): boolean;
  /** Puts a tag on a split; the same pair twice is rejected. */
  attach(row: SplitTagRow): void;
  /** The tags on a split, for a split whose transaction `viewer` may see; only tags in scope. */
  listForSplit(viewer: Viewer, splitId: string): TagRow[];
}

/** `activity`: a trip or event. */
export interface ActivityRow extends ScopedRows {
  readonly id: Id<"Activity">;
  readonly name: string;
  /** `YYYY-MM-DD`, or null. */
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly budgetCents: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ActivityRepo {
  insert(row: ActivityRow, originAccountId: Id<"Account"> | null): void;
  find(viewer: Viewer, id: string): ActivityRow | undefined;
  list(viewer: Viewer): ActivityRow[];
  softDelete(id: string, at: string): boolean;
}

/** `payee`: a clean merchant identity. */
export interface PayeeRow extends ScopedRows {
  readonly id: Id<"Payee">;
  readonly name: string;
  readonly websiteUrl: string | null;
  /** No foreign key until attachments exist. */
  readonly logoAttachmentId: string | null;
  readonly defaultCategoryId: Id<"Category"> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PayeeRepo {
  insert(row: PayeeRow, originAccountId: Id<"Account"> | null): void;
  find(viewer: Viewer, id: string): PayeeRow | undefined;
  list(viewer: Viewer): PayeeRow[];
  softDelete(id: string, at: string): boolean;
}

export const ALIAS_MATCH_KINDS = ["exact", "contains", "prefix", "regex"] as const;
export type AliasMatchKind = (typeof ALIAS_MATCH_KINDS)[number];

/** `payee_alias`: a raw-description pattern that maps to a payee. */
export interface PayeeAliasRow extends ScopedRows {
  readonly id: Id<"PayeeAlias">;
  readonly pattern: string;
  readonly matchKind: AliasMatchKind;
  readonly payeeId: Id<"Payee">;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PayeeAliasRepo {
  insert(row: PayeeAliasRow, originAccountId: Id<"Account"> | null): void;
  find(viewer: Viewer, id: string): PayeeAliasRow | undefined;
  list(viewer: Viewer): PayeeAliasRow[];
  softDelete(id: string, at: string): boolean;
}

/**
 * `recovery_bundle`: the recovery bundle the household confirmed it stored safely (story 1.17).
 * Only its id, never a secret.
 */
export interface RecoveryBundleRow {
  /** The bundle's id, as `PANGOLIN_RECOVERY_BUNDLE_ID` and the printed bundle give it. */
  readonly bundleId: string;
  /** UTC ISO-8601 timestamp. */
  readonly confirmedAt: string;
}

/** The single `recovery_bundle` row, absent until the first confirmation. */
export interface RecoveryBundleRepo {
  get(): RecoveryBundleRow | undefined;
  /** Inserts or replaces the row. */
  set(row: RecoveryBundleRow): void;
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
  /** Active people with a login, oldest first, with the login's email (from `auth_user`). */
  listLogins(): LoginRow[];
}

/** An active person with a login, as the server console lists them. */
export interface LoginRow {
  readonly personId: Id<"Person">;
  readonly displayName: string;
  readonly email: string;
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
  /** Deletes the newest failed attempt for `email`, if any (a provisional failure released). */
  deleteNewestFailure(email: string): void;
}

/** An audit row as a read returns it (AD-4): hidden names are already removed from the JSON. */
export interface AuditView extends AuditRow {
  /**
   * The date a transaction name in `before`/`after` stays hidden from this viewer, or null.
   * While set, the SQL has removed `descriptionRaw` and `payeeId` from the JSON.
   */
  readonly hiddenUntil: string | null;
}

export interface AuditRepo {
  append(row: AuditRow): void;
  /**
   * The audit rows `viewer` may see, oldest first: rows with no scope, rows of an account the
   * viewer can see and rows scoped to the viewer. Throws when given no viewer.
   */
  listVisible(viewer: Viewer, today: string): AuditView[];
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
  readonly accounts: AccountRepo;
  readonly transactions: TransactionRepo;
  readonly institutions: InstitutionRepo;
  readonly balanceSnapshots: BalanceSnapshotRepo;
  readonly transferGroups: TransferGroupRepo;
  readonly categoryGroups: CategoryGroupRepo;
  readonly categories: CategoryRepo;
  readonly taxCategories: TaxCategoryRepo;
  readonly tags: TagRepo;
  readonly activities: ActivityRepo;
  readonly payees: PayeeRepo;
  readonly payeeAliases: PayeeAliasRepo;
  readonly backups: BackupSnapshotRepo;
  readonly backupVerifications: BackupVerificationRepo;
  readonly recoveryBundle: RecoveryBundleRepo;
}

/** The read-only subset of `TxRepos`, for queries. */
export interface ReadRepos {
  readonly householdSettings: Pick<HouseholdSettingsRepo, "get">;
  readonly person: Pick<PersonRepo, "findByUserId" | "listActive" | "listLogins">;
  readonly users: UserRepo;
  readonly setupLinks: Pick<SetupLinkRepo, "findByTokenHash" | "hasLive">;
  readonly loginAttempts: Pick<LoginAttemptRepo, "listSince">;
  readonly recoveryCodes: Pick<RecoveryCodeRepo, "counts">;
  readonly reEnrolmentLinks: Pick<ReEnrolmentLinkRepo, "findByTokenHash" | "findById">;
  readonly jobs: Pick<
    JobRepo,
    "listDead" | "listPending" | "listRunning" | "countByStatus" | "find" | "firstCreatedAt"
  >;
  readonly audit: Pick<AuditRepo, "listVisible">;
  readonly reviewItems: Pick<ReviewItemRepo, "listOpenFor">;
  readonly accounts: Pick<AccountRepo, "findVisible" | "list" | "owners" | "any">;
  readonly transactions: Pick<TransactionRepo, "listVisible" | "findVisible">;
  readonly institutions: Pick<InstitutionRepo, "find" | "list">;
  readonly balanceSnapshots: Pick<BalanceSnapshotRepo, "listVisible" | "balanceAsOf">;
  readonly transferGroups: Pick<TransferGroupRepo, "find">;
  readonly categoryGroups: Pick<CategoryGroupRepo, "find" | "list">;
  readonly categories: Pick<CategoryRepo, "find" | "list">;
  readonly taxCategories: Pick<TaxCategoryRepo, "find" | "list">;
  readonly tags: Pick<TagRepo, "find" | "list" | "listForSplit">;
  readonly activities: Pick<ActivityRepo, "find" | "list">;
  readonly payees: Pick<PayeeRepo, "find" | "list">;
  readonly payeeAliases: Pick<PayeeAliasRepo, "find" | "list">;
  readonly backups: Pick<BackupSnapshotRepo, "find" | "latestPushed">;
  readonly backupVerifications: Pick<BackupVerificationRepo, "latest">;
  readonly recoveryBundle: Pick<RecoveryBundleRepo, "get">;
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
