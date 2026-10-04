// The privacy path (AD-3, AD-4, AD-5): the one place that says which accounts, and so which
// transactions and audit rows, a viewer may see, and what a hidden name looks like. Queries on
// `account`, `transaction` or `audit_log` compose these fragments and never write their own
// filter; biome's import ban and `read-rule.test.ts` keep the schema files out of every other
// file. `redact` (in `app`) only formats what these projections already nulled.
import type { Viewer } from "@pangolin/app";
import { or, type SQL, sql } from "drizzle-orm";
import { alias, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import { account } from "./schema/account.ts";
import { accountOwner } from "./schema/account-owner.ts";
import { auditLog } from "./schema/audit-log.ts";
import { payee } from "./schema/payee.ts";
import { person } from "./schema/person.ts";
import { transaction } from "./schema/transaction.ts";

/**
 * The SQL visibility filter for `account` rows: live accounts that are public or the viewer's
 * own private ones. Throws without a viewer. A system viewer sees every live account.
 */
export function visibleAccounts(viewer: Viewer | undefined): SQL {
  if (viewer === undefined || viewer === null) {
    throw new TypeError("visibleAccounts: a viewer is required");
  }
  if (viewer.kind === "system") return sql`${account.deletedAt} IS NULL`;
  return sql`(${account.deletedAt} IS NULL AND (${account.isPrivate} = 0 OR EXISTS (SELECT 1 FROM ${accountOwner} WHERE ${accountOwner.accountId} = ${account.id} AND ${accountOwner.personId} = ${viewer.personId})))`;
}

/** `column IN (the ids of the accounts the viewer may see)`. Throws without a viewer. */
export function visibleAccountId(column: SQLiteColumn, viewer: Viewer | undefined): SQL {
  const accounts = visibleAccounts(viewer);
  return sql`${column} IN (SELECT ${account.id} FROM ${account} WHERE ${accounts})`;
}

/** Live transactions of visible accounts. Throws without a viewer. Not name-aware. */
export function liveVisibleTxn(viewer: Viewer | undefined): SQL {
  return sql`(${transaction.deletedAt} IS NULL AND ${visibleAccountId(transaction.accountId, viewer)})`;
}

/** `column IN (the ids of the live transactions the viewer may see)`. Throws without a viewer. */
export function visibleTxnId(column: SQLiteColumn, viewer: Viewer | undefined): SQL {
  const rows = liveVisibleTxn(viewer);
  return sql`${column} IN (SELECT ${transaction.id} FROM ${transaction} WHERE ${rows})`;
}

/** The SQL projection of `transaction` for one viewer on one day (AD-4). */
export interface TxnProjection {
  /** Live transactions of visible accounts. */
  readonly where: SQL;
  /** 1 while the name is hidden from this viewer, else 0. */
  readonly hidden: SQL;
  /** `description_raw`, NULL while hidden. */
  readonly descriptionRaw: SQL;
  /** `payee_id`, NULL while hidden or when the payee is another person's scoped row. */
  readonly payeeId: SQL;
  /** The payee's name, NULL under the same conditions as `payeeId`. */
  readonly payeeName: SQL;
  /** The payee's logo attachment, NULL under the same conditions as `payeeId`. */
  readonly logoAttachmentId: SQL;
  /**
   * "Transfer from <owner>" or "Transfer to <owner>" (by the sign of the amount) when the
   * transfer's counterpart is in another person's private account, else NULL.
   */
  readonly transferLabel: SQL;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function requireDay(today: string, what: string): void {
  if (typeof today !== "string" || !DAY.test(today)) {
    throw new TypeError(`${what}: today must be a YYYY-MM-DD string`);
  }
}

/**
 * The projection every transaction read goes through (AD-4). Hiding applies to transactions of
 * shared accounts, for any person other than `name_hidden_by`, while `name_hidden_until` is
 * after `today` (the name shows on that date). A system viewer sees every name. Throws without
 * a viewer. `today` is `YYYY-MM-DD`, from `ctx.clock.today()`: repositories never see the clock.
 */
export function visibleTxn(viewer: Viewer | undefined, today: string): TxnProjection {
  const where = liveVisibleTxn(viewer);
  requireDay(today, "visibleTxn");
  if (viewer === undefined || viewer === null)
    throw new TypeError("visibleTxn: a viewer is required");
  const person_ = viewer.kind === "person" ? viewer.personId : undefined;

  const hidden =
    person_ === undefined
      ? sql`0`
      : sql`(CASE WHEN ${transaction.nameHiddenUntil} IS NOT NULL
          AND substr(${transaction.nameHiddenUntil}, 1, 10) > ${today}
          AND ${transaction.nameHiddenBy} IS NOT ${person_}
          AND (SELECT ${account.isPrivate} FROM ${account} WHERE ${account.id} = ${transaction.accountId}) = 0
        THEN 1 ELSE 0 END)`;

  const scope = visibleScope(payee.scopePersonId, viewer);
  const payeeVisible = scope === undefined ? sql`1` : sql`${scope}`;
  const payeeOk = sql`(${transaction.payeeId} IS NOT NULL AND ${hidden} = 0 AND EXISTS (SELECT 1 FROM ${payee} WHERE ${payee.id} = ${transaction.payeeId} AND ${payeeVisible}))`;

  const cp = alias(transaction, "cp");
  const ca = alias(account, "ca");
  const co = alias(accountOwner, "co");
  const cv = alias(accountOwner, "cv");
  const owner = alias(person, "cpo");
  const counterpartOwner =
    person_ === undefined
      ? sql`NULL`
      : sql`(SELECT ${owner.displayName} FROM ${transaction} ${cp}
          JOIN ${account} ${ca} ON ${ca.id} = ${cp.accountId}
          JOIN ${accountOwner} ${co} ON ${co.accountId} = ${ca.id}
          JOIN ${person} ${owner} ON ${owner.id} = ${co.personId}
          WHERE ${cp.transferGroupId} = ${transaction.transferGroupId}
            AND ${cp.id} <> ${transaction.id}
            AND ${cp.deletedAt} IS NULL
            AND ${ca.deletedAt} IS NULL
            AND ${ca.isPrivate} = 1
            AND NOT EXISTS (SELECT 1 FROM ${accountOwner} ${cv} WHERE ${cv.accountId} = ${ca.id} AND ${cv.personId} = ${person_})
          ORDER BY ${co.createdAt}, ${owner.id} LIMIT 1)`;

  return {
    where,
    hidden,
    descriptionRaw: sql`(CASE WHEN ${hidden} = 1 THEN NULL ELSE ${transaction.descriptionRaw} END)`,
    payeeId: sql`(CASE WHEN ${payeeOk} THEN ${transaction.payeeId} ELSE NULL END)`,
    payeeName: sql`(CASE WHEN ${payeeOk} THEN (SELECT ${payee.name} FROM ${payee} WHERE ${payee.id} = ${transaction.payeeId}) ELSE NULL END)`,
    logoAttachmentId: sql`(CASE WHEN ${payeeOk} THEN (SELECT ${payee.logoAttachmentId} FROM ${payee} WHERE ${payee.id} = ${transaction.payeeId}) ELSE NULL END)`,
    transferLabel: sql`(CASE WHEN ${transaction.transferGroupId} IS NULL THEN NULL
      WHEN ${counterpartOwner} IS NULL THEN NULL
      WHEN ${transaction.amountCents} >= 0 THEN 'Transfer from ' || ${counterpartOwner}
      ELSE 'Transfer to ' || ${counterpartOwner} END)`,
  };
}

/**
 * The SQL visibility filter for `audit_log` rows (AD-3, AD-17): rows with no scope, rows of a
 * visible account, and rows scoped to the viewer. Throws without a viewer; `undefined` (no
 * filter) for a system viewer.
 */
export function visibleAudit(viewer: Viewer | undefined): SQL | undefined {
  if (viewer === undefined || viewer === null) {
    throw new TypeError("visibleAudit: a viewer is required");
  }
  if (viewer.kind === "system") return undefined;
  return sql`((${auditLog.accountId} IS NULL OR ${visibleAccountId(auditLog.accountId, viewer)}) AND (${auditLog.personId} IS NULL OR ${auditLog.personId} = ${viewer.personId}))`;
}

/**
 * The date until which an audit row of a transaction carries a name hidden from this viewer, or
 * NULL. A row is hidden when the transaction is hidden now, or the row's own before or after
 * state was hiding it, in a shared account. Not checked for a system viewer (NULL).
 */
export function auditHiddenUntil(viewer: Viewer | undefined, today: string): SQL {
  requireDay(today, "auditHiddenUntil");
  if (viewer === undefined || viewer === null) {
    throw new TypeError("auditHiddenUntil: a viewer is required");
  }
  if (viewer.kind === "system") return sql`NULL`;
  const me = viewer.personId;
  const state = (json: SQLiteColumn) => sql`(CASE
    WHEN json_extract(${json}, '$.nameHiddenUntil') IS NOT NULL
      AND substr(json_extract(${json}, '$.nameHiddenUntil'), 1, 10) > ${today}
      AND json_extract(${json}, '$.nameHiddenBy') IS NOT ${me}
      AND (SELECT ${account.isPrivate} FROM ${account} WHERE ${account.id} = ${auditLog.accountId}) = 0
    THEN json_extract(${json}, '$.nameHiddenUntil') END)`;
  const current = sql`(SELECT ${transaction.nameHiddenUntil} FROM ${transaction}
      WHERE ${transaction.id} = ${auditLog.entityId}
        AND ${transaction.nameHiddenUntil} IS NOT NULL
        AND substr(${transaction.nameHiddenUntil}, 1, 10) > ${today}
        AND ${transaction.nameHiddenBy} IS NOT ${me}
        AND (SELECT ${account.isPrivate} FROM ${account} WHERE ${account.id} = ${transaction.accountId}) = 0)`;
  return sql`(CASE WHEN ${auditLog.entity} = 'transaction'
    THEN (SELECT max(v) FROM (SELECT ${current} AS v UNION ALL SELECT ${state(auditLog.before)} UNION ALL SELECT ${state(auditLog.after)}))
    END)`;
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
