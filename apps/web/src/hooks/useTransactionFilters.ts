import { type FormEvent, useMemo, useState } from "react";
import { fyToDateRange, localDay, quarterRange, rangeKind } from "../lib/date-range.ts";
import {
  clearedFilters,
  hasClearableFilters,
  hasFilters,
  type TransactionsSearch,
  validateTransactionsSearch,
} from "../routes/search.ts";

/** Which chip a search has on: All, or one of Uncategorised and Transfers. */
export function activeChip(search: TransactionsSearch): "all" | "uncategorised" | "transfers" {
  if (search.uncategorised === "true") return "uncategorised";
  if (search.transfers === "true") return "transfers";
  return "all";
}

/**
 * `prev` with `changes` applied (`undefined` removes a param). A change of filter never keeps a
 * paging position, so `page`, `after` and `before` go too unless `changes` sets one.
 */
export function withChanges(
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

export interface UseTransactionFiltersOptions {
  readonly search: TransactionsSearch;
  readonly onSearch: (update: (prev: TransactionsSearch) => TransactionsSearch) => void;
  readonly accountId?: string | undefined;
}

export function useTransactionFilters({
  search,
  onSearch,
  accountId,
}: UseTransactionFiltersOptions) {
  const today = useMemo(() => localDay(new Date()), []);
  const [customOpen, setCustomOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const effectiveSearch = useMemo(() => {
    if (accountId === undefined) return search;
    const { account: _stray, ...rest } = search;
    return rest;
  }, [search, accountId]);

  const listSearch = useMemo(
    () => (accountId === undefined ? search : { ...effectiveSearch, account: accountId }),
    [effectiveSearch, search, accountId],
  );

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

  const clear = () => {
    setResetKey((k) => k + 1);
    onSearch(() => clearedFilters(effectiveSearch));
  };

  const chip = activeChip(effectiveSearch);
  const kind = rangeKind(effectiveSearch.from, effectiveSearch.to, today);
  const showCustom = customOpen || kind === "custom";
  const filtered = hasFilters(effectiveSearch);
  const clearable = hasClearableFilters(effectiveSearch);

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

  return {
    customOpen,
    resetKey,
    effectiveSearch,
    listSearch,
    chip,
    kind,
    showCustom,
    filtered,
    clearable,
    change,
    go,
    clear,
    setPreset,
    toggleCustom,
    jump,
  };
}
