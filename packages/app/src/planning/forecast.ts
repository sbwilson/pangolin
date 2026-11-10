// `planning.forecastCashFlow` (read-only, AD-11): a per-account cash-flow projection over the
// horizon. Movements are materialised from pay-calendar deposits (AD-25), confirmed `bill`
// series rolled by cadence, and budget limits pro-rated at a daily rate across each pay-cycle
// period charged to the scope's deposit account. Only derived on read; the one stored input is
// each account's `lowBalanceThresholdCents`. The domain walk is pure (AD-14); this resolves the
// calendars and the clock.
import { type ForecastMovement, projectCashFlow } from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import type { PayCalendar, Period } from "@pangolin/shared/period";
import { type PlainDate, parseDate, Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { PayAnchorRow } from "../ports/unit-of-work.ts";
import { resolvePayCalendar } from "./pay-calendar.ts";

/** The horizons the forecast offers, in months from the clock's today. */
export const FORECAST_HORIZONS = [3, 6, 12] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];

/** Unknown, malformed or missing horizons fall back to 3 (never an error). */
export function parseForecastHorizon(value: unknown): ForecastHorizon {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return FORECAST_HORIZONS.find((h) => h === n) ?? 3;
}

export const forecastCashFlowInput = z
  .object({
    /** `3`, `6` or `12` (number or string); anything else means `3`. */
    horizon: z.union([z.number(), z.string()]).optional(),
  })
  .strict();
export type ForecastCashFlowInput = z.input<typeof forecastCashFlowInput>;

export interface ForecastPointView {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly balanceCents: number;
}

export interface ForecastAccountView {
  readonly accountId: string;
  readonly name: string;
  readonly lowBalanceThresholdCents: number;
  /** One point per day from `from` to `through`, after that day's movements. */
  readonly points: readonly ForecastPointView[];
}

export interface ForecastDipView {
  readonly accountId: string;
  readonly accountName: string;
  /** The projected balance on `date`, in signed cents. */
  readonly cents: number;
  /** `YYYY-MM-DD`; the first day below the threshold. */
  readonly date: string;
}

export interface ForecastReport {
  readonly from: string;
  readonly through: string;
  readonly horizonMonths: ForecastHorizon;
  /** True when no visible pay anchor carries an expected net amount: nothing deposits. */
  readonly missingDepositSource: boolean;
  readonly accounts: readonly ForecastAccountView[];
  readonly warnings: readonly ForecastDipView[];
}

/**
 * Occurrence `stepIndex` of a series due first on `nextDueOn`: weekly and fortnightly step in
 * days, monthly, quarterly and annual step in months counted from the first due day, so days
 * 29-31 clamp to shorter months' last day (Temporal's constrain overflow).
 */
function seriesOccurrence(
  nextDueOn: PlainDate,
  stepIndex: number,
  cadence: "weekly" | "fortnightly" | "monthly" | "quarterly" | "annual",
): PlainDate {
  switch (cadence) {
    case "weekly":
      return nextDueOn.add({ days: 7 * stepIndex });
    case "fortnightly":
      return nextDueOn.add({ days: 14 * stepIndex });
    case "monthly":
      return nextDueOn.add({ months: stepIndex });
    case "quarterly":
      return nextDueOn.add({ months: 3 * stepIndex });
    case "annual":
      return nextDueOn.add({ months: 12 * stepIndex });
  }
}

/** A budget's pay-cycle scope: the calendar bounding its periods and the account carrying its spend. */
interface BudgetScope {
  readonly calendar: PayCalendar;
  readonly accountId: string;
}

function budgetScopeOf(ctx: UseCaseContext, anchor: PayAnchorRow): BudgetScope {
  return { calendar: resolvePayCalendar(ctx, anchor), accountId: anchor.accountId };
}

/**
 * The budget's pay-cycle scope: a personal budget uses its person's pay anchor, a shared budget
 * the household's (whose cadence must match the budget's). No qualifying anchor — including a
 * shared budget with no household anchor — means the budget projects nothing.
 */
function forecastBudgetScope(
  ctx: UseCaseContext,
  budget: { readonly personId: Id<"Person"> | null; readonly cadence: "fortnight" | "month" },
): BudgetScope | null {
  if (budget.personId !== null) {
    const anchor = ctx.uow.read((repos) =>
      repos.payAnchors.findByPersonId(ctx.viewer, budget.personId as Id<"Person">),
    );
    return anchor === undefined ? null : budgetScopeOf(ctx, anchor);
  }
  const target = budget.cadence === "fortnight" ? "fortnightly" : "monthly";
  const anchor = ctx.uow.read((repos) => repos.payAnchors.findHouseholdAnchor());
  return anchor !== undefined && anchor.cadence === target ? budgetScopeOf(ctx, anchor) : null;
}

/**
 * `planning.forecastCashFlow`: projects every visible `transaction` account from the clock's
 * today through `today + horizon months`. Deposits land on each visible pay anchor's expected
 * pay days (never series, AD-25); only `status='confirmed'`, `direction='bill'` series roll
 * forward; budget limits pro-rate daily over each pay-cycle period inside the horizon, charged
 * to the budget scope's deposit account (a shared budget with no household anchor contributes
 * nothing). The first projected balance strictly below an account's threshold is its warning,
 * named with the account, the projected cents and the date.
 */
