import { allocate, cents } from "@pangolin/shared";
import type { Cadence, PayCalendar } from "@pangolin/shared/period";
import { createCalendarPayCalendar } from "@pangolin/shared/period";
import type { PlainDate } from "@pangolin/shared/temporal";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import type { Json, SeedModule } from "../module.ts";
import type {
  BudgetCreatedEvent,
  CategoryRef,
  ForecastAssumptionSetEvent,
  PayAnchorCreatedEvent,
  RecurringSeriesCreatedEvent,
  SeedEvent,
  World,
  WorldAccount,
} from "../world.ts";
import { ACCOUNT_KEYS, cat, OPENING_CENTS } from "./catalogue.ts";
import { iso } from "./dates.ts";
import { PERSON_KEYS } from "./people-and-household.ts";

const [A, B] = PERSON_KEYS;

// The pay-period close split the forecast mirrors: the goals module's stage one allocates the
// shared pool's savings 80% / 10% / 10% (rainyDay / houseDeposit / japanTrip — see goals.ts).
// The goals module runs after this one, so its stages are not yet folded into the world; if
// its stage-one rules change, the day-delta comparison in `forecast-seed.test.ts` fails loudly.
const STAGE_ONE_SHARES = [8000, 1000, 1000] as const;

export const BUDGET_KEYS = {
  sharedGroceries: "budget-shared-groceries",
  personalCoffeeA: "budget-personal-coffee-a",
  personalFitnessB: "budget-personal-fitness-b",
  personalMobileA: "budget-personal-mobile-a",
} as const;

export const PAY_ANCHOR_KEYS = {
  personA: "anchor-person-a",
  personB: "anchor-person-b",
} as const;

export const RECURRING_SERIES_KEYS = {
  netflix: "series-netflix",
  sydneyWater: "series-sydney-water",
  telstra: "series-telstra",
} as const;

// The demo forecast assumptions: savings 45%, returns 3% / 5% / 7%, super 12%, and the
// household home loan paid down with its offset balances netted. The use-case defaults stay
// neutral zeros; only the seed carries these (ticket 4's decision).
export const FORECAST_ASSUMPTION_DEMO = {
  savingsRateBps: 4_500,
  returnLowBps: 300,
  returnMidBps: 500,
  returnHighBps: 700,
  superRateBps: 1_200,
  mortgages: [{ account: ACCOUNT_KEYS.homeLoan, countOffset: true }],
} as const;

