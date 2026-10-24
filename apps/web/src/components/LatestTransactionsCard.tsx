import { Link } from "@tanstack/react-router";
import type { CategorySummary, LedgerTransaction } from "../api.ts";
import { hiddenUntilLabel, longDay, WINK_LINE } from "../lib/hidden.ts";
import { formatCents } from "../lib/money.ts";
import { MascotIcon } from "./MascotLogo.tsx";

export interface LatestTransactionsCardProps {
  readonly transactions: readonly LedgerTransaction[];
  readonly categories?: readonly CategorySummary[];
  readonly range: { readonly from: string; readonly to: string };
  readonly maxItems?: number;
}

export function LatestTransactionsCard({
  transactions,
  categories = [],
  range,
  maxItems = 8,
}: LatestTransactionsCardProps) {
  const displayed = transactions.slice(0, maxItems);

  const categoryNameById = new Map<string, string>();
  for (const cat of categories) {
    categoryNameById.set(cat.id, cat.name);
  }

  return (
    <div
      className="mt-6 rounded-lg border border-border bg-card p-4"
      data-testid="latest-transactions-card"
    >
      <header className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <h3 className="m-0 text-base font-semibold">Latest transactions</h3>
        <Link
          to="/transactions"
          search={{ from: range.from, to: range.to }}
          className="text-xs font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </header>

      {displayed.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No transactions in this period
        </p>
      ) : (
        <ul className="divide-y divide-border/50 list-none m-0 p-0">
          {displayed.map((txn) => {
            const isPositive = txn.amountCents > 0;
            const firstSplit = txn.splits[0];
            const categoryName =
              txn.splits.length > 1
                ? `Split (${txn.splits.length})`
                : firstSplit?.categoryId
                  ? (categoryNameById.get(firstSplit.categoryId) ?? "Categorised")
                  : null;

            return (
              <li
                key={txn.id}
                className="flex items-center justify-between py-3 gap-3"
                data-testid={`latest-txn-${txn.id}`}
              >
                {txn.nameHidden ? (
                  /* Hidden-name wink row */
                  <div className="flex min-w-0 items-center gap-2.5" data-testid="wink-row">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <MascotIcon size="sm" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {hiddenUntilLabel(txn.nameHiddenUntil)}
                        </span>
                        <span className="truncate text-xs italic text-muted-foreground">
                          {WINK_LINE}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">{longDay(txn.postedOn)}</span>
                    </div>
                  </div>
                ) : (
                  /* Standard transaction row */
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-medium text-foreground">
                        {txn.descriptionRaw}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{longDay(txn.postedOn)}</span>
                        {categoryName ? (
                          <>
                            <span>·</span>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {categoryName}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                <div className="shrink-0 text-right">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
                    }`}
                  >
                    {formatCents(txn.amountCents)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
