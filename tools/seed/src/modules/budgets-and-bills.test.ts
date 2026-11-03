import { parseDate } from "@pangolin/shared/temporal";
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
    expect(budgetEvents).toHaveLength(3);
    expect(budgetEvents.map((e) => e.key)).toEqual([
      BUDGET_KEYS.sharedGroceries,
      BUDGET_KEYS.personalCoffeeA,
      BUDGET_KEYS.personalFitnessB,
    ]);

    const seriesEvents = events.filter((e) => e.type === "recurring-series.created");
    expect(seriesEvents).toHaveLength(3);
    expect(seriesEvents.map((e) => e.key)).toEqual([
      RECURRING_SERIES_KEYS.sydneyWater,
      RECURRING_SERIES_KEYS.telstra,
      RECURRING_SERIES_KEYS.netflix,
    ]);

    const ex = result.expectations as any;
    expect(ex["budgets-and-bills.payAnchors"]).toBeDefined();
    expect(ex["budgets-and-bills.groceriesBudget"]).toBeDefined();
    expect(ex["budgets-and-bills.recurringSeries"]).toBeDefined();

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
