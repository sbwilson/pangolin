import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  fetchAccounts,
  fetchCategories,
  fetchTags,
  fetchTransactions,
  type LedgerTransaction,
  setSplitField,
  type TransactionList as TransactionListData,
} from "../api.ts";
import { ReauthDialog } from "../components/ReauthDialog.tsx";
import { SearchBox } from "../components/SearchBox.tsx";
import { Button } from "../components/ui/button.tsx";
import { CategoryCombobox } from "../components/ui/category-combobox.tsx";
import { DateInput } from "../components/ui/date-input.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { TagPicker } from "../components/ui/tag-picker.tsx";
import { useBulkSelection } from "../hooks/useBulkSelection.ts";
import { useTransactionExport } from "../hooks/useTransactionExport.ts";
import { useTransactionFilters } from "../hooks/useTransactionFilters.ts";
import { formatCents } from "../lib/money.ts";
import type { TransactionsSearch } from "../routes/search.ts";
import { useSignedIn } from "../session.tsx";
import { KEPT_MESSAGE, TransactionSheet } from "./TransactionSheet.tsx";
import { TransactionsTable } from "./TransactionsTable.tsx";

/** Whichever route hosts the list hands it the validated search and a way to change it. */
export interface TransactionListProps {
  /** The route's search, already through `validateTransactionsSearch`. */
  readonly search: TransactionsSearch;
  /** Replaces the route's search with what `update` makes of the current one. */
  readonly onSearch: (update: (prev: TransactionsSearch) => TransactionsSearch) => void;
  /** The heading shown at the left of the date-range control. */
  readonly title: ReactNode;
  /** Pins the list to one account: the Account filter goes and `account` stays out of the URL. */
  readonly accountId?: string;
}

/**
 * The transaction list with its date-range control, filters, summary and pager, shared by
 * `/transactions` and `/accounts/:id`. The filters, the date range and the paging position live in
 * the route's search params, so a view can be shared and survives a reload; every number on it
 * comes from the server.
 */
export function TransactionList({ search, onSearch, title, accountId }: TransactionListProps) {
  const { me } = useSignedIn();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<LedgerTransaction | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "kept"; text: string } | null>(null);

  const filters = useTransactionFilters({ search, onSearch, accountId });
  const {
    listSearch,
    chip,
    kind,
    showCustom,
    filtered,
    clearable,
    resetKey,
    change,
    go,
    clear,
    setPreset,
    toggleCustom,
    jump,
  } = filters;

  const list = useQuery({
    queryKey: ["ledger", "transactions", listSearch],
    queryFn: () => fetchTransactions(listSearch),
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
    queryClient.setQueriesData<TransactionListData>(
      { queryKey: ["ledger", "transactions"] },
      (old) =>
        old === undefined
          ? old
          : { ...old, transactions: old.transactions.map((t) => (t.id === next.id ? next : t)) },
    );
  };

  const { isExporting, reauthRequired, setReauthRequired, handleExport } = useTransactionExport({
    listSearch,
    onNotice: setNotice,
  });

  const data = list.data;
  const pageTransactions = useMemo(() => data?.transactions ?? [], [data?.transactions]);

  const bulk = useBulkSelection({
    transactions: pageTransactions,
    listSearch,
    replaceTransaction,
    onNotice: setNotice,
  });

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
    void queryClient.invalidateQueries({ queryKey: ["accounts"] });
  };

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-2">
        {title}
        <div className="flex flex-wrap items-center gap-2">
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isExporting}
            aria-busy={isExporting}
            onClick={() => void handleExport()}
          >
            {isExporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </header>
      <ReauthDialog
        open={reauthRequired}
        action="export transactions"
        onSuccess={() => handleExport(true)}
        onCancel={() => setReauthRequired(false)}
      />

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

      <SearchBox value={search.q ?? ""} resetKey={resetKey} onChange={(q) => change({ q })} />

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

      <div
        className={cn(
          "mt-2 grid grid-cols-1 gap-2",
          accountId === undefined ? "sm:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
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
        {accountId === undefined ? (
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
        ) : null}
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
              onSearch(() => ({}));
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
          {bulk.selectedIds.size > 0 ? (
            <>
              <div
                className="bulk hidden md:flex items-center gap-2 bg-accent text-primary rounded-md px-3 py-1.5 mt-3 text-sm relative"
                role="toolbar"
                aria-label="Bulk actions"
              >
                <span className="font-medium">{bulk.selectedIds.size} selected</span>
                <div className="relative">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulk.isBusy}
                    onClick={() =>
                      bulk.setActivePopover((prev) => (prev === "category" ? null : "category"))
                    }
                  >
                    Categorise
                  </Button>
                  {bulk.activePopover === "category" ? (
                    <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-md border bg-background p-2 shadow-md">
                      <CategoryCombobox
                        label="Choose category"
                        categories={categories.data ?? []}
                        value={null}
                        autoFocus
                        onDismiss={() => bulk.setActivePopover(null)}
                        onChange={(categoryId) => {
                          bulk.setActivePopover(null);
                          void bulk.handleBulkCategorise(categoryId);
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="relative">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={bulk.isBusy}
                    onClick={() =>
                      bulk.setActivePopover((prev) => {
                        if (prev === "tag") bulk.setBulkTags([]);
                        return prev === "tag" ? null : "tag";
                      })
                    }
                  >
                    Tag
                  </Button>
                  {bulk.activePopover === "tag" ? (
                    <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-md border bg-background p-2 shadow-md">
                      <TagPicker
                        label="Tags"
                        available={tags.data ?? []}
                        selected={bulk.bulkTags}
                        disabled={bulk.isBusy}
                        onChange={(tagIds) => {
                          const available = tags.data ?? [];
                          bulk.setBulkTags(available.filter((t) => tagIds.includes(t.id)));
                        }}
                      />
                      <div className="mt-2 flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={bulk.isBusy}
                          onClick={() => {
                            bulk.setActivePopover(null);
                            bulk.setBulkTags([]);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={bulk.isBusy}
                          onClick={() => {
                            bulk.setActivePopover(null);
                            void bulk.handleBulkTag(bulk.bulkTags.map((t) => t.id));
                            bulk.setBulkTags([]);
                          }}
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={bulk.isBusy}
                  onClick={() => void bulk.handleBulkMarkShared()}
                >
                  Mark shared
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={bulk.isBusy}
                  onClick={bulk.clearSelection}
                >
                  Clear
                </Button>
              </div>

              <p className="mt-3 text-sm text-muted-foreground md:hidden" aria-live="polite">
                {data.summary.count} {data.summary.count === 1 ? "transaction" : "transactions"} ·
                In {formatCents(data.summary.inCents)} · Out {formatCents(data.summary.outCents)}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              {data.summary.count} {data.summary.count === 1 ? "transaction" : "transactions"} · In{" "}
              {formatCents(data.summary.inCents)} · Out {formatCents(data.summary.outCents)}
            </p>
          )}
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
            selectedIds={bulk.selectedIds}
            onOpen={setOpened}
            onCategory={(txn, splitId, categoryId) => void changeCategory(txn, splitId, categoryId)}
            onToggleSelect={bulk.handleToggleSelect}
            onToggleSelectAll={bulk.handleToggleSelectAll}
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
      {bulk.toast !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm text-foreground shadow-lg"
        >
          <span>{bulk.toast.message}</span>
          {bulk.toast.isRestored !== true &&
          bulk.toast.snapshots !== undefined &&
          bulk.toast.snapshots.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={bulk.isUndoing}
              onClick={() => void bulk.handleUndo()}
            >
              Undo
            </Button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss notice"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => bulk.setToast(null)}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
