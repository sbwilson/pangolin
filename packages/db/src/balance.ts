// The one balance function (AD-19). Every balance of a cash-type account (transaction, savings,
// offset, credit card, home loan) is computed here, as plain SQL on a connection: `accounts`
// reads it through the repository under the viewer's visibility, and the backup manifest
// (entry 9) calls it under SystemViewer. It names tables as text, so it needs no schema import.
import type { Db } from "./open.ts";

/**
 * The balance on `:date` of account `:account`, in cents: the latest snapshot on or before the
 * date (ties by `created_at`, then `id`) plus the live transactions, pending and posted, posted
 * after that snapshot's `as_of` (which counts the whole day) and up to the date. With no
 * snapshot the start is 0 and every live transaction up to the date counts.
 */
export const BALANCE_AS_OF_SQL = `
WITH snap AS (
  SELECT as_of, balance_cents FROM balance_snapshot
  WHERE account_id = :account AND as_of <= :date
  ORDER BY as_of DESC, created_at DESC, id DESC
  LIMIT 1
)
SELECT
  COALESCE((SELECT balance_cents FROM snap), 0)
  + COALESCE((
      SELECT SUM(amount_cents) FROM "transaction"
      WHERE account_id = :account
        AND deleted_at IS NULL
        AND posted_on <= :date
        AND posted_on > COALESCE((SELECT as_of FROM snap), '')
    ), 0) AS balance_cents`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Computes `BALANCE_AS_OF_SQL` for one account on one `YYYY-MM-DD` day. Applies no visibility:
 * the caller has already decided the account may be read (the repository does, the manifest
 * runs as the system). Never checks the account's type.
 */
export function balanceAsOf(db: Pick<Db, "prepare">, accountId: string, date: string): number {
  if (typeof date !== "string" || !DAY.test(date)) {
    throw new TypeError("balanceAsOf: date must be a YYYY-MM-DD string");
  }
  const row = db.prepare(BALANCE_AS_OF_SQL).get({ account: accountId, date }) as {
    balance_cents: number;
  };
  return row.balance_cents;
}
