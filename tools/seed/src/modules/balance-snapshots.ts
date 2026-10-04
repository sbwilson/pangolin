// The seed's balance snapshots (AD-19): each account's opening balance the day before the window,
// a statement balance at every month end and one on today. Every figure is the opening balance
// plus the account's transactions up to that day, so the snapshot chain has no gaps.
import type { Json, SeedModule } from "../module.ts";
import type { BalanceRecordedEvent } from "../world.ts";
import { OPENING_CENTS } from "./catalogue.ts";
import { iso, monthEnds, openingDay, windowOf } from "./dates.ts";

export const balanceSnapshots: SeedModule = {
  name: "balance-snapshots",
  dependsOn: ["transfers-and-privacy"],
  generate(world) {
    const w = windowOf(world.today);
    const days: { day: string; source: BalanceRecordedEvent["source"] }[] = [
      { day: iso(openingDay(w)), source: "manual" },
      ...monthEnds(w).map((d) => ({ day: iso(d), source: "statement" as const })),
      { day: iso(w.end), source: "statement" },
    ];
    const events: BalanceRecordedEvent[] = [];
    const closing: Record<string, Json> = {};
    for (const account of world.accounts) {
      const opening = OPENING_CENTS[account.key];
      if (opening === undefined) throw new Error(`No opening balance for account "${account.key}"`);
      const txns = world.transactions.filter((t) => t.account === account.key);
      for (const { day, source } of days) {
        const movement = txns
          .filter((t) => t.postedOn <= day)
          .reduce((sum, t) => sum + t.amountCents, 0);
        const balanceCents = day === iso(openingDay(w)) ? opening : opening + movement;
        events.push({
          type: "balance.recorded",
          account: account.key,
          asOf: day,
          balanceCents,
          source,
        });
        if (day === iso(w.end)) closing[account.key] = balanceCents;
      }
    }
    return {
      events,
      expectations: {
        snapshotCount: events.length,
        snapshotDays: days.map((d) => d.day),
        openingCents: { ...OPENING_CENTS },
        closingCents: closing,
      },
    };
  },
};
