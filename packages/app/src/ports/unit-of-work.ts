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
  /** The number of open items whose `entityRef` is `entityRef`. */
  countOpenForEntity(entityRef: string): number;
  /**
   * Resolves every open item whose `entityRef` is `entityRef`, oldest first. Returns each
   * before and after; empty when none was open.
   */
  resolveOpenForEntity(
    entityRef: string,
    resolvedAt: string,
    resolution: string,
  ): { readonly before: ReviewItemRow; readonly after: ReviewItemRow }[];
  /**
   * Open items `viewer` may see, oldest first (AD-3, AD-17). Throws when given no viewer.
   * A person sees household items, items of an account they can see, and their own. A system
   * viewer sees every item.
   */
  listOpenFor(viewer: Viewer): ReviewItemRow[];
  /** Hard-deletes every item of account `accountId`, open or resolved; returns how many. */
  deleteForAccount(accountId: string): number;
  /** Hard-deletes every item scoped to `personId`, open or resolved; returns how many. */
  deleteForPerson(personId: string): number;
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
   * Whether any split of a live transaction of the account has a beneficiary other than
   * `ownerId`: `shared` or another person (AD-7). Soft-deleted transactions do not count.
   */
  hasSplitForOthers(accountId: string, ownerId: string): boolean;
  /**
   * The owner-scoped payees, tags and activities (AD-18) that live transactions of the account
   * use: a transaction's payee, a split's activity, a split's tags. A soft-deleted scoped row
   * still counts while a live transaction uses it. Each list is distinct, sorted by name then ID.
   */
  scopedReferences(accountId: string): ScopedReferences;
  /**
   * Every account `personId` owns, soft-deleted ones included, whatever its privacy, oldest
   * first, each with whether it is soft-deleted. For the household leave, which reaches the
   * leaver's accounts in every state (a use-case read; never behind `SystemViewer`, AD-6).
   */
  ownedBy(personId: string): OwnedAccount[];
  /**
   * Hard-deletes the owner rows and the account row of `accountId`, soft-deleted or not. The
   * caller deletes the rows that point at the account first (foreign keys). Only the household
   * leave calls it.
   */
  deleteRows(accountId: string): void;
}

/** An account as the household leave finds it: the row and whether it is soft-deleted. */
export interface OwnedAccount {
  readonly row: AccountRow;
  readonly deleted: boolean;
}

/** An owner-scoped classification row that an account's transactions use. */
export interface ScopedReference {
  readonly id: string;
  readonly name: string;
}

