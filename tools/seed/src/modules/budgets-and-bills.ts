import type { Json, SeedModule } from "../module.ts";
import type {
  BudgetCreatedEvent,
  PayAnchorCreatedEvent,
  RecurringSeriesCreatedEvent,
  SeedEvent,
  World,
} from "../world.ts";
import { ACCOUNT_KEYS, cat } from "./catalogue.ts";
import { PERSON_KEYS } from "./people-and-household.ts";

const [A, B] = PERSON_KEYS;

export const BUDGET_KEYS = {
  sharedGroceries: "budget-shared-groceries",
  personalCoffeeA: "budget-personal-coffee-a",
  personalFitnessB: "budget-personal-fitness-b",
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
      cadence: "fortnight",
      limitCents: 30_000,
      rollover: true,
    };

    // Personal Coffee budget for Person A: limit $20 ($20.00 / 2000 cents), rollover false
    const personalCoffeeBudgetA: BudgetCreatedEvent = {
      type: "budget.created",
      key: BUDGET_KEYS.personalCoffeeA,
      person: A,
      category: cat("Food", "Coffee"),
      categoryGroup: null,
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
      cadence: "fortnight",
      limitCents: 4_000,
      rollover: false,
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
      sharedGroceriesBudget,
      personalCoffeeBudgetA,
      personalFitnessBudgetB,
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

    return {
      events,
      expectations: {
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
