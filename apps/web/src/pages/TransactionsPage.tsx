import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  fetchAccounts,
  fetchCategories,
  fetchTags,
  fetchTransactions,
  type LedgerTransaction,
  setSplitField,
  type TransactionList,
} from "../api.ts";
import { Button } from "../components/ui/button.tsx";
import { DateInput } from "../components/ui/date-input.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { fyToDateRange, localDay, quarterRange, rangeKind } from "../lib/date-range.ts";
import {
  clearedFilters,
  hasClearableFilters,
  hasFilters,
  type TransactionsSearch,
  validateTransactionsSearch,
} from "../routes/search.ts";
import { useSignedIn } from "../session.tsx";
import { KEPT_MESSAGE, TransactionSheet } from "./TransactionSheet.tsx";
import { formatCents, TransactionsTable } from "./TransactionsTable.tsx";

/** Which chip a search has on: All, or one of Uncategorised and Transfers. */
function activeChip(search: TransactionsSearch): "all" | "uncategorised" | "transfers" {
  if (search.uncategorised === "true") return "uncategorised";
  if (search.transfers === "true") return "transfers";
  return "all";
}

/**
 * `prev` with `changes` applied (`undefined` removes a param). A change of filter never keeps a
 * paging position, so `page`, `after` and `before` go too unless `changes` sets one.
 */
