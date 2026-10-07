import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import {
  fetchAccounts,
  fetchCategories,
  fetchTags,
  fetchTransactions,
  type LedgerSplit,
  type LedgerTag,
  type LedgerTransaction,
  setSplitField,
  setSplitTags,
  type TransactionList as TransactionListData,
} from "../api.ts";
import { Button } from "../components/ui/button.tsx";
import { CategoryCombobox } from "../components/ui/category-combobox.tsx";
import { DateInput } from "../components/ui/date-input.tsx";
import { NativeSelect } from "../components/ui/select.tsx";
import { TagPicker } from "../components/ui/tag-picker.tsx";
import { fyToDateRange, localDay, quarterRange, rangeKind } from "../lib/date-range.ts";
import {
  clearedFilters,
  hasClearableFilters,
  hasFilters,
  MAX_QUERY,
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

/** Milliseconds after the last keystroke before the search box changes the list. */
const SEARCH_DEBOUNCE_MS = 300;

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | undefined }) {
  clearTimeout(ref.current);
  ref.current = undefined;
}

/**
 * The search box: the text lives in the URL as `q`, put there after a pause in typing so the list
 * is not fetched on every key. A `q` that arrives from outside (Back, a link) or a `resetKey`
 * change (Clear filters) replaces what is typed and cancels the pending send. The URL's echo of
 * what this box sent does not reset it, nor does a late echo of an earlier value while a newer one
 * is still in flight.
 */
