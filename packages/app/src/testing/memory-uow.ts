// Test support only (not exported from the package): an in-memory `UnitOfWork` with rollback,
// so `app` tests can check transaction behaviour without importing an adapter.
import type { AuditRow, HouseholdSettingsRow, TxRepos, UnitOfWork } from "../ports/unit-of-work.ts";

export interface MemoryState {
  settings: HouseholdSettingsRow;
  audit: AuditRow[];
}

export interface MemoryUnitOfWork extends UnitOfWork {
  readonly state: MemoryState;
  /** Makes the next `audit.append` calls throw, to test rollback. */
  failAudit: boolean;
}

export const DEFAULT_SETTINGS: HouseholdSettingsRow = {
  baseCurrency: "AUD",
  fyStart: "07-01",
  timezone: "Australia/Sydney",
  sharedAttribution: "contribution",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export function memoryUnitOfWork(
  settings: HouseholdSettingsRow = DEFAULT_SETTINGS,
): MemoryUnitOfWork {
  const uow: MemoryUnitOfWork = {
    state: { settings, audit: [] },
    failAudit: false,
    transaction<T>(fn: (tx: TxRepos) => T): T {
      const working: MemoryState = { settings: uow.state.settings, audit: [...uow.state.audit] };
      let active = true;
      const check = () => {
        if (!active) throw new Error("Repository used outside its transaction");
      };
      const tx: TxRepos = {
        householdSettings: {
          get: () => {
            check();
            return working.settings;
          },
          update: (row) => {
            check();
            working.settings = row;
          },
        },
        audit: {
          append: (row) => {
            check();
            if (uow.failAudit) throw new Error("audit append failed");
            working.audit.push(row);
          },
        },
      };
      try {
        const result = fn(tx);
        uow.state.settings = working.settings;
        uow.state.audit = working.audit;
        return result;
      } finally {
        active = false;
      }
    },
    read(fn) {
      return fn({ householdSettings: { get: () => uow.state.settings } });
    },
  };
  return uow;
}
