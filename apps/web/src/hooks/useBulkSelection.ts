import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type LedgerSplit,
  type LedgerTag,
  type LedgerTransaction,
  setSplitField,
  setSplitTags,
} from "../api.ts";
import { KEPT_MESSAGE } from "../pages/TransactionSheet.tsx";
import type { TransactionsSearch } from "../routes/search.ts";

function clearTimer(ref: { current: ReturnType<typeof setTimeout> | undefined }) {
  clearTimeout(ref.current);
  ref.current = undefined;
}

export interface SplitSnapshot {
  readonly transactionId: string;
  readonly splitId: string;
  readonly previousCategory: string | null;
  readonly previousTags: readonly string[];
  readonly previousBeneficiary: string;
}

export interface ToastInfo {
  readonly message: string;
  readonly actionType?: "category" | "tag" | "beneficiary" | undefined;
  readonly snapshots?: readonly SplitSnapshot[] | undefined;
  readonly isRestored?: boolean | undefined;
}

export interface UseBulkSelectionOptions {
  readonly transactions: readonly LedgerTransaction[];
  readonly listSearch: TransactionsSearch;
  readonly replaceTransaction: (next: LedgerTransaction) => void;
  readonly onNotice: (notice: { kind: "error" | "kept"; text: string } | null) => void;
}

export function useBulkSelection({
  transactions,
  listSearch,
  replaceTransaction,
  onNotice,
}: UseBulkSelectionOptions) {
  const queryClient = useQueryClient();
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
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        for (let i = start; i <= end; i++) {
          const item = transactions[i];
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
    const pageIds = transactions.map((t) => t.id);
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
    const selectedTxns = transactions.filter((t) => selectedIds.has(t.id));
    if (selectedTxns.length === 0) return;

    isBusyRef.current = true;
    setIsBusy(true);
    onNotice(null);
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
        onNotice({
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
    onNotice(null);
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
      onNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Failed to undo",
      });
    } finally {
      isUndoingRef.current = false;
      setIsUndoing(false);
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastClickedIndex(null);
    setActivePopover(null);
    setBulkTags([]);
  };

  return {
    selectedIds,
    lastClickedIndex,
    activePopover,
    setActivePopover,
    bulkTags,
    setBulkTags,
    toast,
    setToast,
    isBusy,
    isUndoing,
    handleToggleSelect,
    handleToggleSelectAll,
    handleBulkCategorise,
    handleBulkTag,
    handleBulkMarkShared,
    handleUndo,
    clearSelection,
  };
}
