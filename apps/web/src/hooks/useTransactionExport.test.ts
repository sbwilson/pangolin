// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, exportTransactions } from "../api.ts";
import { useTransactionExport } from "./useTransactionExport.ts";

vi.mock("../api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api.ts")>()),
  exportTransactions: vi.fn(),
}));

describe("useTransactionExport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("handles successful CSV export and triggers download", async () => {
    vi.mocked(exportTransactions).mockResolvedValue(
      "Date,Account,Amount\r\n2026-01-01,Joint,100\r\n",
    );
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTransactionExport({
        listSearch: { q: "coffee" },
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(exportTransactions).toHaveBeenCalledWith({ q: "coffee" });
    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(result.current.reauthRequired).toBe(false);
    expect(result.current.isExporting).toBe(false);
  });

  it("sets reauthRequired on ReauthRequired ApiError", async () => {
    vi.mocked(exportTransactions).mockRejectedValue(
      new ApiError(401, "ReauthRequired", "Sign in again to export"),
    );
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTransactionExport({
        listSearch: {},
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(result.current.reauthRequired).toBe(true);
    expect(onNotice).toHaveBeenCalledWith(null);
    expect(result.current.isExporting).toBe(false);
  });

  it("calls onNotice with error message on other errors", async () => {
    vi.mocked(exportTransactions).mockRejectedValue(new Error("Network failure"));
    const onNotice = vi.fn();
    const { result } = renderHook(() =>
      useTransactionExport({
        listSearch: {},
        onNotice,
      }),
    );

    await act(async () => {
      await result.current.handleExport();
    });

    expect(result.current.reauthRequired).toBe(false);
    expect(onNotice).toHaveBeenCalledWith({
      kind: "error",
      text: "Network failure",
    });
  });

  it("re-throws error when isRetry is true", async () => {
    const error = new Error("Auth failed again");
    vi.mocked(exportTransactions).mockRejectedValue(error);
    const { result } = renderHook(() =>
      useTransactionExport({
        listSearch: {},
      }),
    );

    await expect(
      act(async () => {
        await result.current.handleExport(true);
      }),
    ).rejects.toThrow("Auth failed again");
  });
});