function withChanges(
  prev: TransactionsSearch,
  changes: Partial<Record<keyof TransactionsSearch, string | undefined>>,
): TransactionsSearch {
  const merged = {
    ...validateTransactionsSearch(prev),
    page: undefined,
    after: undefined,
    before: undefined,
    ...changes,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as TransactionsSearch;
}

/**
 * The transactions the signed-in person may see: shared accounts and their own private ones. The
 * filters, the date range and the paging position live in the URL's search params, so a view can
 * be shared and survives a reload; every number on it comes from the server.
 */
export function TransactionsPage() {
  // The route's search is merged over the raw URL's (an unknown or malformed name stays in the
  // merge), so read it through the validator again.
  const rawSearch = useSearch({ from: "/transactions" });
  const search = useMemo(() => validateTransactionsSearch(rawSearch), [rawSearch]);
  const navigate = useNavigate({ from: "/transactions" });
  const today = useMemo(() => localDay(new Date()), []);
  const [customOpen, setCustomOpen] = useState(false);
  const { me } = useSignedIn();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<LedgerTransaction | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "kept"; text: string } | null>(null);

  const list = useQuery({
    queryKey: ["ledger", "transactions", search],
    queryFn: () => fetchTransactions(search),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const accounts = useQuery({ queryKey: ["ledger", "accounts"], queryFn: fetchAccounts });
  const categories = useQuery({ queryKey: ["ledger", "categories"], queryFn: fetchCategories });
  const tags = useQuery({ queryKey: ["ledger", "tags"], queryFn: fetchTags });
  const accountNames = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
    [accounts.data],
  );

  /** Puts a transaction a write returned into every cached list page that holds it. */
  const replaceTransaction = (next: LedgerTransaction) => {
    queryClient.setQueriesData<TransactionList>({ queryKey: ["ledger", "transactions"] }, (old) =>
      old === undefined
        ? old
        : { ...old, transactions: old.transactions.map((t) => (t.id === next.id ? next : t)) },
    );
  };
  const changeCategory = async (
    txn: LedgerTransaction,
    splitId: string,
    categoryId: string | null,
  ) => {
    setNotice(null);
    try {
      const result = await setSplitField(txn.id, splitId, "category", categoryId);
      replaceTransaction(result.transaction);
      // The filter may no longer match the row, and the summary may have moved.
      void queryClient.invalidateQueries({ queryKey: ["ledger", "transactions"] });
      if (!result.applied) setNotice({ kind: "kept", text: KEPT_MESSAGE });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Something went wrong",
      });
    }
  };
  const closeSheet = () => {
    setOpened(null);
    // The filter may no longer match the edited row, and the summary may have moved.
    void queryClient.invalidateQueries({ queryKey: ["ledger", "transactions"] });
  };

  /** Changes some params and goes back to the first page; `undefined` removes a param. */
  const change = (changes: Partial<Record<keyof TransactionsSearch, string | undefined>>) => {
    void navigate({ search: (prev) => withChanges(prev, changes) });
  };
  const go = (position: Partial<Record<"page" | "after" | "before", string | undefined>>) =>
    change(position);
  const clear = () => {
    void navigate({ search: clearedFilters(search) });
  };

  const chip = activeChip(search);
  const kind = rangeKind(search.from, search.to, today);
  const showCustom = customOpen || kind === "custom";
  const data = list.data;
  const filtered = hasFilters(search);
  const clearable = hasClearableFilters(search);

  const setPreset = (preset: "quarter" | "fy") => {
    setCustomOpen(false);
    if (kind === preset) {
      change({ from: undefined, to: undefined });
      return;
    }
    const range = preset === "quarter" ? quarterRange(today) : fyToDateRange(today);
    change({ from: range.from, to: range.to });
  };
  const toggleCustom = () => {
    if (showCustom) {
      setCustomOpen(false);
      change({ from: undefined, to: undefined });
      return;
    }
    setCustomOpen(true);
  };
  const jump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("page");
    if (typeof value === "string" && /^[1-9]\d{0,6}$/.test(value)) go({ page: value });
  };

  return (
    <section aria-labelledby="transactions">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="transactions" className="m-0">
          Transactions
        </h2>
        <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0">
          <legend className="sr-only">Date range</legend>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={kind === "quarter"}
            className={cn(kind === "quarter" && "bg-accent")}
            onClick={() => setPreset("quarter")}
          >
            Quarter
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={kind === "fy"}
            className={cn(kind === "fy" && "bg-accent")}
            onClick={() => setPreset("fy")}
          >
            FY to date
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={showCustom}
            className={cn(showCustom && "bg-accent")}
            onClick={toggleCustom}
          >
            Custom
          </Button>
        </fieldset>
      </header>

      {showCustom ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="m-0 text-sm" htmlFor="range-from">
            From
            <DateInput
              id="range-from"
              value={search.from ?? ""}
              {...(search.to === undefined ? {} : { max: search.to })}
              onChange={(e) => change({ from: e.target.value || undefined })}
            />
          </label>
          <label className="m-0 text-sm" htmlFor="range-to">
            To
            <DateInput
              id="range-to"
              value={search.to ?? ""}
              {...(search.from === undefined ? {} : { min: search.from })}
              onChange={(e) => change({ to: e.target.value || undefined })}
            />
          </label>
        </div>
      ) : null}

      <fieldset className="mt-3 flex flex-wrap gap-1 border-0 p-0">
        <legend className="sr-only">Quick filters</legend>
        {(
          [
            ["all", "All"],
            ["review", "Needs review"],
            ["uncategorised", "Uncategorised"],
            ["transfers", "Transfers"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant="outline"
            disabled={id === "review"}
            aria-pressed={id !== "review" && chip === id}
            className={cn(id !== "review" && chip === id && "bg-accent")}
            onClick={() => {
              if (id === "review") return;
              change({
                uncategorised: id === "uncategorised" ? "true" : undefined,
                transfers: id === "transfers" ? "true" : undefined,
              });
            }}
          >
            {label}
          </Button>
        ))}
      </fieldset>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="m-0 text-sm" htmlFor="filter-type">
          Type
          <NativeSelect
            id="filter-type"
            value={search.type ?? ""}
            onChange={(e) => change({ type: e.target.value || undefined })}
          >
            <option value="">All types</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </NativeSelect>
        </label>
        <label className="m-0 text-sm" htmlFor="filter-account">
          Account
          <NativeSelect
            id="filter-account"
            value={search.account ?? ""}
            onChange={(e) => change({ account: e.target.value || undefined })}
          >
            <option value="">All accounts</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="m-0 text-sm" htmlFor="filter-category">
          Category
          <NativeSelect
            id="filter-category"
            value={search.category ?? ""}
            onChange={(e) => change({ category: e.target.value || undefined })}
          >
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>

      {clearable && data?.page.total !== 0 ? (
        <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={clear}>
          Clear filters
        </Button>
      ) : null}

      {list.isPending ? <p>Loading…</p> : null}
      {list.isError ? (
        <div>
          <p role="alert">Transactions unavailable</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigate({ search: {} });
            }}
          >
            Reset filters
          </Button>
        </div>
      ) : null}
      {data === undefined ? null : data.page.total === 0 ? (
        filtered ? (
          <div>
            <p>Nothing matches those filters.</p>
            {clearable ? (
              <Button type="button" variant="outline" onClick={clear}>
                Clear filters
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Try widening the date range.</p>
            )}
          </div>
        ) : (
          <p>No transactions yet</p>
        )
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
            {data.summary.count} {data.summary.count === 1 ? "transaction" : "transactions"} · In{" "}
            {formatCents(data.summary.inCents)} · Out {formatCents(data.summary.outCents)}
          </p>
          {notice === null ? null : (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={notice.kind === "error" ? "text-destructive" : "text-muted-foreground"}
            >
              {notice.text}
            </p>
          )}
          <TransactionsTable
            transactions={data.transactions}
            dayNets={data.dayNets}
            accountNames={accountNames}
            categories={categories.data ?? []}
            viewerId={me.personId}
            partnerName={me.partner?.displayName ?? null}
            onOpen={setOpened}
            onCategory={(txn, splitId, categoryId) => void changeCategory(txn, splitId, categoryId)}
          />
          <nav
            aria-label="Pages"
            className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"
          >
            <p className="m-0">
              Showing {data.transactions.length} of {data.page.total} · Page {data.page.page} of{" "}
              {data.page.pageCount}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={data.page.prev === null}
                onClick={() => go({ before: data.page.prev ?? undefined })}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={data.page.next === null}
                onClick={() => go({ after: data.page.next ?? undefined })}
              >
                Next
              </Button>
              {data.page.pageCount > 1 ? (
                <form onSubmit={jump} className="flex items-center gap-1">
                  <label className="m-0 sr-only" htmlFor="jump-page">
                    Go to page
                  </label>
                  <input
                    id="jump-page"
                    name="page"
                    type="number"
                    min={1}
                    max={data.page.pageCount}
                    required
                    placeholder="Page"
                    className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Go
                  </Button>
                </form>
              ) : null}
            </div>
          </nav>
        </>
      )}
      {opened === null ? null : (
        <TransactionSheet
          key={opened.id}
          transaction={opened}
          me={me}
          accountName={accountNames.get(opened.accountId) ?? ""}
          categories={categories.data ?? []}
          tags={tags.data ?? []}
          onChange={replaceTransaction}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}
