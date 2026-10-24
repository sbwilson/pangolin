import { Link } from "@tanstack/react-router";
import type { LeakMerchant } from "../api.ts";
import { formatCents } from "../lib/money.ts";

export interface BiggestLittleLeaksCardProps {
  readonly leaks: readonly LeakMerchant[];
  readonly range: { readonly from: string; readonly to: string };
}

export function BiggestLittleLeaksCard({ leaks, range }: BiggestLittleLeaksCardProps) {
  return (
    <div
      className="mt-6 rounded-lg border border-border bg-card p-4"
      data-testid="biggest-little-leaks-card"
    >
      <header className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="m-0 text-base font-semibold">Biggest little leaks</h3>
          <p className="m-0 text-xs text-muted-foreground">
            Frequent expenses under $25 accumulating quietly
          </p>
        </div>
      </header>

      {leaks.length === 0 ? (
        <p
          className="py-6 text-center text-sm text-muted-foreground"
          data-testid="leaks-empty-state"
        >
          No little leaks found in this period
        </p>
      ) : (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
          data-testid="leaks-grid"
        >
          {leaks.map((leak) => (
            <Link
              key={leak.payeeId}
              to="/transactions"
              search={{ payee: leak.payeeId, from: range.from, to: range.to }}
              className="group block rounded-lg border border-border/60 bg-muted/30 p-3 transition-colors hover:border-border hover:bg-muted/60"
              data-testid={`leak-tile-${leak.payeeId}`}
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <span className="font-medium text-sm text-foreground truncate group-hover:underline">
                  {leak.payeeName}
                </span>
              </div>
              <div className="mt-2 text-base font-semibold text-foreground">
                {formatCents(leak.totalCents)}
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{leak.count} txns</span>
                <span>~{formatCents(leak.medianCents)} med</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
