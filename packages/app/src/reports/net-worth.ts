import { Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import { isClosed } from "../accounts/closed-state.ts";
import { CASH_ACCOUNT_TYPES, poolOf } from "../accounts/pool.ts";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import { dayInput } from "../inputs.ts";
import type { AccountType, LatestImport } from "../ports/unit-of-work.ts";

export const ASSET_ACCOUNT_TYPES: readonly AccountType[] = ["transaction", "savings", "offset"];
export const LIABILITY_ACCOUNT_TYPES: readonly AccountType[] = ["credit_card", "home_loan"];

export const netWorthInput = z
  .object({
    /** `YYYY-MM-DD`; today (by the clock) when omitted. */
    asOf: dayInput.optional(),
  })
  .strict();
export type NetWorthInput = z.input<typeof netWorthInput>;

export interface NetWorthTrendPoint {
  readonly date: string;
  readonly netWorthCents: number;
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
}

export interface NetWorthAccount {
  readonly id: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly isPrivate: boolean;
  readonly institutionId: string | null;
  readonly institutionName: string | null;
  readonly openedOn: string | null;
  readonly closedOn: string | null;
  readonly isSavings: boolean;
  readonly owners: readonly { readonly personId: string; readonly shareBp: number }[];
  readonly pool: string;
  readonly balanceCents: number;
  readonly lastImport: LatestImport | null;
}

export interface NetWorthSubtotals {
  readonly cashCents: number;
  readonly savingsCents: number;
  readonly loansCents: number;
  readonly cardsCents: number;
}

export interface NetWorthReport {
  readonly asOf: string;
  readonly netWorthCents: number;
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
  readonly subtotals: NetWorthSubtotals;
  readonly subtotalsByType: {
    readonly transaction: number;
    readonly savings: number;
    readonly offset: number;
    readonly credit_card: number;
    readonly home_loan: number;
  };
  readonly trend: readonly NetWorthTrendPoint[];
  readonly accounts: readonly NetWorthAccount[];
  readonly latestImport: LatestImport | null;
}

/**
 * `reports.netWorth`: aggregates cash, card, and loan accounts visible to the viewer as of `asOf`,
 * computing total net worth, assets, liabilities, subtotals, and a 12-point monthly trend derived
 * on read (AD-11, AD-19). Private accounts of another partner are strictly excluded (AD-3, AD-5).
 */
export function netWorth(ctx: UseCaseContext, input: NetWorthInput = {}): NetWorthReport {
  const parsed = parseInput(netWorthInput, input);
  const asOf = parsed.asOf ?? ctx.clock.today().toString();
  const asOfDate = Temporal.PlainDate.from(asOf);

  // Generate 12 trend dates: 11 prior month-end dates plus `asOf` (mid-month or month-end).
  const trendDates: string[] = [];
  for (let offset = 11; offset >= 1; offset--) {
    const ym = asOfDate.toPlainYearMonth().subtract({ months: offset });
    trendDates.push(ym.toPlainDate({ day: ym.daysInMonth }).toString());
  }
  trendDates.push(asOf);

  return ctx.uow.read((repos) => {
    const allVisible = repos.accounts.list(ctx.viewer);
    const allCashAccounts = allVisible.filter((a) => CASH_ACCOUNT_TYPES.includes(a.type));
    const cashAccounts = allCashAccounts.filter((a) => !isClosed(a, asOf));

    const institutions = repos.institutions.list(ctx.viewer);
    const instMap = new Map(institutions.map((i) => [i.id, i.name]));

    let assetsCents = 0;
    let liabilitiesCents = 0;
    let cashCents = 0;
    let savingsCents = 0;
    let loansCents = 0;
    let cardsCents = 0;

    const subtotalsByType = {
      transaction: 0,
      savings: 0,
      offset: 0,
      credit_card: 0,
      home_loan: 0,
    };

    let latestImport: LatestImport | null = null;
    const accounts: NetWorthAccount[] = [];

    for (const a of cashAccounts) {
      const owners = repos.accounts.owners(a.id);
      const pool = poolOf(owners);
      const balanceCents = repos.balanceSnapshots.balanceAsOf(ctx.viewer, a.id, asOf) ?? 0;
      const lastImport = repos.importBatches.latestImportFor(ctx.viewer, a.id) ?? null;
      const institutionName = a.institutionId ? (instMap.get(a.institutionId) ?? null) : null;

      if (lastImport !== null) {
        if (
          latestImport === null ||
          lastImport.through > latestImport.through ||
          (lastImport.through === latestImport.through &&
            lastImport.importedAt > latestImport.importedAt)
        ) {
          latestImport = lastImport;
        }
      }

      if (a.type in subtotalsByType) {
        subtotalsByType[a.type as keyof typeof subtotalsByType] += balanceCents;
      }

      if (ASSET_ACCOUNT_TYPES.includes(a.type)) {
        assetsCents += balanceCents;
        if (a.type === "transaction" || a.type === "offset") {
          cashCents += balanceCents;
        } else if (a.type === "savings") {
          savingsCents += balanceCents;
        }
      } else if (LIABILITY_ACCOUNT_TYPES.includes(a.type)) {
        liabilitiesCents += balanceCents;
        if (a.type === "home_loan") {
          loansCents += balanceCents;
        } else if (a.type === "credit_card") {
          cardsCents += balanceCents;
        }
      }

      accounts.push({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        isPrivate: a.isPrivate,
        institutionId: a.institutionId,
        institutionName,
        openedOn: a.openedOn,
        closedOn: a.closedOn,
        isSavings: a.isSavings,
        owners: owners.map((o) => ({ personId: o.personId, shareBp: o.shareBp })),
        pool,
        balanceCents,
        lastImport,
      });
    }

    const netWorthCents = assetsCents + liabilitiesCents;

    // Calculate 12-point trend
    const trend: NetWorthTrendPoint[] = trendDates.map((date, idx) => {
      // For the last point (which is asOf), reuse the computed asOf figures
      if (idx === trendDates.length - 1) {
        return {
          date,
          netWorthCents,
          assetsCents,
          liabilitiesCents,
        };
      }

      let ptAssets = 0;
      let ptLiabilities = 0;
      const accountsOpenOnDate = allCashAccounts.filter((a) => !isClosed(a, date));
      for (const a of accountsOpenOnDate) {
        const bal = repos.balanceSnapshots.balanceAsOf(ctx.viewer, a.id, date) ?? 0;
        if (ASSET_ACCOUNT_TYPES.includes(a.type)) {
          ptAssets += bal;
        } else if (LIABILITY_ACCOUNT_TYPES.includes(a.type)) {
          ptLiabilities += bal;
        }
      }
      return {
        date,
        netWorthCents: ptAssets + ptLiabilities,
        assetsCents: ptAssets,
        liabilitiesCents: ptLiabilities,
      };
    });

    return {
      asOf,
      netWorthCents,
      assetsCents,
      liabilitiesCents,
      subtotals: {
        cashCents,
        savingsCents,
        loansCents,
        cardsCents,
      },
      subtotalsByType,
      trend,
      accounts,
      latestImport,
    };
  });
}
