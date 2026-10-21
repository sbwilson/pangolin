import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type AccountView,
  ApiError,
  handOffFile,
  type ImportResult,
  importFile,
  listAccounts,
} from "../../api.ts";
import {
  BANKS,
  type BankId,
  chooseFormat,
  fileProblem,
  needsBank,
} from "../../lib/import-format.ts";
import { useSignedIn } from "../../session.tsx";
import { Button } from "../ui/button.tsx";
import { NativeSelect } from "../ui/select.tsx";
import { AccountPicker, HANDOFF_VALUE } from "./AccountPicker.tsx";
import { DropZone } from "./DropZone.tsx";
import { ExportTips } from "./ExportTips.tsx";
import { ImportSummary } from "./ImportSummary.tsx";

export interface ImportPopoverProps {
  readonly open: boolean;
  /** The account to preselect when the popover opens. */
  readonly accountId?: string | undefined;
  readonly onClose: () => void;
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "imported"; readonly result: ImportResult }
  | { readonly kind: "handed-off"; readonly to: string }
  | { readonly kind: "error"; readonly message: string };

async function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return await file.text();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsText(file);
  });
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The Import popover: drop a file, pick an account (or "For <partner>"), and see what happened. */
export function ImportPopover({ open, accountId, onClose }: ImportPopoverProps) {
  const { me } = useSignedIn();
  const queryClient = useQueryClient();
  const panel = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bank, setBank] = useState<BankId>("commbank_csv");
  const [target, setTarget] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const pending = phase.kind === "pending";

  const accounts = useQuery({
    queryKey: ["accounts", "import-picker"],
    queryFn: () => listAccounts(),
    enabled: open,
  });

  // Each opening starts fresh, unless an import is still running.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setPhase((current) => (current.kind === "pending" ? current : { kind: "idle" }));
      setFile((current) => (pending ? current : null));
      if (!pending) setTarget(accountId ?? "");
      queueMicrotask(() => panel.current?.focus());
    }
    wasOpen.current = open;
  }, [open, accountId, pending]);

  // The outcome is announced here, so a close request waits for a running import.
  const close = useCallback(() => {
    if (!pending) onClose();
  }, [onClose, pending]);

  // An id that is not among the loaded accounts (hidden, closed, gone) is not a choice.
  const loaded = accounts.data;
  useEffect(() => {
    if (!open || loaded === undefined) return;
    setTarget((current) =>
      current === "" || current === HANDOFF_VALUE || loaded.some((a) => a.id === current)
        ? current
        : "",
    );
  }, [open, loaded]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const problem = file === null ? null : fileProblem(file);
  const visible: readonly AccountView[] = accounts.data ?? [];
  const canImport = file !== null && problem === null && target !== "" && !pending;

  const choose = (next: File) => {
    setFile(next);
    setPhase({ kind: "idle" });
  };

  const run = async () => {
    if (file === null || problem !== null || target === "") return;
    const choice = chooseFormat(file.name, bank);
    if (!choice.ok) return;
    setPhase({ kind: "pending" });
    try {
      const content = await readText(file);
      if (target === HANDOFF_VALUE) {
        if (me.partner === null) throw new Error("There is no one to hand this to");
        await handOffFile({
          recipientId: me.partner.personId,
          filename: file.name,
          format: choice.format,
          content,
        });
        setPhase({ kind: "handed-off", to: me.partner.displayName });
      } else {
        const result = await importFile({ accountId: target, format: choice.format, content });
        setPhase({ kind: "imported", result });
      }
      setFile(null);
      await queryClient.invalidateQueries();
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof ApiError || err instanceof Error ? err.message : "Import failed",
      });
    }
  };

  // Keeps Tab inside the popover.
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || panel.current === null) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === panel.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const tipsBank: BankId =
    file !== null && !needsBank(file.name) && problem === null ? "commbank_csv" : bank;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close import"
        className="fixed inset-0 h-full w-full cursor-default bg-black/30"
        onClick={close}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        tabIndex={-1}
        onKeyDown={trap}
        className="fixed inset-x-4 top-16 z-10 mx-auto max-h-[calc(100vh-6rem)] max-w-[440px] space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl outline-none md:right-6 md:left-auto md:mx-0 md:w-[440px]"
      >
        <div>
          <h2 id="import-title" className="text-[17px] font-semibold">
            Import a bank file
          </h2>
          <p className="text-[13.5px] text-muted-foreground">
            CSV, OFX or QIF. Your data stays on this server.
          </p>
        </div>

        <DropZone file={file} disabled={pending} onFile={choose} />
        {problem === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        )}

        {file === null || (problem === null && needsBank(file.name)) ? (
          <div>
            <label htmlFor="import-bank" className="mb-1 block text-sm font-semibold">
              Which bank is the CSV from?
            </label>
            <NativeSelect
              id="import-bank"
              value={bank}
              disabled={pending}
              onChange={(event) => setBank(event.target.value as BankId)}
            >
              {BANKS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        <AccountPicker
          accounts={visible}
          me={me}
          value={target}
          disabled={pending}
          onChange={setTarget}
        />

        <ExportTips bank={tipsBank} />

        <div aria-live="polite" role="status" data-testid="import-status" className="min-h-5">
          {phase.kind === "pending" ? (
            <p className="text-sm text-muted-foreground">Reading file…</p>
          ) : null}
          {phase.kind === "imported" ? (
            <ImportSummary result={phase.result} onNavigate={close} />
          ) : null}
          {phase.kind === "handed-off" ? (
            <p className="text-sm font-semibold">
              Handed to {phase.to}. It&apos;ll wait in their Needs review.
            </p>
          ) : null}
          {phase.kind === "error" ? (
            <p className="text-sm text-destructive">{phase.message}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Esc to close</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {phase.kind === "imported" || phase.kind === "handed-off" ? "Done" : "Cancel"}
            </Button>
            <Button type="button" disabled={!canImport} onClick={() => void run()}>
              Import
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
