// `projectNetWorth` — the pure monthly net-worth walk: the pot starts at today's assets, each
// month adds savings + super then compounds at `annualReturnPercent ÷ 1200` half-even, and each
// point subtracts every loan's schedule balance (held flat without complete terms) plus the
// flat card liability. All figures hand-computed against the ticket's Design Notes fixture:
// loan 10_000_000 @"12" repay 350_000, savings 100_000/mo, super 0, assets 12_000_000, cards 0.
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import {
  NET_WORTH_PROJECTION_HORIZONS,
  type NetWorthLoanInput,
  type NetWorthProjectionInput,
  projectNetWorth,
} from "./forecast-networth.ts";

const d = parseDate;
const START = d("2026-01-15");

const LOAN: NetWorthLoanInput = {
  principalCents: 10_000_000,
  annualRatePercent: "12",
  monthlyRepaymentCents: 350_000,
  offsetCents: 0,
};

function input(overrides: Partial<NetWorthProjectionInput> = {}): NetWorthProjectionInput {
  return {
    startDate: START,
    horizonYears: 1,
    assetsCents: 12_000_000,
    creditCardCents: 0,
    loans: [LOAN],
    monthlySavingsCents: 100_000,
    monthlySuperCents: 0,
    annualReturnPercent: "0",
    ...overrides,
  };
}

