// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TransactionsSearch } from "../routes/search.ts";
import { activeChip, useTransactionFilters, withChanges } from "./useTransactionFilters.ts";

describe("activeChip", () => {
  it("detects all, uncategorised, and transfers", () => {
    expect(activeChip({})).toBe("all");
    expect(activeChip({ uncategorised: "true" })).toBe("uncategorised");
    expect(activeChip({ transfers: "true" })).toBe("transfers");
    // Priority: uncategorised takes precedence if both somehow set
    expect(activeChip({ uncategorised: "true", transfers: "true" })).toBe("uncategorised");
  });
});

describe("withChanges", () => {
  it("clears paging params on filter change", () => {
    const prev: TransactionsSearch = { page: "2", after: "cursor1", q: "coffee" };
    const next = withChanges(prev, { q: "tea" });
    expect(next).toEqual({ q: "tea" });
  });

  it("removes params set to undefined", () => {
    const prev: TransactionsSearch = { q: "coffee", uncategorised: "true" };
    const next = withChanges(prev, { uncategorised: undefined });
    expect(next).toEqual({ q: "coffee" });
  });

  it("allows setting paging params explicitly", () => {
    const prev: TransactionsSearch = { q: "coffee" };
    const next = withChanges(prev, { page: "3" });
    expect(next).toEqual({ q: "coffee", page: "3" });
  });
});

describe("useTransactionFilters", () => {
  it("updates search filters via change", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(() =>
      useTransactionFilters({
        search: { q: "initial" },
        onSearch,
      }),
    );

    act(() => {
      result.current.change({ q: "groceries" });
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
    const updater = onSearch.mock.calls[0]?.[0];
    expect(updater?.({ q: "initial" })).toEqual({ q: "groceries" });
  });

  it("clears filters when clear is invoked", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(() =>
      useTransactionFilters({
        search: { q: "initial", from: "2026-01-01", to: "2026-01-31" },
        onSearch,
      }),
    );

    act(() => {
      result.current.clear();
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
    const updater = onSearch.mock.calls[0]?.[0];
    expect(updater?.({ q: "initial", from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("preserves pinned accountId", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(() =>
      useTransactionFilters({
        search: { account: "stray_acc", q: "test" },
        onSearch,
        accountId: "pinned_acc",
      }),
    );

    expect(result.current.listSearch.account).toBe("pinned_acc");

    act(() => {
      result.current.change({ q: "updated" });
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
    const updater = onSearch.mock.calls[0]?.[0];
    expect(updater?.({ account: "stray_acc", q: "test" })).toEqual({ q: "updated" });
  });

  it("toggles preset quarter / fy ranges", () => {
    const onSearch = vi.fn();
    const { result } = renderHook(() =>
      useTransactionFilters({
        search: {},
        onSearch,
      }),
    );

    act(() => {
      result.current.setPreset("quarter");
    });

    expect(onSearch).toHaveBeenCalledTimes(1);
    const updater = onSearch.mock.calls[0]?.[0];
    const updated = updater?.({});
    expect(updated?.from).toBeDefined();
    expect(updated?.to).toBeDefined();
  });
});