function SearchBox({
  value,
  resetKey,
  onChange,
}: {
  readonly value: string;
  readonly resetKey: number;
  readonly onChange: (q: string | undefined) => void;
}) {
  const [text, setText] = useState(value);
  /** The last value this box sent (or took from the URL). */
  const sent = useRef(value);
  /** Earlier values sent and not yet echoed back, so a late echo is not mistaken for a new URL. */
  const inFlight = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  const latestValue = useRef(value);
  latestValue.current = value;

  useEffect(() => () => clearTimer(timer), []);

  useEffect(() => {
    if (value === sent.current) {
      inFlight.current = [];
      return;
    }
    if (inFlight.current.includes(value)) return;
    clearTimer(timer);
    sent.current = value;
    inFlight.current = [];
    setText(value);
  }, [value]);

  useEffect(() => {
    if (resetKey === 0) return;
    clearTimer(timer);
    sent.current = latestValue.current;
    inFlight.current = [];
    setText(latestValue.current);
  }, [resetKey]);

  const type = (next: string) => {
    setText(next);
    clearTimer(timer);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const trimmed = next.trim();
      if (trimmed === sent.current) return;
      inFlight.current.push(trimmed);
      sent.current = trimmed;
      latest.current(trimmed === "" ? undefined : trimmed);
    }, SEARCH_DEBOUNCE_MS);
  };

  return (
    <div className="mt-3">
      <label className="sr-only" htmlFor="filter-search">
        Search transactions
      </label>
      <input
        id="filter-search"
        type="search"
        value={text}
        maxLength={MAX_QUERY}
        autoComplete="off"
        placeholder="Search name, notes, tag or amount"
        onChange={(e) => type(e.target.value)}
        className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

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
  const today = useMemo(() => localDay(new Date()), []);
  const [customOpen, setCustomOpen] = useState(false);
  const { me } = useSignedIn();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState<LedgerTransaction | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "kept"; text: string } | null>(null);

  const listSearch = useMemo(
    () => (accountId === undefined ? search : { ...search, account: accountId }),
    [search, accountId],
  );
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

  /** Changes some params and goes back to the first page; `undefined` removes a param. */
  const change = (changes: Partial<Record<keyof TransactionsSearch, string | undefined>>) => {
    onSearch((prev) => {
      const next = withChanges(prev, changes);
      if (accountId === undefined) return next;
      const { account: _pinned, ...rest } = next;
      return rest;
    });
  };
  const go = (position: Partial<Record<"page" | "after" | "before", string | undefined>>) =>
    change(position);
  const [resetKey, setResetKey] = useState(0);
  const clear = () => {
    setResetKey((k) => k + 1);
    onSearch(() => clearedFilters(search));
  };

  interface SplitSnapshot {
    readonly transactionId: string;
    readonly splitId: string;
    readonly previousCategory: string | null;
    readonly previousTags: readonly string[];
    readonly previousBeneficiary: string;
  }

  interface ToastInfo {
    readonly message: string;
    readonly actionType?: "category" | "tag" | "beneficiary" | undefined;
    readonly snapshots?: readonly SplitSnapshot[] | undefined;
    readonly isRestored?: boolean | undefined;
  }

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);
  const [activePopover, setActivePopover] = useState<"category" | "tag" | null>(null);
  const [bulkTags, setBulkTags] = useState<readonly LedgerTag[]>([]);
  const [toast, setToast] = useState<ToastInfo | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const isBusyRef = useRef(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const isUndoingRef = useRef(false);

  useEffect(() => () => clearTimer(toastTimer), []);

  const showToast = (info: ToastInfo) => {
    clearTimer(toastTimer);
    setToast(info);
    toastTimer.current = setTimeout(() => {
      setToast(null);
    }, 8000);
  };

  const searchKey = useMemo(() => JSON.stringify(listSearch), [listSearch]);
  const prevSearchKey = useRef(searchKey);
  useEffect(() => {
    if (prevSearchKey.current !== searchKey) {
      prevSearchKey.current = searchKey;
      setSelectedIds(new Set());
      setLastClickedIndex(null);
      setActivePopover(null);
      setBulkTags([]);
    }
  }, [searchKey]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activePopover !== null) {
          setActivePopover(null);
          setBulkTags([]);
          return;
        }
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
          setLastClickedIndex(null);
          setBulkTags([]);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIds.size, activePopover]);

  const handleToggleSelect = (id: string, index: number, shift: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shift && lastClickedIndex !== null) {
        const pageTxns = data?.transactions ?? [];
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          const item = pageTxns[i];
          if (item) next.add(item.id);
        }
      } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
    setLastClickedIndex(index);
  };

  const handleToggleSelectAll = () => {
    const pageTxns = data?.transactions ?? [];
    const pageIds = pageTxns.map((t) => t.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pageIds));
    }
    setLastClickedIndex(null);
  };

  const runBulkAction = async (
    actionType: "category" | "tag" | "beneficiary",
    applySplit: (txn: LedgerTransaction, split: LedgerSplit) => Promise<LedgerTransaction>,
  ) => {
    if (isBusyRef.current) return;
    const pageTxns = data?.transactions ?? [];
    const selectedTxns = pageTxns.filter((t) => selectedIds.has(t.id));
    if (selectedTxns.length === 0) return;

    isBusyRef.current = true;
    setIsBusy(true);
    setNotice(null);
    try {
      const successes: { transaction: LedgerTransaction; snapshots: SplitSnapshot[] }[] = [];
      const failures: { transaction: LedgerTransaction; error: unknown }[] = [];

      for (const txn of selectedTxns) {
        if (txn.splits.length === 0) continue;
        try {
          const rowSnapshots: SplitSnapshot[] = [];
          let updatedTxn = txn;
          for (const split of txn.splits) {
            rowSnapshots.push({
              transactionId: txn.id,
              splitId: split.id,
              previousCategory: split.categoryId,
              previousTags: split.tags.map((t) => t.id),
              previousBeneficiary: split.beneficiary,
            });
            updatedTxn = await applySplit(txn, split);
          }
          successes.push({ transaction: updatedTxn, snapshots: rowSnapshots });
          replaceTransaction(updatedTxn);
        } catch (error) {
          failures.push({ transaction: txn, error });
        }
      }

      if (successes.length > 0) {
        void queryClient.invalidateQueries({ queryKey: ["ledger", "transactions"] });
        if (actionType === "beneficiary") {
          void queryClient.invalidateQueries({ queryKey: ["accounts"] });
          void queryClient.invalidateQueries({ queryKey: ["ledger", "accounts"] });
        }
        const allSnapshots = successes.flatMap((s) => s.snapshots);
        showToast({
          message: `Updated ${successes.length} ${successes.length === 1 ? "transaction" : "transactions"}`,
          actionType,
          snapshots: allSnapshots,
        });
      }

      if (failures.length > 0) {
        const failedNames = failures.map((f) => f.transaction.descriptionRaw).join(", ");
        const firstErr = failures[0]?.error;
        const errMsg = firstErr instanceof Error ? firstErr.message : "Update failed";
        setNotice({
          kind: "error",
          text: `Could not update ${failedNames}: ${errMsg}`,
        });
      }

      setSelectedIds(new Set());
      setLastClickedIndex(null);
      setActivePopover(null);
      setBulkTags([]);
    } finally {
      isBusyRef.current = false;
      setIsBusy(false);
    }
  };

  const handleBulkCategorise = async (categoryId: string | null) => {
    await runBulkAction("category", async (txn, split) => {
      const res = await setSplitField(txn.id, split.id, "category", categoryId);
      if (!res.applied) throw new Error(res.reason ?? KEPT_MESSAGE);
      return res.transaction;
    });
  };

  const handleBulkTag = async (tagIds: readonly string[]) => {
    await runBulkAction("tag", async (txn, split) => {
      return await setSplitTags(txn.id, split.id, tagIds);
    });
  };

  const handleBulkMarkShared = async () => {
    await runBulkAction("beneficiary", async (txn, split) => {
      const res = await setSplitField(txn.id, split.id, "beneficiary", "shared");
      if (!res.applied) throw new Error(res.reason ?? KEPT_MESSAGE);
      return res.transaction;
    });
  };

  const handleUndo = async () => {
    if (isUndoingRef.current) return;
    if (!toast?.snapshots || !toast.actionType) return;
    const { snapshots, actionType } = toast;
    isUndoingRef.current = true;
    setIsUndoing(true);
    clearTimer(toastTimer);
    setNotice(null);
    try {
      for (const snap of snapshots) {
        if (actionType === "category") {
          const res = await setSplitField(
            snap.transactionId,
            snap.splitId,
            "category",
            snap.previousCategory,
          );
          if (res?.transaction) replaceTransaction(res.transaction);
        } else if (actionType === "tag") {
          const updated = await setSplitTags(snap.transactionId, snap.splitId, snap.previousTags);
          if (updated) replaceTransaction(updated);
        } else if (actionType === "beneficiary") {
          const res = await setSplitField(
            snap.transactionId,
            snap.splitId,
            "beneficiary",
            snap.previousBeneficiary,
          );
          if (res?.transaction) replaceTransaction(res.transaction);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["ledger", "transactions"] });
      if (actionType === "beneficiary") {
        void queryClient.invalidateQueries({ queryKey: ["accounts"] });
        void queryClient.invalidateQueries({ queryKey: ["ledger", "accounts"] });
      }
      showToast({
        message: "Restored previous values",
        isRestored: true,
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Failed to undo",
      });
    } finally {
      isUndoingRef.current = false;
      setIsUndoing(false);
    }
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
    <div>
      <header className="flex flex-wrap items-center justify-between gap-2">
        {title}
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
          {selectedIds.size > 0 ? (
            <>
              <div
                className="bulk hidden md:flex items-center gap-2 bg-accent text-primary rounded-md px-3 py-1.5 mt-3 text-sm relative"
                role="toolbar"
                aria-label="Bulk actions"
              >
                <span className="font-medium">{selectedIds.size} selected</span>
                <div className="relative">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      setActivePopover((prev) => (prev === "category" ? null : "category"))
                    }
                  >
                    Categorise
                  </Button>
                  {activePopover === "category" ? (
                    <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-md border bg-background p-2 shadow-md">
                      <CategoryCombobox
                        label="Choose category"
                        categories={categories.data ?? []}
                        value={null}
                        autoFocus
                        onDismiss={() => setActivePopover(null)}
                        onChange={(categoryId) => {
                          setActivePopover(null);
                          void handleBulkCategorise(categoryId);
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
                    disabled={isBusy}
                    onClick={() =>
                      setActivePopover((prev) => {
                        if (prev === "tag") setBulkTags([]);
                        return prev === "tag" ? null : "tag";
                      })
                    }
                  >
                    Tag
                  </Button>
                  {activePopover === "tag" ? (
                    <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-md border bg-background p-2 shadow-md">
                      <TagPicker
                        label="Tags"
                        available={tags.data ?? []}
                        selected={bulkTags}
                        disabled={isBusy}
                        onChange={(tagIds) => {
                          const available = tags.data ?? [];
                          setBulkTags(available.filter((t) => tagIds.includes(t.id)));
                        }}
                      />
                      <div className="mt-2 flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isBusy}
                          onClick={() => {
                            setActivePopover(null);
                            setBulkTags([]);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => {
                            setActivePopover(null);
                            void handleBulkTag(bulkTags.map((t) => t.id));
                            setBulkTags([]);
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
                  disabled={isBusy}
                  onClick={() => void handleBulkMarkShared()}
                >
                  Mark shared
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => {
                    setSelectedIds(new Set());
                    setLastClickedIndex(null);
                    setActivePopover(null);
                    setBulkTags([]);
                  }}
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
            selectedIds={selectedIds}
            onOpen={setOpened}
            onCategory={(txn, splitId, categoryId) => void changeCategory(txn, splitId, categoryId)}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
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
      {toast !== null ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm text-foreground shadow-lg"
        >
          <span>{toast.message}</span>
          {toast.isRestored !== true &&
          toast.snapshots !== undefined &&
          toast.snapshots.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isUndoing}
              onClick={() => void handleUndo()}
            >
              Undo
            </Button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss notice"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setToast(null)}
          >
            ✕
          </button>
        </div>
      ) : null}
    </div>
  );
}
