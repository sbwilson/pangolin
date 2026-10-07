import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { ApiError, fetchAccount } from "../api.ts";
import { hasBalance, ownerLabel, showsLock, TYPE_LABEL } from "../lib/accounts.ts";
import { localDay } from "../lib/date-range.ts";
import { validateTransactionsSearch } from "../routes/search.ts";
import { useSignedIn } from "../session.tsx";
import { Balance, Freshness, LockIcon } from "./AccountsPage.tsx";
import { TransactionList } from "./TransactionList.tsx";

/** One account: its balance and freshness, and only its own transactions in the date range. */
export function AccountPage() {
  const { id } = useParams({ from: "/accounts/$id" });
  const rawSearch = useSearch({ from: "/accounts/$id" });
  const search = useMemo(() => validateTransactionsSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/accounts/$id" });
  const { me } = useSignedIn();
  const today = useMemo(() => localDay(new Date()), []);
  const account = useQuery({
    queryKey: ["accounts", "one", id],
    queryFn: () => fetchAccount(id),
    retry: false,
  });

  if (account.isPending) return <p>Loading…</p>;
  if (account.isError) {
    const missing = account.error instanceof ApiError && account.error.status === 404;
    return (
      <section>
        <p>
          <Link to="/accounts">← Accounts</Link>
        </p>
        <p role="alert">{missing ? "Account not found" : "Account unavailable"}</p>
      </section>
    );
  }
  const data = account.data;
  return (
    <section aria-labelledby="account-name">
      <p className="m-0">
        <Link to="/accounts">← Accounts</Link>
      </p>
      <h2 id="account-name" className="mb-0 flex items-center gap-2">
        {data.name}
        {showsLock(data, me) ? <LockIcon /> : null}
      </h2>
      <p className="m-0 text-sm text-muted-foreground">
        {TYPE_LABEL[data.type]} · {ownerLabel(data, me)}
      </p>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        {hasBalance(data.type) ? (
          <p className="m-0">
            <span className="text-xs text-muted-foreground">Balance </span>
            <Balance account={data} className="text-2xl font-semibold" />
          </p>
        ) : null}
        <p className="m-0">
          <span className="text-xs text-muted-foreground">Data </span>
          <Freshness account={data} today={today} />
        </p>
      </div>
      <div className="mt-4">
        <TransactionList
          key={id}
          accountId={id}
          search={search}
          onSearch={(update) => void navigate({ search: (prev) => update(prev) })}
          title={
            <h3 id="account-transactions" className="m-0">
              Transactions
            </h3>
          }
        />
      </div>
    </section>
  );
}