/** What `AccountRepo.scopedReferences` returns. */
export interface ScopedReferences {
  readonly payees: readonly ScopedReference[];
  readonly tags: readonly ScopedReference[];
  readonly activities: readonly ScopedReference[];
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

/** Where a classified split field's value came from; precedence is in `ledger/provenance.ts`. */
export const SPLIT_SOURCES = ["user", "rule", "payee", "activity", "llm"] as const;
export type SplitSource = (typeof SPLIT_SOURCES)[number];

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
  /** Provenance per classified field: null means unset, so any source may write. */
  readonly categorySource: SplitSource | null;
  readonly activitySource: SplitSource | null;
  readonly taxCategorySource: SplitSource | null;
  readonly beneficiarySource: SplitSource | null;
  readonly deductibleBpSource: SplitSource | null;
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
export interface VisibleTransaction
  extends Omit<TransactionRow, "descriptionRaw" | "payeeId" | "fingerprint" | "externalId"> {
  /** Null while the name is hidden from the viewer. */
  readonly descriptionRaw: string | null;
  /**
   * Null while the name is hidden from the viewer: a v1 fingerprint hashes the description, so
   * it would let the partner guess a hidden name.
   */
  readonly fingerprint: string | null;
  /** Null while the name is hidden from the viewer (a bank's ID can carry the description). */
  readonly externalId: string | null;
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

/**
 * What a transaction list may be narrowed by. Every field is optional and they combine with AND.
 * The name-bearing ones (`payeeId`, `hidden`) are decided on the viewer's projection, never the
 * stored columns, so a filter by another person's scoped payee, tag or hidden name matches
 * nothing (AD-4, AD-18).
 */
export interface TransactionFilter {
  readonly accountId?: string | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  readonly from?: string | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  readonly to?: string | undefined;
  /** Some split carries this category. */
  readonly categoryId?: string | undefined;
  /** Some split carries this tag (a tag the viewer may not see matches nothing). */
  readonly tagId?: string | undefined;
  /** The payee as the viewer sees it (NULL while hidden or scoped to another person). */
  readonly payeeId?: string | undefined;
  /** The least `abs(amountCents)`. */
  readonly minCents?: number | undefined;
  /** The most `abs(amountCents)`. */
  readonly maxCents?: number | undefined;
  /** `in` is a positive amount, `out` a negative one. */
  readonly type?: "in" | "out" | undefined;
  /** At least one split has no category. */
  readonly uncategorised?: true | undefined;
  /** Rows that belong to a transfer group. */
  readonly transfers?: true | undefined;
  /** Rows whose name is hidden from this viewer now. */
  readonly hidden?: true | undefined;
}

/** A position in the list order (`postedOn` desc, `id` desc). */
export interface TransactionCursor {
  readonly postedOn: string;
  readonly id: string;
}

/** Where a page starts: strictly after or before a cursor, or `offset` rows in. */
export type TransactionPageAt =
  | { readonly after: TransactionCursor }
  | { readonly before: TransactionCursor }
  | { readonly offset: number };

/** Money in and out over a filter, worked out in SQL (the web never sums). */
export interface TransactionSummary {
  readonly count: number;
  /** The sum of the positive amounts. */
  readonly inCents: number;
  /** The sum of the negative amounts, as a non-negative number. */
  readonly outCents: number;
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
   * The live transaction `viewer` may see, with its splits, as stored: no name is hidden. Only
   * for audit snapshots and rules decided on stored columns inside a write; never returned to a
   * viewer, so it is not in `ReadRepos`. Throws without a viewer.
   */
  findStored(viewer: Viewer, id: string): TransactionWithSplits | undefined;
  /**
   * Overwrites the posting date, amount, description and notes of the live transaction `viewer`
   * may see, and `updatedAt`. Never touches the fingerprint, status, `performedBy`, payee or
   * hidden-name fields. False when there is none.
   */
  update(
    viewer: Viewer,
    change: {
      readonly id: string;
      readonly postedOn: string;
      readonly amountCents: number;
      /** Omitted to leave the description alone (it may be hidden from this viewer). */
      readonly descriptionRaw?: string;
      readonly notes: string | null;
      readonly updatedAt: string;
    },
  ): boolean;
  /** Sets the amount of one split (and its `updatedAt`). False when there is no such split. */
  updateSplitAmount(splitId: string, amountCents: number, at: string): boolean;
  /**
   * Makes `splits` the splits of transaction `transactionId`: a row whose ID exists is updated in
   * place (every column but `createdAt`), a new ID is inserted, and an existing split not listed
   * is deleted together with its `split_tag` rows. Rejects a split whose transaction is another.
   */
  replaceSplits(transactionId: string, splits: readonly SplitRow[]): void;
  /**
   * Overwrites the mutable columns of one split (amount, classified fields and their sources,
   * property, memo, `updatedAt`). False when there is no such split.
   */
  updateSplit(row: SplitRow): boolean;
  /**
   * Sets `needs_review` on transaction `id`, whatever its state or viewer (a derived flag kept
   * by `ledger` from open review items). Writes, and bumps `updatedAt`, only when the value
   * changes. Returns whether it did.
   */
  setNeedsReview(id: string, value: boolean, at: string): boolean;
  /**
   * Sets (or, with `null` for both, clears) `name_hidden_by` and `name_hidden_until` on the live
   * transaction `viewer` may see, and bumps `updatedAt`. Nothing else changes. False when there
   * is none. The caller owns the rules (cap, ownership, private accounts).
   */
  setNameHidden(
    viewer: Viewer,
    id: string,
    by: string | null,
    until: string | null,
    at: string,
  ): boolean;
  /**
   * Sets `transfer_group_id` to `groupId` (null clears it) on every transaction in `ids`, live or
   * deleted, whatever the viewer, bumping `updatedAt`. Returns how many rows it changed.
   */
  setTransferGroup(ids: readonly string[], groupId: string | null, at: string): number;
  /**
   * Soft-deletes a transaction `viewer` may see. False when there is none (or it is already
   * deleted). The row stays for dedupe.
   */
  softDelete(viewer: Viewer, id: string, at: string): boolean;
  /**
   * The latest `postedOn` (`YYYY-MM-DD`) among the live transactions of account `accountId` that
   * `viewer` may see, pending or posted; undefined when there is none. Throws without a viewer.
   */
  latestPostedOn(viewer: Viewer, accountId: string): string | undefined;
  /**
   * The live transactions of account `accountId` that `viewer` may see with `postedOn` after
   * `day` (`YYYY-MM-DD`), read from the stored columns (not the hidden-name projection): the
   * manually entered ones (`importId` and `externalId` both null), oldest first, at most
   * `limit`, and the number of imported ones (any other). Throws without a viewer.
   */
  listManualAfter(
    viewer: Viewer,
    accountId: string,
    day: string,
    limit: number,
  ): {
    readonly manual: readonly { readonly id: string; readonly postedOn: string }[];
    readonly importedCount: number;
  };
  /**
   * The transactions `viewer` may see (those of public accounts and of their own private ones),
   * newest first, with their splits, names projected for `today` (`YYYY-MM-DD`, from the
   * clock). Throws when given no viewer.
   */
  listVisible(viewer: Viewer, today: string): VisibleTransaction[];
  /**
   * One page of `listVisible` narrowed by `filter`, at most `limit` rows, in list order (newest
   * first, `id` descending): `after` the rows that follow a cursor, `before` the `limit` rows
   * that precede it (still newest first), or `offset` rows in. Throws when given no viewer.
   */
  listPage(
    viewer: Viewer,
    today: string,
    filter: TransactionFilter,
    at: TransactionPageAt,
    limit: number,
  ): VisibleTransaction[];
  /** The count and the money in and out of every row `listPage` could return for `filter`. */
  summarise(viewer: Viewer, today: string, filter: TransactionFilter): TransactionSummary;
  /** How many rows `filter` leaves that come strictly before `cursor` in list order. */
  countBefore(
    viewer: Viewer,
    today: string,
    filter: TransactionFilter,
    cursor: TransactionCursor,
  ): number;
  /**
   * The net (sum of amounts) of every row `filter` leaves on each of `days` (`YYYY-MM-DD`); a
   * day with no row is absent.
   */
  dayNets(
    viewer: Viewer,
    today: string,
    filter: TransactionFilter,
    days: readonly string[],
  ): Record<string, number>;
  /**
   * Every transaction, soft-deleted ones included, whose name `personId` hid (`nameHiddenBy`),
   * with its splits, as stored, whatever the viewer or the account's privacy. For the household
   * leave, which lifts them; never returned to a viewer, so it is not in `ReadRepos`.
   */
  hidingsBy(personId: string): TransactionWithSplits[];
  /**
   * Clears `name_hidden_by` and `name_hidden_until` on every transaction in `ids`, whatever the
   * viewer, bumping `updatedAt`. Returns how many rows it changed.
   */
  clearNameHidden(ids: readonly string[], at: string): number;
  /**
   * Clears `payee_id` on every transaction, whatever its account, whose payee is scoped to
   * `personId`. Touches nothing else, `updatedAt` included. Returns how many rows it changed.
   */
  clearScopedPayees(personId: string): number;
  /**
   * Clears `transfer_group_id` on every transaction in group `groupId`, live or deleted, whatever
   * the viewer, touching nothing else (the caller audits the survivors it read first). Returns
   * how many rows it changed.
   */
  unlinkGroup(groupId: string): number;
  /**
   * Hard-deletes every transaction of account `accountId`, soft-deleted ones included, with
   * their splits and split tags. Only the household leave calls it; the caller has unlinked the
   * transfer groups first.
   */
  deleteForAccount(accountId: string): void;
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
  /** Hard-deletes every snapshot of `accountId`; returns how many. Only the household leave. */
  deleteForAccount(accountId: string): number;
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
  /** Deletes the group row; false when absent. Clear its members first (foreign key). */
  delete(id: string): boolean;
  /**
   * The live transactions in the group that `viewer` may see, by ID, and how many other live
   * ones it may not (`hidden`). A soft-deleted member is neither. The caller refuses when
   * `hidden > 0`, so a refusal names nothing about a row the viewer cannot see.
   */
  members(viewer: Viewer, id: string): { rows: TransactionRow[]; hidden: number };
  /**
   * Every live transaction in the group, whatever the viewer, by ID (raw). For upkeep that must
   * reach a member the viewer cannot see, such as unlinking a survivor when its other side is
   * deleted. A use-case read on this port; never behind `SystemViewer` on the HTTP path (AD-6),
   * and not part of `ReadRepos`.
   */
  upkeepMembers(id: string): TransactionRow[];
  /**
   * The IDs of the groups with a transaction, live or deleted, in account `accountId`, by ID.
   * For the household leave, which dissolves them.
   */
  idsInAccount(accountId: string): string[];
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
  /** Overwrites name, kind, sort and `updatedAt` of the group with `row.id`; throws when absent. */
  update(row: CategoryGroupRow): void;
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
  /** Overwrites group, name, fixed-cost flag and `updatedAt` of the live category; throws when absent. */
  update(row: CategoryRow): void;
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
  /** Overwrites code, label, default share and `updatedAt` of the tax category; throws when absent. */
  update(row: TaxCategoryRow): void;
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
  /**
   * Overwrites the mutable fields and `updatedAt` of the live row with `row.id` when `viewer`
   * may see it; false (changing nothing) otherwise. Scope and origin never change.
   */
  update(viewer: Viewer, row: TagRow): boolean;
  /** Soft-deletes a live row `viewer` may see; false when there is none. */
  softDelete(viewer: Viewer, id: string, at: string): boolean;
  /** The origin account stored with a row `viewer` may see: non-null only for a private origin. */
  originOf(viewer: Viewer, id: string): Id<"Account"> | null | undefined;
  /**
   * Makes `tagIds` the tag set of a split among the tags `viewer` can see (live, in scope):
   * other visible tags are detached, missing ones attached at `at`. Tags the viewer cannot see
   * stay on the split untouched.
   */
  replaceForSplit(viewer: Viewer, splitId: string, tagIds: readonly string[], at: string): void;
  /** The tags on a split, for a split whose transaction `viewer` may see; only tags in scope. */
  listForSplit(viewer: Viewer, splitId: string): TagRow[];
  /**
   * The same for many splits in one read: one entry per (split, tag), by split ID, then tag name
   * and ID. Splits of a transaction `viewer` may not see, and tags out of scope, are absent.
   */
  listForSplits(viewer: Viewer, splitIds: readonly string[]): SplitTagged[];
  /**
   * Hard-deletes every tag scoped to `personId`, live or deleted, with its `split_tag` rows;
   * returns how many tags. Only the household leave calls it.
   */
  deleteScopedTo(personId: string): number;
}

/** One tag on one split, from `TagRepo.listForSplits`. */
export interface SplitTagged {
  readonly splitId: Id<"Split">;
  readonly tag: TagRow;
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
  /**
   * Overwrites the mutable fields and `updatedAt` of the live row with `row.id` when `viewer`
   * may see it; false (changing nothing) otherwise. Scope and origin never change.
   */
  update(viewer: Viewer, row: ActivityRow): boolean;
  /** Soft-deletes a live row `viewer` may see; false when there is none. */
  softDelete(viewer: Viewer, id: string, at: string): boolean;
  /** The origin account stored with a row `viewer` may see: non-null only for a private origin. */
  originOf(viewer: Viewer, id: string): Id<"Account"> | null | undefined;
  /**
   * Hard-deletes every activity scoped to `personId`, live or deleted, clearing the `activityId`
   * of the splits that name one (their `updatedAt` stays); returns how many activities. Only
   * the household leave calls it.
   */
  deleteScopedTo(personId: string): number;
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

/** A scoped row as it was, with the origin account stored for it, for the audit of a cascade. */
export interface ScopedBefore<R> {
  readonly before: R;
  readonly originAccountId: Id<"Account"> | null;
}

export interface PayeeRepo {
  insert(row: PayeeRow, originAccountId: Id<"Account"> | null): void;
  /**
   * Clears `defaultCategoryId` on every live payee that has `categoryId`, whatever its scope
   * (a household-wide cascade of a category delete). Returns the payees as they were.
   */
  clearDefaultCategory(categoryId: string, at: string): ScopedBefore<PayeeRow>[];
  find(viewer: Viewer, id: string): PayeeRow | undefined;
  list(viewer: Viewer): PayeeRow[];
  /**
   * Overwrites the mutable fields and `updatedAt` of the live row with `row.id` when `viewer`
   * may see it; false (changing nothing) otherwise. Scope and origin never change.
   */
  update(viewer: Viewer, row: PayeeRow): boolean;
  /** Soft-deletes a live row `viewer` may see; false when there is none. */
  softDelete(viewer: Viewer, id: string, at: string): boolean;
  /** The origin account stored with a row `viewer` may see: non-null only for a private origin. */
  originOf(viewer: Viewer, id: string): Id<"Account"> | null | undefined;
  /**
   * Hard-deletes every payee scoped to `personId`, live or deleted; returns how many. The caller
   * has cleared the transactions and deleted the aliases that point at them first (foreign
   * keys). Only the household leave calls it.
   */
  deleteScopedTo(personId: string): number;
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
  /**
   * Soft-deletes every live alias of `payeeId`, whatever its scope (a cascade of a payee
   * delete). Returns the aliases as they were.
   */
  softDeleteForPayee(payeeId: string, at: string): ScopedBefore<PayeeAliasRow>[];
  find(viewer: Viewer, id: string): PayeeAliasRow | undefined;
  list(viewer: Viewer): PayeeAliasRow[];
  /**
   * Overwrites the mutable fields and `updatedAt` of the live row with `row.id` when `viewer`
   * may see it; false (changing nothing) otherwise. Scope and origin never change.
   */
  update(viewer: Viewer, row: PayeeAliasRow): boolean;
  /** Soft-deletes a live row `viewer` may see; false when there is none. */
  softDelete(viewer: Viewer, id: string, at: string): boolean;
  /** The origin account stored with a row `viewer` may see: non-null only for a private origin. */
  originOf(viewer: Viewer, id: string): Id<"Account"> | null | undefined;
  /**
   * Hard-deletes every alias scoped to `personId`, and every alias of a payee scoped to
   * `personId`, whatever its own scope; live or deleted. Returns how many. Only the household
   * leave calls it.
   */
  deleteScopedTo(personId: string): number;
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
  /**
   * Marks the active person `id` as left: sets `deleted_at` and `updated_at` to `at`. False,
   * changing nothing, when there is no such active person. The row stays, so what names it
   * (an owner row, a `performed_by`) still reads as a former member.
   */
  markLeft(id: Id<"Person">, at: string): boolean;
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
   * While set, the SQL has nulled `descriptionRaw`, `payeeId`, `fingerprint` and `externalId`
   * where the JSON has them (never adding one). Hidden or not, a `payeeId` naming a payee
   * the viewer may not see (another person's scoped one) is nulled too, and JSON that is not
   * valid comes back null.
   */
  readonly hiddenUntil: string | null;
}

/** One owner of an account in an audit row's owner list. */
export interface AuditedOwner {
  readonly personId: string;
  readonly shareBp: number;
}

/** An `update` audit row of an account, read for its owner lists. */
export interface OwnerChange {
  readonly id: Id<"AuditLog">;
  /** UTC ISO-8601 timestamp of the change. */
  readonly at: string;
  /** `person:<id>`, `job:<kind>` or `cli:<command>`. */
  readonly actor: string;
  readonly before: readonly AuditedOwner[];
  readonly after: readonly AuditedOwner[];
}

export interface AuditRepo {
  append(row: AuditRow): void;
  /**
   * The account's `update` audit rows that `viewer` may see and that carry an owner list in both
   * `before` and `after` (rows without one are left out), oldest first (by `at`, then `id`). It
   * returns every such row, whether or not the owners changed. Throws when given no viewer.
   */
  ownerChanges(viewer: Viewer, accountId: string): OwnerChange[];
  /**
   * The audit rows `viewer` may see, oldest first: rows with no scope, rows of an account the
   * viewer can see and rows scoped to the viewer. Throws when given no viewer.
   */
  listVisible(viewer: Viewer, today: string): AuditView[];
  /**
   * Scopes the account's unscoped audit rows recorded while it was private to `personId`: the
   * rows after its most recent `set_privacy` row that switched it from public to private (before
   * `isPrivate: false`, after `isPrivate: true`; by `at`, then `id`), or all its rows when there
   * is none (it was created private). Rows from a
   * joint period stay unscoped. Sets `person_id` only, never the content. Write-only.
   */
  scopeToPerson(accountId: string, personId: string): void;
  /**
   * Hard-deletes every audit row carrying `accountId`; returns how many. Write-only, for the
   * household leave: the audit trail is append-only everywhere else.
   */
  deleteForAccount(accountId: string): number;
  /**
   * Hard-deletes every audit row scoped to `personId` (`person_id`); returns how many.
   * Write-only, for the household leave.
   */
  deleteForPerson(personId: string): number;
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
  readonly audit: Pick<AuditRepo, "listVisible" | "ownerChanges">;
  readonly reviewItems: Pick<ReviewItemRepo, "listOpenFor">;
  readonly accounts: Pick<AccountRepo, "findVisible" | "list" | "owners" | "any">;
  readonly transactions: Pick<
    TransactionRepo,
    "listVisible" | "findVisible" | "listPage" | "summarise" | "countBefore" | "dayNets"
  >;
  readonly institutions: Pick<InstitutionRepo, "find" | "list">;
  readonly balanceSnapshots: Pick<BalanceSnapshotRepo, "listVisible" | "balanceAsOf">;
  readonly transferGroups: Pick<TransferGroupRepo, "find">;
  readonly categoryGroups: Pick<CategoryGroupRepo, "find" | "list">;
  readonly categories: Pick<CategoryRepo, "find" | "list">;
  readonly taxCategories: Pick<TaxCategoryRepo, "find" | "list">;
  readonly tags: Pick<TagRepo, "find" | "list" | "listForSplit" | "listForSplits">;
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
