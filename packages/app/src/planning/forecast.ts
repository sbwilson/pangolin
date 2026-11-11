// `planning.forecastCashFlow` (read-only, AD-11): a per-account cash-flow projection over the
// horizon. Day 0 carries each account's actual balance today and projected movements start
// tomorrow: a deposit, bill or proration slice due today is already in that balance. Movements
// are materialised from pay-calendar deposits (AD-25), confirmed `bill` series rolled by cadence
// excepting categories a confirmed series already covers, and budget limits pro-rated at a daily
// rate across each pay-cycle period, charged to the budget's funding account (default: the
// scope's deposit account, AD-25). At each pay-period close the deposit account is additionally
// debited the active allocation stage's shares of that period's projected positive savings
// (virtual — the goal tables are read-only here). Only derived on read; the stored inputs are
// each account's `lowBalanceThresholdCents` and each budget's `fundingAccountId`. The domain
// walk is pure (AD-14); this resolves the calendars, the shares and the clock.

import { type ForecastMovement, projectCashFlow } from "@pangolin/domain";
import { allocate, cents, type Id } from "@pangolin/shared";
import type { PayCalendar, Period } from "@pangolin/shared/period";
import { type PlainDate, parseDate, Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type {
  BudgetRow,
  CategoryRow,
  PayAnchorRow,
  PayeeRow,
  RecurringSeriesRow,
} from "../ports/unit-of-work.ts";
import { calculateGoalBalances, resolveActiveStage } from "./goal-allocation.ts";
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
 * The categories confirmed bill series already project: each series' payee `defaultCategoryId`
 * (AD-25). A payee without a default category covers nothing, and neither does a series whose
 * account is outside the projected set — its movements are dropped, so it must not silence a
 * budget's proration either.
 */
function coveredCategories(
  billSeries: readonly RecurringSeriesRow[],
  payees: readonly PayeeRow[],
  projectedIds: ReadonlySet<string>,
): Set<string> {
  const defaultOf = new Map<string, string | null>(
    payees.map((p) => [p.id as string, p.defaultCategoryId]),
  );
  const covered = new Set<string>();
  for (const series of billSeries) {
    if (series.direction !== "bill") continue;
    if (!projectedIds.has(series.accountId)) continue;
    const categoryId = defaultOf.get(series.payeeId as string);
    if (categoryId !== null && categoryId !== undefined) covered.add(categoryId);
  }
  return covered;
}

/**
 * Whether a budget's spend is already projected as bill series: a category budget when its
 * category is covered, a group budget only when every live category of its group is (the
 * all-covered rule — a partially covered group still projects fully). A group with no live
 * categories covers nothing: nothing of it is projected, so the budget keeps projecting.
 */
function budgetIsCovered(
  budget: BudgetRow,
  covered: ReadonlySet<string>,
  categories: readonly CategoryRow[],
): boolean {
  if (budget.categoryId !== null) return covered.has(budget.categoryId);
  if (budget.categoryGroupId === null) return false;
  const live = categories.filter((c) => c.groupId === budget.categoryGroupId);
  return live.length > 0 && live.every((c) => covered.has(c.id as string));
}

/**
 * The shared pool's active allocation stage rule shares — the AD-13 weights a period close
 * would split savings by. Read-only reuse of the goals view's own `resolveActiveStage`; no
 * pool, no goals or no active stage means the forecast projects no allocation debit. The same
 * rule selection as `executeSavingsAllocation` applies: standard rules only.
 */
function activeAllocationShares(ctx: UseCaseContext): number[] {
  const rules = ctx.uow.read((repos) => {
    const goals = repos.goals.listVisible(ctx.viewer).filter((g) => g.personId === null);
    const stages = repos.stages.listVisible(ctx.viewer).filter((s) => s.personId === null);
    if (goals.length === 0 || stages.length === 0) return [];
    const allocations = goals.flatMap((goal) =>
      repos.goalAllocations.listForGoal(ctx.viewer, goal.id),
    );
    const adjustments = repos.goalAdjustments.listActiveForPool(ctx.viewer, "shared");
    const balances = calculateGoalBalances(allocations, adjustments);
    const { activeStage } = resolveActiveStage(stages, goals, balances);
    return activeStage === null ? [] : repos.goalRules.listForStage(ctx.viewer, activeStage.id);
  });
  return rules.filter((rule) => rule.source === "rule").map((rule) => rule.shareBp);
}

/**
 * `planning.forecastCashFlow`: projects every visible `transaction` account that has not been
 * closed. Day 0 is the account's actual `balanceAsOf(today)` and projected movements run from
 * tomorrow through `today + horizon months` — nothing due today is re-projected. Deposits land
 * on each visible pay anchor's expected pay days (never series, AD-25); only
 * `status='confirmed'`, `direction='bill'` series roll forward, excepting budgets whose
 * categories a confirmed series already covers; budget limits pro-rate daily over each
 * pay-cycle period inside the horizon, charged to the budget's funding account (unset means
 * the scope's deposit account; a shared budget with no household anchor contributes nothing).
 * Each pay-period close also debits the deposit account with the active allocation stage's
 * shares of that period's projected positive savings. The first projected balance strictly
 * below an account's threshold is its warning, named with the account, the projected cents
 * and the date.
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
  // Day 0 is today's actual balance; movements dated today are already inside it.
  const projectedFrom = today.add({ days: 1 });

  const { projected, anchors, billSeries, payeeRows, categoryRows, budgets } = ctx.uow.read(
    (repos) => ({
      projected: repos.accounts
        .list(ctx.viewer)
        // Closed accounts hold stale balances, so they never join the walk.
        .filter((a) => a.type === "transaction" && a.closedOn === null)
        .map((a) => ({
          accountId: a.id as string,
          name: a.name,
          thresholdCents: a.lowBalanceThresholdCents,
          openingCents: repos.balanceSnapshots.balanceAsOf(ctx.viewer, a.id, todayIso) ?? 0,
        })),
      anchors: repos.payAnchors.listVisible(ctx.viewer),
      billSeries: repos.recurringSeries.listVisible(ctx.viewer, { status: "confirmed" }),
      payeeRows: repos.payees.list(ctx.viewer),
      categoryRows: repos.categories.list(ctx.viewer),
      budgets: repos.budgets.listVisible(ctx.viewer),
    }),
  );

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
  //    Also remember each deposit account's calendar: step 4 debits its period closes.
  const depositCalendars = new Map<string, PayCalendar>();
  for (const anchor of anchors) {
    if (anchor.expectedNetCents === null) continue;
    const calendar = resolvePayCalendar(ctx, anchor);
    for (const period of calendar.periodsBetween(today, through.add({ days: 6 }))) {
      if (
        Temporal.PlainDate.compare(period.expectedPayDate, projectedFrom) >= 0 &&
        Temporal.PlainDate.compare(period.expectedPayDate, through) <= 0
      ) {
        addMovement(anchor.accountId, period.expectedPayDate, anchor.expectedNetCents);
      }
    }
    // First anchor per account wins; two anchors on one account share its close rhythm.
    if (!depositCalendars.has(anchor.accountId)) {
      depositCalendars.set(anchor.accountId, calendar);
    }
  }

  // 2. Confirmed bill series rolled forward from `nextDueOn`; monthly days 29-31 clamp.
  for (const series of billSeries) {
    if (series.direction !== "bill") continue;
    const nextDue = parseDate(series.nextDueOn);
    for (let i = 0; ; i++) {
      const due = seriesOccurrence(nextDue, i, series.cadence);
      if (Temporal.PlainDate.compare(due, through) > 0) break;
      if (Temporal.PlainDate.compare(due, projectedFrom) >= 0) {
        addMovement(series.accountId, due, -series.expectedCents);
      }
    }
  }

  // 3. Budget spend: limitCents at a daily rate across each pay-cycle period inside the
  //    horizon, the rounding remainder on the period's last day. Spend charges the budget's
  //    funding account (unset: the scope's deposit account); series-covered budgets project
  //    nothing — the series already roll those categories forward.
  const covered = coveredCategories(billSeries, payeeRows, projectedIds);
  for (const budget of budgets) {
    if (budgetIsCovered(budget, covered, categoryRows)) continue;
    const scope = forecastBudgetScope(ctx, budget);
    if (scope === null) continue;
    const targetAccountId = budget.fundingAccountId ?? scope.accountId;
    // Start one day before today so the current period (started earlier) is included.
    for (const period of scope.calendar.periodsBetween(today.subtract({ days: 1 }), through)) {
      addBudgetProration(period, projectedFrom, through, budget.limitCents, (date, cents) =>
        addMovement(targetAccountId, date, cents),
      );
    }
  }

  // 4. Virtual goal allocations: each pay-period close inside the horizon debits the deposit
  //    account with the active stage's shares of the period's projected positive savings — all
  //    base movements landing there from the period's own expected pay day (a weekend-rolled
  //    deposit lands before `start`, and belongs to the period it pays for) through the close,
  //    floored at 0 — split largest-remainder (AD-13). The base is snapshotted so one period's
  //    debit never shrinks a later period's savings.
  const shares = activeAllocationShares(ctx);
  if (shares.some((share) => share > 0)) {
    for (const [accountId, calendar] of depositCalendars) {
      const base = [...(movements.get(accountId) ?? [])];
      for (const period of calendar.periodsBetween(projectedFrom, through)) {
        const closeDay = period.end.subtract({ days: 1 });
        if (Temporal.PlainDate.compare(closeDay, projectedFrom) < 0) continue;
        if (Temporal.PlainDate.compare(closeDay, through) > 0) continue;
        const savings = Math.max(
          0,
          base.reduce(
            (sum, m) =>
              Temporal.PlainDate.compare(m.date, period.expectedPayDate) >= 0 &&
              Temporal.PlainDate.compare(m.date, closeDay) <= 0
                ? sum + m.cents
                : sum,
            0,
          ),
        );
        if (savings <= 0) continue;
        // Mirrors `executeSavingsAllocation`'s sweep arithmetic only — the rules' summed shareBp
        // of the savings, floored, then split largest-remainder, shares summing below 100%
        // leaving a buffer. It does not mirror the engine's completed-goal rescale or its
        // exit-capacity caps: this projection never mutates goals or stages.
        const totalShares = shares.reduce((sum, share) => sum + share, 0);
        const toAllocate = Math.floor((savings * totalShares) / 10_000);
        if (toAllocate <= 0) continue;
        for (const part of allocate(cents(toAllocate), shares)) {
          // Virtual: the goal side never joins the walk — goal balances are not accounts.
          addMovement(accountId, closeDay, -part);
        }
      }
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
