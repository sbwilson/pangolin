import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { validateTransactionsSearch } from "../routes/search.ts";
import { TransactionList } from "./TransactionList.tsx";

/**
 * The transactions the signed-in person may see: shared accounts and their own private ones.
 * The list itself (filters, date range, pager) is shared with the account page.
 */
export function TransactionsPage() {
  // The route's search is merged over the raw URL's (an unknown or malformed name stays in the
  // merge), so read it through the validator again.
  const rawSearch = useSearch({ from: "/transactions" });
  const search = useMemo(() => validateTransactionsSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/transactions" });
  return (
    <section aria-labelledby="transactions">
      <TransactionList
        search={search}
        onSearch={(update) => void navigate({ search: (prev) => update(prev) })}
        title={
          <h2 id="transactions" className="m-0">
            Transactions
          </h2>
        }
      />
    </section>
  );
}
