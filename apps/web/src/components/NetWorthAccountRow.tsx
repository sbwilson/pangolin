import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils.ts";
import type { Me, NetWorthAccount } from "../api.ts";
import { ownerLabel, showsLock, TYPE_LABEL } from "../lib/accounts.ts";
import { isStale } from "../lib/freshness.ts";
import { formatCents } from "../lib/money.ts";
import { LockIcon } from "../pages/AccountsPage.tsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatShortDate(day: string): string {
  const d = Number(day.slice(8, 10));
  const m = MONTHS[Number(day.slice(5, 7)) - 1];
  return `${d} ${m}`;
}

export interface NetWorthAccountRowProps {
  readonly account: NetWorthAccount;
  readonly me: Me;
  readonly today: string;
  readonly isLiability?: boolean;
  readonly onImport: (accountId: string) => void;
}

export function NetWorthAccountRow({
  account,
  me,
  today,
  isLiability,
  onImport,
}: NetWorthAccountRowProps) {
  const isPrivateForMe = showsLock(account, me);
  const stale = isStale(account.lastImport?.through ?? null, today);
  const initial = (account.institutionName ?? account.name).charAt(0).toUpperCase();

  return (
    <div
      data-testid={`account-row-${account.id}`}
      className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 border-b border-border last:border-b-0 text-sm"
    >
      <span className="size-6 rounded-full bg-accent text-primary text-xs font-semibold grid place-items-center shrink-0">
        {initial}
      </span>

      <div className="min-w-0">
        <div className="font-medium text-foreground truncate flex items-center gap-1.5">
          <Link
            to="/accounts/$id"
            params={{ id: account.id }}
            className="truncate hover:underline hover:text-primary transition-colors"
          >
            {account.name}
          </Link>
          {isPrivateForMe ? <LockIcon /> : null}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {account.institutionName ? `${account.institutionName} · ` : ""}
          {TYPE_LABEL[account.type] ?? account.type}
        </div>
      </div>

      <div className="shrink-0 text-xs">
        {account.pool === "shared" ? (
          <span className="border border-border rounded px-1.5 py-0.5 text-muted-foreground">
            Shared
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0" aria-hidden="true">
              <circle
                cx="4"
                cy="4"
                r="4"
                fill={account.pool === me.personId ? me.colour : "currentColor"}
              />
            </svg>
            {ownerLabel(account, me)}
          </span>
        )}
      </div>

      <div className="text-right shrink-0">
        <div
          className={cn(
            "tabular-nums font-medium",
            isLiability ? "text-destructive" : "text-foreground",
          )}
        >
          {formatCents(account.balanceCents)}
        </div>
        <div className="text-xs">
          {stale ? (
            <span className="text-warning font-medium">
              to {account.lastImport ? formatShortDate(account.lastImport.through) : "old"} ·{" "}
              <button
                type="button"
                onClick={() => onImport(account.id)}
                aria-label={`Import statement for ${account.name}`}
                className="underline font-semibold hover:opacity-80 cursor-pointer"
              >
                Import
              </button>
            </span>
          ) : account.lastImport !== null ? (
            <span className="text-muted-foreground">
              to {formatShortDate(account.lastImport.through)}
            </span>
          ) : (
            <span className="text-muted-foreground">
              No imports yet ·{" "}
              <button
                type="button"
                onClick={() => onImport(account.id)}
                aria-label={`Import statement for ${account.name}`}
                className="underline font-semibold hover:opacity-80 cursor-pointer"
              >
                Import
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
