import type { SplitRow, TransactionRow, VisibleTransaction } from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";
import type { Viewer } from "../viewer.ts";
import type { LedgerTransaction } from "./list-transactions.ts";

/** The stored columns of a transaction and its splits, for an audit row's before and after. */
export function auditSnapshot(row: VisibleTransaction): Omit<
  TransactionRow,
  "descriptionRaw" | "payeeId"
> & {
  readonly descriptionRaw: string | null;
  readonly payeeId: string | null;
  readonly splits: readonly SplitRow[];
} {
  const { payeeName: _n, logoAttachmentId: _l, nameHidden: _h, transferLabel: _t, ...stored } = row;
  return stored;
}

/** One transaction as a use case returns it: a hidden name rendered by `redact` (AD-4). */
export function toLedgerTransaction(viewer: Viewer, row: VisibleTransaction): LedgerTransaction {
  return redact(viewer, [row])[0] as LedgerTransaction;
}
