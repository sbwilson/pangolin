import { useRef, useState } from "react";
import { ApiError, exportTransactions } from "../api.ts";
import type { TransactionsSearch } from "../routes/search.ts";

export interface UseTransactionExportOptions {
  readonly listSearch: TransactionsSearch;
  readonly onNotice?:
    | ((notice: { kind: "error" | "kept"; text: string } | null) => void)
    | undefined;
}

export function useTransactionExport({ listSearch, onNotice }: UseTransactionExportOptions) {
  const [reauthRequired, setReauthRequired] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const isExportingRef = useRef(false);

  const handleExport = async (isRetry = false) => {
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    setIsExporting(true);
    if (!isRetry) {
      onNotice?.(null);
    }
    try {
      const csv = await exportTransactions(listSearch);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "transactions.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReauthRequired(false);
    } catch (err) {
      if (isRetry) {
        throw err;
      }
      if (err instanceof ApiError && err.code === "ReauthRequired") {
        setReauthRequired(true);
      } else {
        onNotice?.({
          kind: "error",
          text: err instanceof Error ? err.message : "Export failed",
        });
      }
    } finally {
      isExportingRef.current = false;
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    reauthRequired,
    setReauthRequired,
    handleExport,
  };
}
