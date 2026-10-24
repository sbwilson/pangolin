import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { ImportPopover } from "./ImportPopover.tsx";

export interface OpenImportOptions {
  /** The account to preselect. */
  readonly accountId?: string;
}

export interface ImportControls {
  readonly openImport: (options?: OpenImportOptions) => void;
}

const ImportContext = createContext<ImportControls | null>(null);

/** Opens the Import popover from anywhere under the provider, or null when outside one. */
export function useOptionalImport(): ImportControls | null {
  return useContext(ImportContext);
}

/** Opens the Import popover from anywhere under the provider. */
export function useImport(): ImportControls {
  const controls = useContext(ImportContext);
  if (controls === null) throw new Error("useImport must be used inside the ImportProvider");
  return controls;
}

/** Owns the popover's open state; mounted in the root layout so every view can open it. */
export function ImportProvider({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);

  const openImport = useCallback((options?: OpenImportOptions) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAccountId(options?.accountId);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const back = opener.current;
    opener.current = null;
    // After the popover has gone, so focus is not pulled back into it.
    queueMicrotask(() => {
      if (back?.isConnected) back.focus();
    });
  }, []);

  const controls = useMemo(() => ({ openImport }), [openImport]);
  return (
    <ImportContext.Provider value={controls}>
      {children}
      <ImportPopover open={open} accountId={accountId} onClose={close} />
    </ImportContext.Provider>
  );
}
