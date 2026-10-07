// The closing-balance job handler: `closing-balance-sync` (local) runs the daily sync, which
// raises or resolves each closed account's review item for the clock's today. Idempotent.
import {
  CLOSING_BALANCE_SYNC_JOB,
  type JobRegistration,
  jobHandler,
  syncClosingBalances,
} from "@pangolin/app";

export function closingBalanceJobs(): JobRegistration[] {
  return [
    jobHandler(CLOSING_BALANCE_SYNC_JOB, async (ctx) => {
      syncClosingBalances(ctx);
    }),
  ];
}