export const budgetsAndBills: SeedModule = {
  name: "budgets-and-bills",
  dependsOn: ["ledger-transactions", "transfers-and-privacy"],
  generate(world: World): { events: readonly SeedEvent[]; expectations: Record<string, Json> } {
    const _today = world.today;

    // 1. Pay Anchors
    // Person A: paid fortnightly to joint everyday, anchor 2026-07-03
    // Person B: paid fortnightly to joint everyday, anchor 2026-07-05
    const anchorA: PayAnchorCreatedEvent = {
      type: "pay-anchor.created",
      key: PAY_ANCHOR_KEYS.personA,
      person: A,
      account: ACCOUNT_KEYS.everyday,
      cadence: "fortnightly",
      anchorDate: "2026-07-03",
      dayOfMonth: null,
      alignment: "calendar",
      expectedNetCents: 385_000,
      expectedGrossCents: 520_000,
    };

    const anchorB: PayAnchorCreatedEvent = {
      type: "pay-anchor.created",
      key: PAY_ANCHOR_KEYS.personB,
      person: B,
      account: ACCOUNT_KEYS.everyday,
      cadence: "fortnightly",
      anchorDate: "2026-07-05",
      dayOfMonth: null,
      alignment: "calendar",
      expectedNetCents: 320_000,
      expectedGrossCents: 430_000,
    };

    // 2. Budgets
    // Shared Groceries budget: limit $300 ($300.00 / 30000 cents), rollover true
    const sharedGroceriesBudget: BudgetCreatedEvent = {
      type: "budget.created",
      key: BUDGET_KEYS.sharedGroceries,
      person: null, // shared
      category: cat("Food", "Groceries"),
      categoryGroup: null,
      fundingAccount: null,
      cadence: "fortnight",
      limitCents: 30_000,
      rollover: true,
    };

    // Personal Coffee budget for Person A: limit $20 ($20.00 / 2000 cents), rollover false.
    // Its spend is charged to Person A's private account — the funding-account override demo.
    const personalCoffeeBudgetA: BudgetCreatedEvent = {
      type: "budget.created",
      key: BUDGET_KEYS.personalCoffeeA,
      person: A,
      category: cat("Food", "Coffee"),
      categoryGroup: null,
      fundingAccount: ACCOUNT_KEYS.privateA,
      cadence: "fortnight",
      limitCents: 2_000,
      rollover: false,
    };

    // Personal Fitness budget for Person B: limit $40 ($40.00 / 4000 cents), rollover false
    const personalFitnessBudgetB: BudgetCreatedEvent = {
      type: "budget.created",
      key: BUDGET_KEYS.personalFitnessB,
      person: B,
      category: cat("Health", "Fitness"),
      categoryGroup: null,
      fundingAccount: null,
      cadence: "fortnight",
      limitCents: 4_000,
      rollover: false,
    };

    // Personal Mobile budget for Person A: limit $200, rollover false.
    // Its category is the Telstra payee's default category, which the confirmed Telstra series
    // rolls forward — so the forecast excludes this budget entirely (the series-exclusion demo).
    const personalMobileBudgetA: BudgetCreatedEvent = {
      type: "budget.created",
      key: BUDGET_KEYS.personalMobileA,
      person: A,
      category: cat("Utilities", "Mobile"),
      categoryGroup: null,
      fundingAccount: null,
      cadence: "fortnight",
      limitCents: 20_000,
      rollover: false,
    };

    // 2b. Forecast assumptions: both people get the demo values, each with the household
    // home loan selected and its offset counted (the 8.7 chips edit these later).
    const assumptionsA: ForecastAssumptionSetEvent = {
      type: "forecast-assumption.set",
      person: A,
      ...FORECAST_ASSUMPTION_DEMO,
      mortgages: [...FORECAST_ASSUMPTION_DEMO.mortgages],
    };

    const assumptionsB: ForecastAssumptionSetEvent = {
      type: "forecast-assumption.set",
      person: B,
      ...FORECAST_ASSUMPTION_DEMO,
      mortgages: [...FORECAST_ASSUMPTION_DEMO.mortgages],
    };

    // 3. Recurring Series
    // series 1: Sydney Water - missed payment alert
    // Cadence monthly, expected $180.00 (18000 cents), nextDueOn 2026-07-01.
    // Grace period is 7 days -> cutoff 2026-07-08 < today (2026-07-15).
    // In seed, Sydney Water is quarterly and only paid in Sep, Dec, Mar, Jun.
    // There are NO payments in July 2026!
    // Matching window [2026-06-24, 2026-07-15] has NO transaction.
    // -> raises planning.bill_alert.missed_payment review item!
    const sydneyWaterSeries: RecurringSeriesCreatedEvent = {
      type: "recurring-series.created",
      key: RECURRING_SERIES_KEYS.sydneyWater,
      account: ACCOUNT_KEYS.everyday,
      payee: "sydney-water",
      direction: "bill",
      cadence: "monthly",
      expectedCents: 18_000,
      toleranceBp: 1500,
      nextDueOn: "2026-07-01",
      status: "confirmed",
    };

    // series 2: Telstra - price rise alert
    // In seed, Telstra was paid $84.00 on 2026-07-15.
    // We set expected amount to $75.00 (7500 cents).
    // 8400 > 7500 * 1.10 (8250 cents) -> >10% price rise (12% rise)!
    // -> raises planning.bill_alert.price_rise review item!
    const telstraSeries: RecurringSeriesCreatedEvent = {
      type: "recurring-series.created",
      key: RECURRING_SERIES_KEYS.telstra,
      account: ACCOUNT_KEYS.everyday,
      payee: "telstra",
      direction: "bill",
      cadence: "monthly",
      expectedCents: 7_500,
      toleranceBp: 1500,
      nextDueOn: "2026-07-15",
      status: "confirmed",
    };

    // series 3: Netflix - candidate series
    // In seed, Netflix has 12 monthly payments on day 11 of $23.00.
    // We record it as a candidate (status: "candidate") ready for one-click confirmation!
    const netflixSeries: RecurringSeriesCreatedEvent = {
      type: "recurring-series.created",
      key: RECURRING_SERIES_KEYS.netflix,
      account: ACCOUNT_KEYS.everyday,
      payee: "netflix",
      direction: "bill",
      cadence: "monthly",
      expectedCents: 2_300,
      toleranceBp: 1500,
      nextDueOn: "2026-08-11",
      status: "candidate",
    };

    const events: SeedEvent[] = [
      anchorA,
      anchorB,
      assumptionsA,
      assumptionsB,
      sharedGroceriesBudget,
      personalCoffeeBudgetA,
      personalFitnessBudgetB,
      personalMobileBudgetA,
      sydneyWaterSeries,
      telstraSeries,
      netflixSeries,
    ];

    // Compute exact hand-calculated figures for Groceries budget
    // Household anchor: Person A fortnightly anchor "2026-07-03".
    // Calendar for Person A: fortnights [2026-06-19, 2026-07-03), [2026-07-03, 2026-07-17).
    // Today is 2026-07-15.
    // Current period: 2026-07-03 to 2026-07-17 (14 days).
    // Elapsed days: 2026-07-03 to 2026-07-15 = 12 days.
    // Prior period: 2026-06-19 to 2026-07-03 (14 days).
    // Let's compute exact spending from world.transactions for Groceries in both periods.
    // In database, budgets query splits with category matching Food / Groceries.
    // When a transaction has explicit splits, split.category is matched.
    // When a transaction has single split, split.category comes from transaction.category.
    // If a transaction was left uncategorised (about 10% of purchases), its category is undefined and it is NOT counted towards the Groceries budget!
    // Calculate sum in [start, end) taking into account splits and uncategorised transactions
    const sumGroceriesIn = (start: string, end: string): number => {
      let sum = 0;
      for (const t of world.transactions) {
        if (t.postedOn >= start && t.postedOn < end) {
          if (t.splits && t.splits.length > 0) {
            for (const s of t.splits) {
              if (s.category && s.category.group === "Food" && s.category.name === "Groceries") {
                sum += Math.abs(s.amountCents);
              }
            }
          } else if (t.category && t.category.group === "Food" && t.category.name === "Groceries") {
            sum += Math.abs(t.amountCents);
          }
        }
      }
      return sum;
    };

    const currentPeriodStart = "2026-07-03";
    const currentPeriodEnd = "2026-07-17";
    const priorPeriodStart = "2026-06-19";
    const priorPeriodEnd = "2026-07-03";

    const currentSpent = sumGroceriesIn(currentPeriodStart, currentPeriodEnd);
    const priorSpent = sumGroceriesIn(priorPeriodStart, priorPeriodEnd);

    // Prior limit = 30000. Rollover = limit - priorSpent
    const rolloverCents = 30_000 - priorSpent;
    const effectiveLimitCents = 30_000 + rolloverCents;

    // Pace = round(effectiveLimit * (elapsedDays / totalDays))
    // elapsed = 12, total = 14
    const paceCents = Math.round(effectiveLimitCents * (12 / 14));

    // Projected = spent + round((spent / elapsed) * remainingDays)
    // remaining = 2
    const projectedCents = currentSpent + Math.round((currentSpent / 12) * 2);

    // 6 closed periods prior to current period:
    // Period 1: 2026-06-19 to 2026-07-03
    // Period 2: 2026-06-05 to 2026-06-19
    // Period 3: 2026-05-22 to 2026-06-05
    // Period 4: 2026-05-08 to 2026-05-22
    // Period 5: 2026-04-24 to 2026-05-08
    // Period 6: 2026-04-10 to 2026-04-24
    const closed6Periods = [
      sumGroceriesIn("2026-06-19", "2026-07-03"),
      sumGroceriesIn("2026-06-05", "2026-06-19"),
      sumGroceriesIn("2026-05-22", "2026-06-05"),
      sumGroceriesIn("2026-05-08", "2026-05-22"),
      sumGroceriesIn("2026-04-24", "2026-05-08"),
      sumGroceriesIn("2026-04-10", "2026-04-24"),
    ];
    const suggestedLimitCents = Math.round(
      closed6Periods.reduce((a, b) => a + b, 0) / closed6Periods.length,
    );

    // 4. Forecast expectations (planning-forecast, full cash-flow model). Mirrors the read-only
    //    `planning.forecastCashFlow` projection: per viewer, day 0 carries each visible
    //    `transaction` account's actual balance today and projections run from tomorrow through
    //    today + 3 months — calendar-aligned pay deposits (AD-25), confirmed bill series rolled
    //    forward, budget limits pro-rated daily to the budget's funding account (default: the
    //    scope's deposit account), and a virtual allocation debit of the stage-one shares at
    //    each pay-period close. Series-covered budgets contribute nothing; shared budgets
    //    contribute nothing — the household has no household pay anchor.
    const forecast = forecastDipExpectations(
      world,
      [anchorA, anchorB],
      [sydneyWaterSeries, telstraSeries, netflixSeries],
      [sharedGroceriesBudget, personalCoffeeBudgetA, personalFitnessBudgetB, personalMobileBudgetA],
    );

    return {
      events,
      expectations: {
        forecast,
        forecastAssumptions: {
          personA: {
            person: assumptionsA.person,
            savingsRateBps: assumptionsA.savingsRateBps,
            returnLowBps: assumptionsA.returnLowBps,
            returnMidBps: assumptionsA.returnMidBps,
            returnHighBps: assumptionsA.returnHighBps,
            superRateBps: assumptionsA.superRateBps,
            mortgages: assumptionsA.mortgages.map((m) => ({
              account: m.account,
              countOffset: m.countOffset,
            })),
          },
          personB: {
            person: assumptionsB.person,
            savingsRateBps: assumptionsB.savingsRateBps,
            returnLowBps: assumptionsB.returnLowBps,
            returnMidBps: assumptionsB.returnMidBps,
            returnHighBps: assumptionsB.returnHighBps,
            superRateBps: assumptionsB.superRateBps,
            mortgages: assumptionsB.mortgages.map((m) => ({
              account: m.account,
              countOffset: m.countOffset,
            })),
          },
        },
        payAnchors: {
          personA: {
            key: anchorA.key,
            anchorDate: anchorA.anchorDate,
            cadence: anchorA.cadence,
          },
          personB: {
            key: anchorB.key,
            anchorDate: anchorB.anchorDate,
            cadence: anchorB.cadence,
          },
        },
        groceriesBudget: {
          key: sharedGroceriesBudget.key,
          limitCents: sharedGroceriesBudget.limitCents,
          currentPeriodStart,
          currentPeriodEnd,
          currentSpentCents: currentSpent,
          priorSpentCents: priorSpent,
          rolloverCents,
          effectiveLimitCents,
          paceCents,
          projectedCents,
          isOverBudget: currentSpent > effectiveLimitCents,
          suggestedLimitCents,
          closed6Periods,
        },
        recurringSeries: {
          netflixKey: netflixSeries.key,
          sydneyWaterKey: sydneyWaterSeries.key,
          telstraKey: telstraSeries.key,
        },
      },
    };
  },
};

