// The privacy path (AD-3): the one place that says which accounts, and so which transactions,
// a viewer may see. Queries on `account` or `transaction` compose these fragments and never
// write their own filter. Hidden names (`redact`) arrive with epic 2's later entries.
import type { Viewer } from "@pangolin/app";
import { or, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { account } from "./schema/account.ts";
import { accountOwner } from "./schema/account-owner.ts";
import { transaction } from "./schema/transaction.ts";

/**
 * The SQL visibility filter for `account` rows: public accounts plus the viewer's own private
 * ones. Throws without a viewer. A system viewer sees everything (`undefined`: no filter).
 */
export function visibleAccounts(viewer: Viewer | undefined): SQL | undefined {
  if (viewer === undefined || viewer === null) {
    throw new TypeError("visibleAccounts: a viewer is required");
  }
  if (viewer.kind === "system") return undefined;
  return sql`(${account.isPrivate} = 0 OR EXISTS (SELECT 1 FROM ${accountOwner} WHERE ${accountOwner.accountId} = ${account.id} AND ${accountOwner.personId} = ${viewer.personId}))`;
}

/**
 * The SQL visibility filter for `transaction` rows: those of a visible account. Throws without
 * a viewer; `undefined` (no filter) for a system viewer.
 */
export function visibleTxn(viewer: Viewer | undefined): SQL | undefined {
  const accounts = visibleAccounts(viewer);
  if (accounts === undefined) return undefined;
  return sql`${transaction.accountId} IN (SELECT ${account.id} FROM ${account} WHERE ${accounts})`;
}

/**
 * The SQL visibility filter for scoped classification rows (AD-18): shared rows (NULL scope)
 * plus the viewer's own. Throws without a viewer; `undefined` (no filter) for a system viewer.
 */
export function visibleScope(
  scopePersonId: SQLiteColumn,
  viewer: Viewer | undefined,
): SQL | undefined {
  if (viewer === undefined || viewer === null) {
    throw new TypeError("visibleScope: a viewer is required");
  }
  if (viewer.kind === "system") return undefined;
  return or(sql`${scopePersonId} IS NULL`, sql`${scopePersonId} = ${viewer.personId}`);
}

/** Throws without a viewer; for reads of household-wide rows that have no filter of their own. */
export function requireViewer(viewer: Viewer | undefined, what: string): void {
  if (viewer === undefined || viewer === null) {
    throw new TypeError(`${what}: a viewer is required`);
  }
}
