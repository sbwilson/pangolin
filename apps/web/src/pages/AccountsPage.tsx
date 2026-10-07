import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  type AccountView,
  fetchAccountBalance,
  fetchInstitutions,
  listAccounts,
  type Me,
} from "../api.ts";
import { Button } from "../components/ui/button.tsx";
import { ACCOUNT_GROUPS, hasBalance, ownerLabel, showsLock, TYPE_LABEL } from "../lib/accounts.ts";
import { localDay } from "../lib/date-range.ts";
import { freshnessLabel, isStale } from "../lib/freshness.ts";
import { useSignedIn } from "../session.tsx";
import { AccountSheet } from "./AccountSheet.tsx";
import { formatCents } from "./TransactionsTable.tsx";

/** A small padlock for a private account (drawn inline: the CSP allows no image assets). */
export function LockIcon() {
  return (
    <svg
      role="img"
      aria-label="Private"
      viewBox="0 0 16 16"
      className="inline-block size-4 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <title>Private</title>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/** "to 30 Sep", in the warning colour (with the word "stale") when the newest line is old. */
export function Freshness({ account, today }: { account: AccountView; today: string }) {
  const stale = isStale(account.newestPostedOn, today);
  return (
    <span
      data-stale={stale ? "true" : undefined}
      className={cn("text-xs", stale ? "text-warning" : "text-muted-foreground")}
    >
      {freshnessLabel(account.newestPostedOn)}
      {stale ? " (stale)" : ""}
    </span>
  );
}

/** The balance the server works out, for the types that have one; nothing for the rest. */
export function Balance({ account, className }: { account: AccountView; className?: string }) {
  const balance = useQuery({
    queryKey: ["accounts", "balance", account.id],
    queryFn: () => fetchAccountBalance(account.id),
    enabled: hasBalance(account.type),
    retry: false,
  });
  if (!hasBalance(account.type)) return null;
  if (balance.isError) return <span className={className}>Balance unavailable</span>;
  if (balance.data === undefined) return <span className={className}>…</span>;
  return <span className={cn("tabular-nums", className)}>{formatCents(balance.data)}</span>;
}

function AccountRow({
  account,
  me,
  today,
  institution,
  onEdit,
}: {
  account: AccountView;
  me: Me;
  today: string;
  institution: string | undefined;
  onEdit: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-t py-2 first:border-t-0">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold"
      >
        {(institution ?? account.name).slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to="/accounts/$id"
          params={{ id: account.id }}
          className="font-medium text-foreground no-underline hover:underline"
        >
          {account.name}
        </Link>
        <p className="m-0 text-xs text-muted-foreground">
          {TYPE_LABEL[account.type]}
          {institution === undefined ? "" : ` · ${institution}`} · {ownerLabel(account, me)}
        </p>
      </div>
      {showsLock(account, me) ? <LockIcon /> : null}
      <div className="flex min-w-24 flex-col items-end">
        <Balance account={account} className="text-sm font-medium" />
        <Freshness account={account} today={today} />
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={`Edit ${account.name}`}
        onClick={onEdit}
      >
        Edit
      </Button>
    </li>
  );
}

/**
 * The accounts the signed-in person can see, grouped by kind, with a placeholder for properties
 * and a sheet to add or edit one. Balances and freshness come from the server.
 */
export function AccountsPage() {
  const { me } = useSignedIn();
  const queryClient = useQueryClient();
  const today = useMemo(() => localDay(new Date()), []);
  const accounts = useQuery({
    queryKey: ["accounts", "list"],
    queryFn: listAccounts,
    retry: false,
  });
  const institutions = useQuery({
    queryKey: ["accounts", "institutions"],
    queryFn: fetchInstitutions,
  });
  const [sheet, setSheet] = useState<{ account: AccountView | null } | null>(null);
  const institutionNames = useMemo(
    () => new Map((institutions.data ?? []).map((i) => [i.id, i.name])),
    [institutions.data],
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
    // The Account filter and column on the transaction list name accounts too.
    void queryClient.invalidateQueries({ queryKey: ["ledger", "accounts"] });
  };

  return (
    <section aria-labelledby="accounts">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="accounts" className="m-0">
          Accounts
        </h2>
        <Button type="button" variant="outline" onClick={() => setSheet({ account: null })}>
          Add account
        </Button>
      </header>

      {accounts.isPending ? <p>Loading…</p> : null}
      {accounts.isError ? <p role="alert">Accounts unavailable</p> : null}
      {accounts.data === undefined
        ? null
        : ACCOUNT_GROUPS.map((group) => {
            const rows = accounts.data.filter((a) => group.types.includes(a.type));
            if (rows.length === 0) return null;
            return (
              <section
                key={group.id}
                aria-labelledby={`group-${group.id}`}
                className="mt-4 rounded-xl border bg-background px-4 py-3"
              >
                <h3
                  id={`group-${group.id}`}
                  className="m-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {group.label} · {rows.length}
                </h3>
                <ul className="m-0 list-none p-0">
                  {rows.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      me={me}
                      today={today}
                      institution={
                        account.institutionId === null
                          ? undefined
                          : institutionNames.get(account.institutionId)
                      }
                      onEdit={() => setSheet({ account })}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
      {accounts.data?.length === 0 ? <p>No accounts yet. Add one to get started.</p> : null}

      <section
        aria-labelledby="properties"
        className="mt-4 rounded-xl border bg-background px-4 py-3"
      >
        <h3 id="properties" className="m-0 text-base">
          Properties
        </h3>
        <p className="m-0 text-sm text-muted-foreground">
          Properties you own will appear here once property tracking arrives.
        </p>
      </section>

      {sheet === null ? null : (
        <AccountSheet
          key={sheet.account?.id ?? "new"}
          account={sheet.account}
          me={me}
          institutions={institutions.data ?? []}
          onSaved={refresh}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
