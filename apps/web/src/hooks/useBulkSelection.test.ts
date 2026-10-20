// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerTransaction } from "../api.ts";
import { useBulkSelection } from "./useBulkSelection.ts";

const mockTransactions: LedgerTransaction[] = [
  {
    id: "tx1",
    accountId: "acc1",
    accountName: "Checking",
    postedOn: "2026-01-01",
    amountCents: 1000,
    splits: [
      {
        id: "sp1",
        amountCents: 1000,
        categoryId: null,
        categoryName: null,
        tags: [],
        beneficiary: "household",
      },
    ],
  } as unknown as LedgerTransaction,
  {
    id: "tx2",
    accountId: "acc1",
    accountName: "Checking",
    postedOn: "2026-01-02",
    amountCents: 2000,
    splits: [
      {
        id: "sp2",
        amountCents: 2000,
        categoryId: null,
        categoryName: null,
        tags: [],
        beneficiary: "household",
      },
    ],
  } as unknown as LedgerTransaction,
  {
    id: "tx3",
    accountId: "acc1",
    accountName: "Checking",
    postedOn: "2026-01-03",
    amountCents: 3000,
    splits: [
      {
        id: "sp3",
        amountCents: 3000,
        categoryId: null,
        categoryName: null,
        tags: [],
        beneficiary: "household",
      },
    ],
  } as unknown as LedgerTransaction,
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useBulkSelection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("toggles single row selection", () => {
    const { result } = renderHook(
      () =>
        useBulkSelection({
          transactions: mockTransactions,
          listSearch: {},
          replaceTransaction: vi.fn(),
          onNotice: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleToggleSelect("tx1", 0, false);
    });

    expect(result.current.selectedIds.has("tx1")).toBe(true);
    expect(result.current.selectedIds.size).toBe(1);

    act(() => {
      result.current.handleToggleSelect("tx1", 0, false);
    });

    expect(result.current.selectedIds.has("tx1")).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("handles shift-click range selection", () => {
    const { result } = renderHook(
      () =>
        useBulkSelection({
          transactions: mockTransactions,
          listSearch: {},
          replaceTransaction: vi.fn(),
          onNotice: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleToggleSelect("tx1", 0, false);
    });

    act(() => {
      result.current.handleToggleSelect("tx3", 2, true);
    });

    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedIds.has("tx1")).toBe(true);
    expect(result.current.selectedIds.has("tx2")).toBe(true);
    expect(result.current.selectedIds.has("tx3")).toBe(true);
  });

  it("toggles select all and clear all", () => {
    const { result } = renderHook(
      () =>
        useBulkSelection({
          transactions: mockTransactions,
          listSearch: {},
          replaceTransaction: vi.fn(),
          onNotice: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleToggleSelectAll();
    });

    expect(result.current.selectedIds.size).toBe(3);

    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedIds.size).toBe(0);
  });

  it("clears selection on Escape key", () => {
    const { result } = renderHook(
      () =>
        useBulkSelection({
          transactions: mockTransactions,
          listSearch: {},
          replaceTransaction: vi.fn(),
          onNotice: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleToggleSelectAll();
    });
    expect(result.current.selectedIds.size).toBe(3);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(result.current.selectedIds.size).toBe(0);
  });
});