export function forecastCashFlow(
  ctx: UseCaseContext,
  input: ForecastCashFlowInput = {},
): ForecastReport {
  const parsed = parseInput(forecastCashFlowInput, input);
  const horizonMonths = parseForecastHorizon(parsed.horizon);
  const today = ctx.clock.today();
  const through = today.add({ months: horizonMonths });
  const todayIso = today.toString();

  const { projected, anchors, billSeries, budgets } = ctx.uow.read((repos) => ({
    projected: repos.accounts
      .list(ctx.viewer)
      .filter((a) => a.type === "transaction")
      .map((a) => ({
        accountId: a.id as string,
        name: a.name,
        thresholdCents: a.lowBalanceThresholdCents,
        openingCents: repos.balanceSnapshots.balanceAsOf(ctx.viewer, a.id, todayIso) ?? 0,
      })),
    anchors: repos.payAnchors.listVisible(ctx.viewer),
    billSeries: repos.recurringSeries.listVisible(ctx.viewer, { status: "confirmed" }),
    budgets: repos.budgets.listVisible(ctx.viewer),
  }));

  const projectedIds = new Set(projected.map((a) => a.accountId));
  const movements = new Map<string, ForecastMovement[]>();
  const addMovement = (accountId: string, date: PlainDate, cents: number): void => {
    if (!projectedIds.has(accountId)) return;
    const list = movements.get(accountId);
    if (list === undefined) movements.set(accountId, [{ date, cents }]);
    else list.push({ date, cents });
  };

  // 1. Pay deposits: each visible anchor's expected net on its calendar's pay days (AD-25).
  //    Ask past `through` so a period starting after it whose pay day rolls back is not missed.
  for (const anchor of anchors) {
    if (anchor.expectedNetCents === null) continue;
    const calendar = resolvePayCalendar(ctx, anchor);
    for (const period of calendar.periodsBetween(today, through.add({ days: 6 }))) {
      if (
        Temporal.PlainDate.compare(period.expectedPayDate, today) >= 0 &&
        Temporal.PlainDate.compare(period.expectedPayDate, through) <= 0
      ) {
        addMovement(anchor.accountId, period.expectedPayDate, anchor.expectedNetCents);
      }
    }
  }

  // 2. Confirmed bill series rolled forward from `nextDueOn`; monthly days 29-31 clamp.
  for (const series of billSeries) {
    if (series.direction !== "bill") continue;
    const nextDue = parseDate(series.nextDueOn);
    for (let i = 0; ; i++) {
      const due = seriesOccurrence(nextDue, i, series.cadence);
      if (Temporal.PlainDate.compare(due, through) > 0) break;
      if (Temporal.PlainDate.compare(due, today) >= 0) {
        addMovement(series.accountId, due, -series.expectedCents);
      }
    }
  }

  // 3. Budget spend: limitCents at a daily rate across each pay-cycle period inside the
  //    horizon, the rounding remainder on the period's last day.
  for (const budget of budgets) {
    const scope = forecastBudgetScope(ctx, budget);
    if (scope === null) continue;
    // Start one day before today so the current period (started earlier) is included.
    for (const period of scope.calendar.periodsBetween(today.subtract({ days: 1 }), through)) {
      addBudgetProration(period, today, through, budget.limitCents, (date, cents) =>
        addMovement(scope.accountId, date, cents),
      );
    }
  }

  const projection = projectCashFlow({
    from: today,
    through,
    accounts: projected.map((a) => ({
      accountId: a.accountId,
      openingCents: a.openingCents,
      thresholdCents: a.thresholdCents,
      movements: movements.get(a.accountId) ?? [],
    })),
  });

  const nameOf = new Map(projected.map((a) => [a.accountId, a.name]));
  return {
    from: todayIso,
    through: through.toString(),
    horizonMonths,
    missingDepositSource: !anchors.some((a) => a.expectedNetCents !== null),
    accounts: projection.accounts.map((account) => ({
      accountId: account.accountId,
      name: nameOf.get(account.accountId) ?? "",
      lowBalanceThresholdCents: account.thresholdCents,
      points: account.points.map((p) => ({
        date: p.date.toString(),
        balanceCents: p.balanceCents,
      })),
    })),
    warnings: projection.warnings.map((w) => ({
      accountId: w.accountId,
      accountName: nameOf.get(w.accountId) ?? "",
      cents: w.cents,
      date: w.date.toString(),
    })),
  };
}

/**
 * Adds one pay-cycle period's budget spend: `Math.round(limitCents / periodDays)` on every day
 * of the period that lies in `from`..`through`, plus the rounding remainder on the period's
 * last day (only when that day is inside the window).
 */
function addBudgetProration(
  period: Period,
  from: PlainDate,
  through: PlainDate,
  limitCents: number,
  add: (date: PlainDate, cents: number) => void,
): void {
  const periodDays = period.end.since(period.start, { largestUnit: "days" }).days;
  if (periodDays <= 0) return;
  const daily = Math.round(limitCents / periodDays);
  const remainder = limitCents - daily * periodDays;
  const lastDay = period.end.subtract({ days: 1 });
  for (let day = period.start; Temporal.PlainDate.compare(day, lastDay) <= 0; ) {
    if (
      Temporal.PlainDate.compare(day, from) >= 0 &&
      Temporal.PlainDate.compare(day, through) <= 0
    ) {
      const onLastDay = Temporal.PlainDate.compare(day, lastDay) === 0;
      add(day, -(daily + (onLastDay ? remainder : 0)));
    }
    day = day.add({ days: 1 });
  }
}
