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

/** `person`: one of us. `userId` links a login once story 1.5 adds them. */
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
}

export interface AuditRepo {
  append(row: AuditRow): void;
}

/** Repositories bound to one open transaction. They throw once that transaction has ended. */
export interface TxRepos {
  readonly householdSettings: HouseholdSettingsRepo;
  readonly person: PersonRepo;
  readonly audit: AuditRepo;
  readonly jobs: JobRepo;
  readonly reviewItems: ReviewItemRepo;
}

/** The read-only subset of `TxRepos`, for queries. */
export interface ReadRepos {
  readonly householdSettings: Pick<HouseholdSettingsRepo, "get">;
  readonly jobs: Pick<JobRepo, "listDead">;
  readonly reviewItems: Pick<ReviewItemRepo, "listOpenFor">;
}

export interface UnitOfWork {
  /**
   * Runs `fn` synchronously inside one write transaction (`BEGIN IMMEDIATE`). Commits when `fn`
   * returns and rolls back when it throws. Use cases reach this only through `write`.
   */
  transaction<T>(fn: (tx: TxRepos) => T): T;
  /** Runs `fn` synchronously inside one read transaction, for a consistent snapshot. */
  read<T>(fn: (repos: ReadRepos) => T): T;
}
