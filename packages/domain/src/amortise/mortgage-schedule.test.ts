// `mortgageSchedule` — the pure monthly walk: interest on the offset-net balance rounded
// half-even, the constant repayment split interest-first, extras as principal-only. All
// figures hand-computed against the ticket's fixtures (cents).
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { type MortgageScheduleInput, mortgageSchedule } from "./mortgage-schedule.ts";

const d = parseDate;

const START = d("2026-01-15");

describe("mortgageSchedule", () => {
  it("matches the hand-computed base schedule cent for cent", () => {
    const result = mortgageSchedule({
      principalCents: 100_000,
      annualRatePercent: "12",
      monthlyRepaymentCents: 35_000,
      startDate: START,
    });
    expect(result.rows).toEqual([
      {
        month: 1,
        date: d("2026-01-15"),
        openingCents: 100_000,
        interestCents: 1_000,
        scheduledPrincipalCents: 34_000,
        extraPrincipalCents: 0,
        closingCents: 66_000,
      },
      {
        month: 2,
        date: d("2026-02-15"),
        openingCents: 66_000,
        interestCents: 660,
        scheduledPrincipalCents: 34_340,
        extraPrincipalCents: 0,
        closingCents: 31_660,
      },
      {
        // Final month: payment clamps to interest + remaining balance, principal never negative.
        month: 3,
        date: d("2026-03-15"),
        openingCents: 31_660,
        interestCents: 317, // 316.6 rounded to 317
        scheduledPrincipalCents: 31_660,
        extraPrincipalCents: 0,
        closingCents: 0,
      },
    ]);
    expect(result.totalInterestCents).toBe(1_977);
    expect(result.monthsToPayoff).toBe(3);
    expect(result.payoffDate).toEqual(d("2026-03-15"));
  });

  it("accrues interest on the offset-net balance, and none when the offset covers it", () => {
    // 12% p.a. on (opening − 40000): 60000 → 600, 25600 → 256, 0 (clamped) → 0.
    const result = mortgageSchedule({
      principalCents: 100_000,
      annualRatePercent: "12",
      monthlyRepaymentCents: 35_000,
      offsetCents: 40_000,
      startDate: START,
    });
    expect(
      result.rows.map((r) => [
        r.openingCents,
        r.interestCents,
        r.scheduledPrincipalCents,
        r.closingCents,
      ]),
    ).toEqual([
      [100_000, 600, 34_400, 65_600],
      [65_600, 256, 34_744, 30_856],
      [30_856, 0, 30_856, 0], // offset ≥ opening: interest 0, full repayment goes to principal
    ]);
    expect(result.totalInterestCents).toBe(856);
    expect(result.monthsToPayoff).toBe(3);
  });

  it("applies the extra repayment as principal the same month and shortens the term", () => {
    const withExtra = mortgageSchedule({
      principalCents: 100_000,
      annualRatePercent: "12",
      monthlyRepaymentCents: 35_000,
      extraRepaymentCents: 20_000,
      startDate: START,
    });
    expect(
      withExtra.rows.map((r) => [
        r.month,
        r.interestCents,
        r.scheduledPrincipalCents,
        r.extraPrincipalCents,
        r.closingCents,
      ]),
    ).toEqual([
      [1, 1_000, 34_000, 20_000, 46_000],
      [2, 460, 34_540, 11_460, 0], // final extra clamps to the 11460 the repayment left
    ]);
    expect(withExtra.totalInterestCents).toBe(1_460);
    expect(withExtra.monthsToPayoff).toBe(2);

    // Same loan, no extra: the extra shortens the term, it never cuts the nominal repayment.
    const withoutExtra = mortgageSchedule({
      principalCents: 100_000,
      annualRatePercent: "12",
      monthlyRepaymentCents: 35_000,
      startDate: START,
    });
    expect(withExtra.monthsToPayoff).toBeLessThan(withoutExtra.monthsToPayoff);
    expect(withExtra.rows[1]!.scheduledPrincipalCents + withExtra.rows[1]!.interestCents).toBe(
      35_000, // month 2 still pays the full nominal repayment
    );
  });

  it("rounds monthly interest half-even", () => {
    // Rate "6": 10100 × 6 ÷ 1200 = 50.5 → 50, and 10300 × 6 ÷ 1200 = 51.5 → 52.
    const tieDown = mortgageSchedule({
      principalCents: 10_100,
      annualRatePercent: "6",
      monthlyRepaymentCents: 1_000,
      startDate: START,
    });
    expect(tieDown.rows[0]!.interestCents).toBe(50);
    const tieUp = mortgageSchedule({
      principalCents: 10_300,
      annualRatePercent: "6",
      monthlyRepaymentCents: 1_000,
      startDate: START,
    });
    expect(tieUp.rows[0]!.interestCents).toBe(52);
  });

  it("normalises -0 offset/extra so no row field is -0", () => {
    // Math.min(-0, positive) returns -0, so an unnormalised -0 would leak into the rows.
    const result = mortgageSchedule({
      principalCents: 100_000,
      annualRatePercent: "12",
      monthlyRepaymentCents: 35_000,
      offsetCents: -0,
      extraRepaymentCents: -0,
      startDate: START,
    });
    expect(result.totalInterestCents).toBe(1_977); // identical to the same loan with no -0 inputs
    for (const row of result.rows) {
      for (const centsField of [
        row.openingCents,
        row.interestCents,
        row.scheduledPrincipalCents,
        row.extraPrincipalCents,
        row.closingCents,
      ]) {
        expect(Object.is(centsField, -0)).toBe(false);
      }
    }
  });

  it("throws when first-month interest reaches the repayment (non-amortising)", () => {
    // 100000 × 12 ÷ 1200 = 1000: interest equals or exceeds the repayment, so the walk
    // throws instead of looping — no partial result either way.
    const base = {
      principalCents: 100_000,
      annualRatePercent: "12",
      startDate: START,
    };
    expect(() => mortgageSchedule({ ...base, monthlyRepaymentCents: 1_000 })).toThrow(RangeError);
    expect(() => mortgageSchedule({ ...base, monthlyRepaymentCents: 900 })).toThrow(RangeError);
  });

  it("throws on a term that would run past the 1200-month guard", () => {
    // $200,000 at 12% with a $2,000.01 repayment: interest 200000 leaves 1 cent of monthly
    // principal, so the term runs ~1235 months.
    expect(() =>
      mortgageSchedule({
        principalCents: 20_000_000,
        annualRatePercent: "12",
        monthlyRepaymentCents: 200_001,
        startDate: START,
      }),
    ).toThrow(RangeError);
  });

  it("throws RangeError for every kind of bad number", () => {
    const valid: MortgageScheduleInput = {
      principalCents: 100_000,
      annualRatePercent: "12",
      monthlyRepaymentCents: 35_000,
      startDate: START,
    };
    const badInputs: ReadonlyArray<readonly [string, Partial<MortgageScheduleInput>]> = [
      ["zero principal", { principalCents: 0 }],
      ["negative principal", { principalCents: -100_000 }],
      ["non-integer principal", { principalCents: 100_000.5 }],
      ["unsafe-integer principal", { principalCents: 2 ** 53 }],
      ["zero repayment", { monthlyRepaymentCents: 0 }],
      ["negative repayment", { monthlyRepaymentCents: -35_000 }],
      ["non-integer repayment", { monthlyRepaymentCents: 35_000.5 }],
      ["negative offset", { offsetCents: -1 }],
      ["non-integer offset", { offsetCents: 0.5 }],
      ["negative extra", { extraRepaymentCents: -1 }],
      ["non-integer extra", { extraRepaymentCents: 0.5 }],
      ["empty rate", { annualRatePercent: "" }],
      ["non-numeric rate", { annualRatePercent: "six" }],
      ["rate with two dots", { annualRatePercent: "6.1.2" }],
      ["exponent-notation rate", { annualRatePercent: "1e2" }],
      ["negative rate", { annualRatePercent: "-6.175" }],
    ];
    for (const [label, override] of badInputs) {
      expect(() => mortgageSchedule({ ...valid, ...override }), label).toThrow(RangeError);
    }
  });
});
