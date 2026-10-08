// Export filtered transaction records to RFC 4180 CSV with formula neutralization (AD-3, AD-4).
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import { requireRecentAuth } from "../identity/reauth.ts";
import { listAllTransactions } from "./list-transactions.ts";
import {
  type ListTransactionsInput,
  listTransactionsInput,
  toTransactionFilter,
} from "./transaction-query.ts";

const CSV_HEADER = "Date,Account,Payee,Description,Category,Memo,Tags,Amount";

const FORMULA_PREFIXES = ["=", "+", "-", "@"];

/** Neutralizes formula injection by prefixing with `'` if starting with `=`, `+`, `-`, or `@` (ignoring leading whitespace). */
export function neutralizeFormula(cell: string): string {
  const trimmed = cell.trimStart();
  if (trimmed.length > 0 && FORMULA_PREFIXES.includes(trimmed[0] as string)) {
    return `'${cell}`;
  }
  return cell;
}

/** Formats integer cents into decimal dollars (e.g. 6000 -> "60.00", -1450 -> "-14.50"). */
export function formatAmount(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  const formatted = `${dollars}.${remainder}`;
  return cents < 0 ? `-${formatted}` : formatted;
}

/** Escapes a cell according to RFC 4180 after formula neutralization. */
export function escapeCsvCell(raw: string): string {
  const neutralized = neutralizeFormula(raw);
  if (
    neutralized.includes('"') ||
    neutralized.includes(",") ||
    neutralized.includes("\n") ||
    neutralized.includes("\r")
  ) {
    return `"${neutralized.replaceAll('"', '""')}"`;
  }
  return neutralized;
}

/**
 * `ledger.exportTransactionsCsv`: exports transactions visible to the viewer matching query filters
 * to RFC 4180 CSV. Re-authentication within 5 minutes is required for person viewers.
 * Partner B never sees partner A's private accounts. For non-owners, hidden names read
 * "Hidden until <date>" with an empty payee cell. Cells beginning with '=', '+', '-', or '@'
 * are prefixed with "'" to prevent formula injection in spreadsheets. Multi-split transactions
 * produce one row per split preserving split amounts, categories, memos and tags.
 */
export function exportTransactionsCsv(
  ctx: UseCaseContext,
  input: ListTransactionsInput = {},
): string {
  requireRecentAuth(ctx);
  const query = parseInput(listTransactionsInput, input);
  const filter = toTransactionFilter(query);

  const txns = listAllTransactions(ctx, filter);

  const { accountNames, categoryNames } = ctx.uow.read((repos) => {
    const accounts = repos.accounts.list(ctx.viewer);
    const categories = repos.categories.list(ctx.viewer);
    return {
      accountNames: new Map(accounts.map((a) => [a.id, a.name])),
      categoryNames: new Map(categories.map((c) => [c.id, c.name])),
    };
  });

  const rows: string[] = [];

  for (const txn of txns) {
    const accountName = accountNames.get(txn.accountId) ?? "";
    const payeeName = txn.nameHidden ? "" : (txn.payeeName ?? "");
    const description = txn.descriptionRaw;

    if (txn.splits.length === 0) {
      const row = [
        escapeCsvCell(txn.postedOn),
        escapeCsvCell(accountName),
        escapeCsvCell(payeeName),
        escapeCsvCell(description),
        "",
        "",
        "",
        escapeCsvCell(formatAmount(txn.amountCents)),
      ].join(",");
      rows.push(row);
    } else {
      for (const split of txn.splits) {
        const categoryName = split.categoryId ? (categoryNames.get(split.categoryId) ?? "") : "";
        const memo = split.memo ?? "";
        const tags = split.tags.map((t) => t.name).join(", ");
        const amount = formatAmount(split.amountCents);

        const row = [
          escapeCsvCell(txn.postedOn),
          escapeCsvCell(accountName),
          escapeCsvCell(payeeName),
          escapeCsvCell(description),
          escapeCsvCell(categoryName),
          escapeCsvCell(memo),
          escapeCsvCell(tags),
          escapeCsvCell(amount),
        ].join(",");
        rows.push(row);
      }
    }
  }

  const lines = [CSV_HEADER, ...rows];
  return `${lines.join("\r\n")}\r\n`;
}