describe("projectNetWorth", () => {
  it("matches the hand-computed Design Notes fixture cent for cent (zero return)", () => {
    const { points } = projectNetWorth(input({ horizonYears: 2 }));
    // 24 months + point 0.
    expect(points).toHaveLength(25);
    // Month 0 is today: pot 12_000_000 − loan 10_000_000.
    // Month 1: pot 12_100_000; loan interest 100_000, principal 250_000 → 9_750_000.
    // Month 2: pot 12_200_000; interest 97_500, principal 252_500 → 9_497_500.
    // Month 3: pot 12_300_000; interest 94_975, principal 255_025 → 9_242_475.
    expect(points.slice(0, 4).map((p) => [p.month, p.date.toString(), p.netWorthCents])).toEqual([
      [0, "2026-01-15", 2_000_000],
      [1, "2026-02-15", 2_350_000],
      [2, "2026-03-15", 2_702_500],
      [3, "2026-04-15", 3_057_525],
    ]);
  });

  it("compounds the pot at the return after the contributions (fixture at 12% p.a.)", () => {
    const { points } = projectNetWorth(input({ annualReturnPercent: "12", horizonYears: 2 }));
    // Month 1: (12_000_000 + 100_000) × 1.01 = 12_221_000 → 12_221_000 − 9_750_000.
    // Month 2: 12_321_000 × 1.01 = 12_444_210 → − 9_497_500.
    // Month 3: 12_544_210 × 1.01 = 12_669_652.10 → half-even 12_669_652 → − 9_242_475.
    expect(points.slice(0, 4).map((p) => p.netWorthCents)).toEqual([
      2_000_000, 2_471_000, 2_946_710, 3_427_177,
    ]);
  });

  it("keeps every point equal to today's figure for a defaults-style input", () => {
    // Zero contributions, zero return, no loans, no cards: the flat line at today's assets.
    const { points } = projectNetWorth(
      input({
        loans: [],
        monthlySavingsCents: 0,
        annualReturnPercent: "0",
        horizonYears: 2,
      }),
    );
    expect(points).toHaveLength(25);
    expect(points.every((p) => p.netWorthCents === 12_000_000)).toBe(true);
  });

  it("carries one point per month: 13 / 25 / 61 / 121 for the offered horizons", () => {
    for (const horizonYears of NET_WORTH_PROJECTION_HORIZONS) {
      const { points } = projectNetWorth(input({ horizonYears }));
      expect(points).toHaveLength(horizonYears * 12 + 1);
      expect(points[0]?.month).toBe(0);
      expect(points[points.length - 1]?.month).toBe(horizonYears * 12);
    }
  });

  it("dates each point `startDate + month` months, clamping short months", () => {
    const { points } = projectNetWorth(
      input({ startDate: d("2026-01-31"), annualReturnPercent: "0", monthlySavingsCents: 0 }),
    );
    expect(points[1]?.date.toString()).toBe("2026-02-28");
    expect(points[12]?.date.toString()).toBe("2027-01-31");
  });

  it("drives the loan balance to 0 at payoff and keeps it there", () => {
    // The fixture loan pays off in month 34 (350_000 repayments at 1% monthly): from month 34
    // on, the line is just the pot — 12_000_000 + 100_000 per month at a zero return.
    const { points } = projectNetWorth(input({ horizonYears: 5 }));
    for (let month = 34; month <= 60; month++) {
      expect(points[month]?.netWorthCents).toBe(12_000_000 + month * 100_000);
    }
    // Month 33 still carries the outstanding balance (strictly below the pot).
    expect(points[33]?.netWorthCents).toBeLessThan(12_000_000 + 33 * 100_000);
    // The payoff month jumps by more than the contribution: the balance cleared.
    expect(points[34]!.netWorthCents - points[33]!.netWorthCents).toBeGreaterThan(100_000);
  });

  it("nets the counted offset: the base pays off sooner and the line lands higher", () => {
    const shared = {
      assetsCents: 12_000_000,
      monthlySavingsCents: 0,
      annualReturnPercent: "0",
      horizonYears: 5,
    } as const;
    const withOffset = projectNetWorth(
      input({ ...shared, loans: [{ ...LOAN, offsetCents: 10_000_000 }] }),
    );
    const withoutOffset = projectNetWorth(input({ ...shared, loans: [LOAN] }));

    // Hand-computed month 1: the netted base accrues no interest, so month 1's principal is
    // the whole 350_000 repayment → 12_000_000 − 9_650_000 vs 12_000_000 − 9_750_000.
    expect(withOffset.points[1]?.netWorthCents).toBe(2_350_000);
    expect(withoutOffset.points[1]?.netWorthCents).toBe(2_250_000);

    // The offset loan is gone by month 29 (10_000_000 ÷ 350_000); the unnetted one is not.
    expect(withOffset.points[29]?.netWorthCents).toBe(12_000_000);
    expect(withoutOffset.points[29]!.netWorthCents).toBeLessThan(12_000_000);
    // Both are debt-free by month 34, and the counted line never sits below the other.
    expect(withOffset.points[34]?.netWorthCents).toBe(12_000_000);
    expect(
      withOffset.points.every(
        (p, i) => p.netWorthCents >= (withoutOffset.points[i]?.netWorthCents ?? 0),
      ),
    ).toBe(true);
  });

  it("holds loans with missing terms, unamortisable terms, and no balance flat", () => {
    const base = {
      assetsCents: 22_500_000,
      monthlySavingsCents: 0,
      monthlySuperCents: 0,
      annualReturnPercent: "0",
      horizonYears: 2,
    } as const;
    const { points } = projectNetWorth(
      input({
        ...base,
        loans: [
          // Rate but no repayment / repayment but no rate: no complete terms → flat.
          {
            principalCents: 5_000_000,
            annualRatePercent: "6",
            monthlyRepaymentCents: null,
            offsetCents: 0,
          },
          {
            principalCents: 7_000_000,
            annualRatePercent: null,
            monthlyRepaymentCents: 350_000,
            offsetCents: 0,
          },
          // Interest (200_000) reaches the repayment (100_000) → never amortises → flat.
          {
            principalCents: 10_000_000,
            annualRatePercent: "24",
            monthlyRepaymentCents: 100_000,
            offsetCents: 0,
          },
          // Paid off today (and in positive balance): stays at its value, nothing to amortise.
          {
            principalCents: 0,
            annualRatePercent: "6",
            monthlyRepaymentCents: 100_000,
            offsetCents: 0,
          },
          {
            principalCents: -250_000,
            annualRatePercent: "6",
            monthlyRepaymentCents: 100_000,
            offsetCents: 0,
          },
        ],
      }),
    );
    // All four balances stay at today's values: 22_500_000 − 5M − 7M − 10M + 250_000.
    expect(points.every((p) => p.netWorthCents === 750_000)).toBe(true);
  });

  it("subtracts the flat card liability, negative cards included", () => {
    const owed = projectNetWorth(
      input({ loans: [], creditCardCents: 250_000, monthlySavingsCents: 0 }),
    );
    expect(owed.points.every((p) => p.netWorthCents === 11_750_000)).toBe(true);
    // A card paid below zero is a credit: subtracting a negative owed amount lifts the line.
    const credit = projectNetWorth(
      input({ loans: [], creditCardCents: -5_000, monthlySavingsCents: 0 }),
    );
    expect(credit.points.every((p) => p.netWorthCents === 12_005_000)).toBe(true);
  });

  it("rounds the monthly compound half-even", () => {
    // 1% monthly would be `"12"`; 0.5% is `"6"`: ×1.005.
    const up = projectNetWorth(
      input({
        loans: [],
        assetsCents: 300,
        monthlySavingsCents: 0,
        annualReturnPercent: "6",
      }),
    );
    // 300 × 1.005 = 301.5 → half-even → 302; 302 × 1.005 = 303.51 → 304.
    expect(up.points.slice(0, 3).map((p) => p.netWorthCents)).toEqual([300, 302, 304]);
    const down = projectNetWorth(
      input({
        loans: [],
        assetsCents: 100,
        monthlySavingsCents: 0,
        annualReturnPercent: "6",
      }),
    );
    // 100 × 1.005 = 100.5 → half-even → 100: the pot never grows past its even neighbour.
    expect(down.points.slice(0, 3).map((p) => p.netWorthCents)).toEqual([100, 100, 100]);
  });

  it("orders lines by return alone: low ≤ mid ≤ high at every point", () => {
    const shared = { horizonYears: 10 } as const;
    const low = projectNetWorth(input({ ...shared, annualReturnPercent: "3" }));
    const mid = projectNetWorth(input({ ...shared, annualReturnPercent: "5" }));
    const high = projectNetWorth(input({ ...shared, annualReturnPercent: "7" }));
    expect(low.points).toHaveLength(121);
    // Strictly ordered from month 1 (the shared fixture pot is above zero all term); the
    // zeroth point is identical — the lines only differ once compounding starts.
    expect(low.points[0]?.netWorthCents).toBe(mid.points[0]?.netWorthCents);
    expect(
      low.points.every(
        (p, i) =>
          p.netWorthCents <= (mid.points[i]?.netWorthCents ?? 0) &&
          (mid.points[i]?.netWorthCents ?? 0) <= (high.points[i]?.netWorthCents ?? 0),
      ),
    ).toBe(true);
    expect(low.points[1]!.netWorthCents).toBeLessThan(mid.points[1]!.netWorthCents);
    expect(mid.points[1]!.netWorthCents).toBeLessThan(high.points[1]!.netWorthCents);
  });

  describe("rejects invalid input with RangeError", () => {
    it("horizons outside 1 / 2 / 5 / 10", () => {
      for (const horizonYears of [0, 3, 4, 11, 2.5, Number.NaN]) {
        expect(() => projectNetWorth(input({ horizonYears: horizonYears as never }))).toThrow(
          RangeError,
        );
      }
    });

    it("negative assets or contributions, and non-integer cents anywhere", () => {
      expect(() => projectNetWorth(input({ assetsCents: -1 }))).toThrow(RangeError);
      expect(() => projectNetWorth(input({ assetsCents: 1.5 }))).toThrow(RangeError);
      expect(() => projectNetWorth(input({ monthlySavingsCents: -1 }))).toThrow(RangeError);
      expect(() => projectNetWorth(input({ monthlySuperCents: -1 }))).toThrow(RangeError);
      expect(() => projectNetWorth(input({ creditCardCents: 1.5 }))).toThrow(RangeError);
      expect(() => projectNetWorth(input({ assetsCents: Number.MAX_SAFE_INTEGER + 10 }))).toThrow(
        RangeError,
      );
    });

    it("returns that are not plain non-negative decimal strings", () => {
      for (const annualReturnPercent of ["abc", "", "-5", "1e3", "+-5", "."]) {
        expect(() => projectNetWorth(input({ annualReturnPercent }))).toThrow(RangeError);
      }
      // A leading plus and decimal fractions are fine.
      expect(() => projectNetWorth(input({ annualReturnPercent: "+6.25" }))).not.toThrow();
    });

    it("loans with bad cents, bad rates or zero repayments", () => {
      const bad: NetWorthLoanInput[] = [
        {
          principalCents: 1.5,
          annualRatePercent: null,
          monthlyRepaymentCents: null,
          offsetCents: 0,
        },
        {
          principalCents: 1_000,
          annualRatePercent: null,
          monthlyRepaymentCents: null,
          offsetCents: -1,
        },
        {
          principalCents: 1_000,
          annualRatePercent: "-1",
          monthlyRepaymentCents: 100,
          offsetCents: 0,
        },
        {
          principalCents: 1_000,
          annualRatePercent: "7e2",
          monthlyRepaymentCents: 100,
          offsetCents: 0,
        },
        { principalCents: 1_000, annualRatePercent: "6", monthlyRepaymentCents: 0, offsetCents: 0 },
        {
          principalCents: 1_000,
          annualRatePercent: "6",
          monthlyRepaymentCents: 50.5,
          offsetCents: 0,
        },
      ];
      for (const loan of bad) {
        expect(() => projectNetWorth(input({ loans: [loan] }))).toThrow(RangeError);
      }
    });
  });
});
