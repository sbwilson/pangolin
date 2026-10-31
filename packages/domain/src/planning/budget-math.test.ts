import { cents } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { calculateBudgetMath, calculateLimitSuggestion, calculateRollover } from "./budget-math.ts";

describe("calculateBudgetMath", () => {
  const period = {
    start: parseDate("2026-10-01"),
    end: parseDate("2026-10-15"), // 14 days: Oct 1 through Oct 14
  };

  it("calculates pace and projection mid-period (day 7 of 14, spent $280, limit $600)", () => {
    const today = parseDate("2026-10-08"); // 7 days elapsed (Oct 1 to Oct 8)
    const result = calculateBudgetMath({
      period,
      today,
      limitCents: cents(60000), // $600
      spentCents: cents(28000), // $280
    });

    // Elapsed = 7, Total = 14. Pace fraction = 0.5.
    // Pace = $600 * 0.5 = $300 (30000 cents).
    expect(result.paceCents).toBe(30000);
    // Daily rate = $280 / 7 = $40/day. Remaining = 7 days.
    // Projected = $280 + $40 * 7 = $560 (56000 cents).
    expect(result.projectedCents).toBe(56000);
    // Effective limit = 60000.
    expect(result.effectiveLimitCents).toBe(60000);
    // Remaining = 60000 - 28000 = 32000.
    expect(result.remainingCents).toBe(32000);
    // Status: spent <= 600, projected <= 600 -> on-track.
    expect(result.status).toBe("on-track");
  });

  it("handles day 0 (start of period): elapsed = 0, projected = spent", () => {
    const today = parseDate("2026-10-01");
    const result = calculateBudgetMath({
      period,
      today,
      limitCents: cents(60000),
      spentCents: cents(5000),
    });

    expect(result.paceCents).toBe(0);
    expect(result.projectedCents).toBe(5000);
    expect(result.status).toBe("on-track");
  });

  it("identifies heading-over when projected exceeds limit", () => {
    const today = parseDate("2026-10-08"); // day 7 of 14
    const result = calculateBudgetMath({
      period,
      today,
      limitCents: cents(60000), // $600
      spentCents: cents(35000), // $350 in 7 days = $50/day. Projected = $700.
    });

    expect(result.paceCents).toBe(30000);
    expect(result.projectedCents).toBe(70000); // $700
    expect(result.status).toBe("heading-over");
  });

  it("identifies over-budget when spent exceeds limit", () => {
    const today = parseDate("2026-10-08");
    const result = calculateBudgetMath({
      period,
      today,
      limitCents: cents(60000),
      spentCents: cents(65000),
    });

    expect(result.status).toBe("over-budget");
    expect(result.remainingCents).toBe(-5000);
  });

  it("incorporates rollover into effective limit", () => {
    const today = parseDate("2026-10-08"); // 7/14 = 0.5
    const result = calculateBudgetMath({
      period,
      today,
      limitCents: cents(40000), // $400
      spentCents: cents(21000), // $210
      rolloverCents: cents(4000), // +$40 rolled over
    });

    // Effective limit = $440
    expect(result.effectiveLimitCents).toBe(44000);
    // Pace = $440 * 0.5 = $220
    expect(result.paceCents).toBe(22000);
    // Remaining = 44000 - 21000 = 23000
    expect(result.remainingCents).toBe(23000);
    // Daily rate = $210 / 7 = $30/day. Remaining 7 days * $30 = $210.
    // Projected = $210 + $210 = $420 <= $440 -> on-track
    expect(result.projectedCents).toBe(42000);
    expect(result.status).toBe("on-track");
  });

  it("handles negative rollover (overspent carryover)", () => {
    const today = parseDate("2026-10-08");
    const result = calculateBudgetMath({
      period,
      today,
      limitCents: cents(40000), // $400
      spentCents: cents(20000), // $200
      rolloverCents: cents(-5000), // -$50 overspent from prior period
    });

    // Effective limit = $350
    expect(result.effectiveLimitCents).toBe(35000);
    // Pace = $350 * 0.5 = $175
    expect(result.paceCents).toBe(17500);
    expect(result.remainingCents).toBe(15000);
  });
});

describe("calculateRollover", () => {
  it("returns 0 if rollover is disabled", () => {
    expect(calculateRollover(false, cents(40000), cents(36000))).toBe(0);
  });

  it("returns positive difference if unspent and enabled", () => {
    // limit 400, spent 360 -> +40
    expect(calculateRollover(true, cents(40000), cents(36000))).toBe(4000);
  });

  it("returns negative difference if overspent and enabled", () => {
    // limit 400, spent 450 -> -50
    expect(calculateRollover(true, cents(40000), cents(45000))).toBe(-5000);
  });
});

describe("calculateLimitSuggestion", () => {
  it("calculates mean over last 6 closed periods with half-even rounding", () => {
    // Spent over last 6 closed fortnights: $200, $220, $210, $190, $200, $240
    // Total = $1260 / 6 = $210
    const history = [
      cents(20000),
      cents(22000),
      cents(21000),
      cents(19000),
      cents(20000),
      cents(24000),
    ];
    expect(calculateLimitSuggestion(history)).toBe(21000);
  });

  it("only takes the last 6 periods if more than 6 are provided", () => {
    const history = [
      cents(99999), // older period, should be ignored
      cents(20000),
      cents(22000),
      cents(21000),
      cents(19000),
      cents(20000),
      cents(24000),
    ];
    expect(calculateLimitSuggestion(history)).toBe(21000);
  });

  it("returns null if fewer than 6 closed periods are provided", () => {
    const history = [cents(20000), cents(22000), cents(21000)];
    expect(calculateLimitSuggestion(history)).toBeNull();
  });

  it("returns null for empty history", () => {
    expect(calculateLimitSuggestion([])).toBeNull();
  });
});
