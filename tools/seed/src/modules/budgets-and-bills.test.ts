import { describe, expect, it } from "vitest";
import { runSeed } from "../run.ts";
import { BUDGET_KEYS, PAY_ANCHOR_KEYS, RECURRING_SERIES_KEYS } from "./budgets-and-bills.ts";
import { defaultModules } from "./index.ts";

describe("budgetsAndBills module", () => {
  it("emits pay anchors, budgets, and recurring series that fold cleanly into the world", () => {
    const result = runSeed({
      seed: "default",
      today: "2026-07-15",
      modules: defaultModules,
      profile: "default",
    });

    const events = result.events;
    const paEvents = events.filter((e) => e.type === "pay-anchor.created");
    expect(paEvents).toHaveLength(2);
    expect(paEvents.map((e) => e.key)).toEqual([PAY_ANCHOR_KEYS.personA, PAY_ANCHOR_KEYS.personB]);

    const budgetEvents = events.filter((e) => e.type === "budget.created");
    expect(budgetEvents).toHaveLength(4);
    expect(budgetEvents.map((e) => e.key)).toEqual([
      BUDGET_KEYS.sharedGroceries,
      BUDGET_KEYS.personalCoffeeA,
      BUDGET_KEYS.personalFitnessB,
      BUDGET_KEYS.personalMobileA,
    ]);

    const seriesEvents = events.filter((e) => e.type === "recurring-series.created");
    expect(seriesEvents).toHaveLength(3);
    expect(seriesEvents.map((e) => e.key)).toEqual([
      RECURRING_SERIES_KEYS.sydneyWater,
      RECURRING_SERIES_KEYS.telstra,
      RECURRING_SERIES_KEYS.netflix,
    ]);

    // Forecast assumptions: one `forecast-assumption.set` per person, each selecting the
    // household home loan with its offset counted.
    const assumptionEvents = events.filter((e) => e.type === "forecast-assumption.set");
    expect(assumptionEvents).toHaveLength(2);
    expect(assumptionEvents.map((e) => (e as any).person)).toEqual(["person-a", "person-b"]);

    const ex = result.expectations as any;
    expect(ex["budgets-and-bills.payAnchors"]).toBeDefined();
    expect(ex["budgets-and-bills.groceriesBudget"]).toBeDefined();
    expect(ex["budgets-and-bills.recurringSeries"]).toBeDefined();

    const assumptions = ex["budgets-and-bills.forecastAssumptions"];
    expect(assumptions.personA.savingsRateBps).toBe(4_500);
    expect(assumptions.personA.mortgages).toEqual([
      { account: "joint-home-loan", countOffset: true },
    ]);
    expect(assumptions.personB.returnLowBps).toBe(300);
    expect(assumptions.personB.returnMidBps).toBe(500);
    expect(assumptions.personB.returnHighBps).toBe(700);
    expect(assumptions.personB.superRateBps).toBe(1_200);

    // The coffee budget carries a funding account; the mobile budget targets the Telstra
    // payee's default category so the forecast covers (and excludes) it.
    const byKey = new Map(budgetEvents.map((e) => [e.key, e as any]));
    expect(byKey.get(BUDGET_KEYS.personalCoffeeA)?.fundingAccount).toBe("person-a-private");
    expect(byKey.get(BUDGET_KEYS.personalFitnessB)?.category).toEqual({
      group: "Health",
      name: "Fitness",
    });
    expect(byKey.get(BUDGET_KEYS.personalMobileA)?.category).toEqual({
      group: "Utilities",
      name: "Mobile",
    });

    // The forecast mirror carries day 0 balances, per-day movements and allocation debits.
    const forecast = ex["budgets-and-bills.forecast"];
    expect(forecast.horizonMonths).toBe(3);
    for (const viewer of ["person-a", "person-b"]) {
      expect(Object.keys(forecast.perViewer[viewer].day0)).toContain("joint-everyday");
      expect(forecast.perViewer[viewer].byDay["joint-everyday"]).toBeTypeOf("object");
      expect(Array.isArray(forecast.perViewer[viewer].allocationDebits["joint-everyday"])).toBe(
        true,
      );
    }

    const groceries = ex["budgets-and-bills.groceriesBudget"];
    expect(groceries.limitCents).toBe(30_000);
    expect(groceries.currentPeriodStart).toBe("2026-07-03");
    expect(groceries.currentPeriodEnd).toBe("2026-07-17");
    expect(groceries.currentSpentCents).toBeGreaterThan(0);
    expect(groceries.priorSpentCents).toBeGreaterThan(0);
    expect(groceries.suggestedLimitCents).toBeGreaterThan(0);
    expect(groceries.closed6Periods).toHaveLength(6);
  });
});