/** One projected dip: the first balance strictly below the account's threshold. */
interface ForecastDip {
  readonly account: string;
  readonly cents: number;
  readonly dateOn: string;
}

/** The calendar `createCalendarPayCalendar` builds for a seeded calendar-aligned pay anchor. */
function payCalendarOf(anchor: PayAnchorCreatedEvent): PayCalendar {
  if (anchor.alignment !== "calendar" || anchor.anchorDate === null) {
    throw new Error(
      `forecast mirror only handles calendar-aligned anchored pay anchors: ${anchor.key}`,
    );
  }
  const cadence: Cadence =
    anchor.cadence === "fortnightly"
      ? { kind: "fortnightly", anchor: parseDate(anchor.anchorDate) }
      : { kind: "monthly", day: anchor.dayOfMonth ?? parseDate(anchor.anchorDate).day };
  return createCalendarPayCalendar(anchor.key, cadence);
}

/**
 * Occurrence `stepIndex` of a series due first on `nextDueOn`, mirroring the app forecast's
 * roll-forward: day-based cadences step days, month-based ones step months (clamping).
 */
function seriesOccurrence(
  nextDueOn: PlainDate,
  stepIndex: number,
  cadence: RecurringSeriesCreatedEvent["cadence"],
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

// A category is identified by its `group/name` pair, matching how the payee default-category
// reference identifies the categories confirmed series cover.
const catKey = (category: CategoryRef): string => `${category.group}/${category.name}`;

/**
 * Mirrors `planning.forecastCashFlow` for the seeded world: per viewer person key, day 0's
 * actual balance, every projected movement by account and day (including the virtual
 * period-close allocation debits), the allocation debit list, and the first dip below
 * threshold for each of their visible `transaction` accounts over the next three months.
 * Deliberately a mirror, not a re-import — if the use case's arithmetic changes, this
 * expectation changes with it and `forecast-seed.test.ts` says so.
 */
function forecastDipExpectations(
  world: World,
  anchors: readonly PayAnchorCreatedEvent[],
  series: readonly RecurringSeriesCreatedEvent[],
  budgets: readonly BudgetCreatedEvent[],
): Json {
  const today = world.today;
  const through = today.add({ months: 3 });
  // Day 0 is today's actual balance; projected movements start tomorrow.
  const projectedFrom = today.add({ days: 1 });
  const accountsByKey = new Map(world.accounts.map((a) => [a.key, a]));
  const visibleTo = (account: WorldAccount, viewer: string): boolean =>
    !account.isPrivate || account.owners.some((o) => o.person === viewer);

  // Balance as of `today`: the opening snapshot plus every movement up to and including it,
  // the same chain `balance-snapshots` writes and `balanceAsOf` reads.
  const openingOf = (accountKey: string): number => {
    const opening = OPENING_CENTS[accountKey];
    if (opening === undefined) throw new Error(`No opening balance for account "${accountKey}"`);
    let balance = opening;
    for (const t of world.transactions) {
      if (t.account === accountKey && t.postedOn <= iso(today)) balance += t.amountCents;
    }
    return balance;
  };

  const warnings: Record<string, Json> = {};
  const perViewer: Record<string, Json> = {};
  for (const viewer of PERSON_KEYS) {
    const projected = world.accounts.filter(
      (a) => a.accountType === "transaction" && visibleTo(a, viewer),
    );
    const projectedKeys = new Set(projected.map((a) => a.key));
    // The categories confirmed bill series already project: each series' payee default
    // category. A series whose account is outside the projected set covers nothing — the
    // engine drops its movements, and a budget must keep projecting alongside it.
    const coveredCategories = new Set<string>();
    for (const s of series) {
      if (s.status !== "confirmed" || s.direction !== "bill") continue;
      if (!projectedKeys.has(s.account)) continue;
      const payee = world.payees.find((p) => p.key === s.payee);
      if (payee !== undefined && payee.defaultCategory !== null) {
        coveredCategories.add(catKey(payee.defaultCategory));
      }
    }
    const moves = new Map<string, Map<string, number>>();
    const addMove = (accountKey: string, day: PlainDate, cents: number): void => {
      if (!projectedKeys.has(accountKey)) return;
      let byDay = moves.get(accountKey);
      if (byDay === undefined) {
        byDay = new Map();
        moves.set(accountKey, byDay);
      }
      byDay.set(iso(day), (byDay.get(iso(day)) ?? 0) + cents);
    };

    // Deposits: the viewer's own anchors, on each period's expected pay day (AD-25) from
    // tomorrow. Each deposit account's calendar also drives its period-close allocations.
    const calendars = new Map<string, PayCalendar>();
    for (const anchor of anchors) {
      if (anchor.person !== viewer || anchor.expectedNetCents === null) continue;
      const calendar = payCalendarOf(anchor);
      for (const period of calendar.periodsBetween(today, through.add({ days: 6 }))) {
        if (
          Temporal.PlainDate.compare(period.expectedPayDate, projectedFrom) >= 0 &&
          Temporal.PlainDate.compare(period.expectedPayDate, through) <= 0
        ) {
          addMove(anchor.account, period.expectedPayDate, anchor.expectedNetCents);
        }
      }
      if (!calendars.has(anchor.account)) calendars.set(anchor.account, calendar);
    }

    // Confirmed bill series rolled forward from `nextDueOn`.
    for (const s of series) {
      if (s.status !== "confirmed" || s.direction !== "bill") continue;
      const account = accountsByKey.get(s.account);
      if (account === undefined || !visibleTo(account, viewer)) continue;
      const nextDue = parseDate(s.nextDueOn);
      for (let i = 0; ; i++) {
        const due = seriesOccurrence(nextDue, i, s.cadence);
        if (Temporal.PlainDate.compare(due, through) > 0) break;
        if (Temporal.PlainDate.compare(due, projectedFrom) >= 0) {
          addMove(s.account, due, -s.expectedCents);
        }
      }
    }

    // Budget limits pro-rated daily across each pay-cycle period, charged to the budget's
    // funding account (default: the scope's deposit account). A category a confirmed series
    // already covers projects nothing. A shared budget needs a household pay anchor of
    // matching cadence; this household has none, so the shared groceries budget contributes
    // nothing.
    for (const budget of budgets) {
      if (budget.categoryGroup !== null) {
        throw new Error(`forecast mirror does not mirror group budgets: ${budget.key}`);
      }
      if (budget.category !== null && coveredCategories.has(catKey(budget.category))) continue;
      let scopeAnchor: PayAnchorCreatedEvent | undefined;
      if (budget.person !== null) {
        if (budget.person !== viewer) continue;
        scopeAnchor = anchors.find((a) => a.person === budget.person);
      } else {
        const householdPerson = world.household?.householdPayAnchorPersonId ?? null;
        const target = budget.cadence === "fortnight" ? "fortnightly" : "monthly";
        scopeAnchor = anchors.find((a) => a.person === householdPerson && a.cadence === target);
      }
      if (scopeAnchor === undefined) continue;
      const targetAccount = budget.fundingAccount ?? scopeAnchor.account;
      for (const period of payCalendarOf(scopeAnchor).periodsBetween(
        today.subtract({ days: 1 }),
        through,
      )) {
        const periodDays = period.end.since(period.start, { largestUnit: "days" }).days;
        if (periodDays <= 0) continue;
        const daily = Math.round(budget.limitCents / periodDays);
        const remainder = budget.limitCents - daily * periodDays;
        const lastDay = period.end.subtract({ days: 1 });
        for (let day = period.start; Temporal.PlainDate.compare(day, lastDay) <= 0; ) {
          if (
            Temporal.PlainDate.compare(day, projectedFrom) >= 0 &&
            Temporal.PlainDate.compare(day, through) <= 0
          ) {
            const onLastDay = Temporal.PlainDate.compare(day, lastDay) === 0;
            addMove(targetAccount, day, -(daily + (onLastDay ? remainder : 0)));
          }
          day = day.add({ days: 1 });
        }
      }
    }

    // Virtual goal allocations: each pay-period close debits the deposit account with the
    // active stage's shares of the period's projected positive savings — all base movements
    // landing there from the period's own expected pay day (a weekend-rolled deposit lands
    // before `start`, and belongs to the period it pays for) through the close, floored at 0 —
    // split largest-remainder (AD-13). The base is snapshotted so one period's debit never
    // shrinks a later period's savings.
    const allocationDebits: Record<string, { readonly date: string; readonly parts: number[] }[]> =
      {};
    for (const [accountKey, calendar] of calendars) {
      const base = [...(moves.get(accountKey)?.entries() ?? [])];
      const debits: { readonly date: string; readonly parts: number[] }[] = [];
      allocationDebits[accountKey] = debits;
      for (const period of calendar.periodsBetween(projectedFrom, through)) {
        const closeDay = period.end.subtract({ days: 1 });
        if (Temporal.PlainDate.compare(closeDay, projectedFrom) < 0) continue;
        if (Temporal.PlainDate.compare(closeDay, through) > 0) continue;
        const startIso = iso(period.expectedPayDate);
        const closeIso = iso(closeDay);
        const savings = Math.max(
          0,
          base.reduce(
            (sum, [day, cents]) => (day >= startIso && day <= closeIso ? sum + cents : sum),
            0,
          ),
        );
        if (savings <= 0) continue;
        // Mirrors the app's sweep arithmetic only — the rules' summed shareBp of the savings,
        // floored, then split largest-remainder — not the engine's completed-goal rescale or
        // exit-capacity caps.
        const totalShares = STAGE_ONE_SHARES.reduce((sum, share) => sum + share, 0);
        const toAllocate = Math.floor((savings * totalShares) / 10_000);
        if (toAllocate <= 0) continue;
        const parts = allocate(cents(toAllocate), STAGE_ONE_SHARES);
        for (const part of parts) addMove(accountKey, closeDay, -part);
        debits.push({ date: closeIso, parts: [...parts] });
      }
    }

    const dips: ForecastDip[] = [];
    for (const account of projected) {
      let balance = openingOf(account.key);
      const byDay = moves.get(account.key);
      const threshold = account.lowBalanceThresholdCents ?? 0;
      for (let day = today; Temporal.PlainDate.compare(day, through) <= 0; ) {
        balance += byDay?.get(iso(day)) ?? 0;
        if (balance < threshold) {
          dips.push({ account: account.key, cents: balance, dateOn: iso(day) });
          break;
        }
        day = day.add({ days: 1 });
      }
    }
    dips.sort((x, y) => (x.dateOn < y.dateOn ? -1 : x.dateOn > y.dateOn ? 1 : 0));
    warnings[viewer] = dips.map((d): Json => ({ ...d }));

    const day0: Record<string, number> = {};
    const byDayOut: Record<string, Record<string, number>> = {};
    for (const account of projected) {
      day0[account.key] = openingOf(account.key);
      byDayOut[account.key] = Object.fromEntries(moves.get(account.key) ?? []);
    }
    perViewer[viewer] = { day0, byDay: byDayOut, allocationDebits };
  }

  return { horizonMonths: 3, warnings, perViewer };
}
