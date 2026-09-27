// The write-transaction port (AD-1, AD-2). Implemented in `packages/db`. Every repository
// method is synchronous: a use case does its async I/O first, then opens one short transaction.
import type { Id } from "@pangolin/shared";

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

export interface HouseholdSettingsRepo {
  get(): HouseholdSettingsRow;
  update(row: HouseholdSettingsRow): void;
}

export interface AuditRepo {
  append(row: AuditRow): void;
}

/** Repositories bound to one open transaction. They throw once that transaction has ended. */
export interface TxRepos {
  readonly householdSettings: HouseholdSettingsRepo;
  readonly audit: AuditRepo;
}

/** The read-only subset of `TxRepos`, for queries. */
export interface ReadRepos {
  readonly householdSettings: Pick<HouseholdSettingsRepo, "get">;
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
