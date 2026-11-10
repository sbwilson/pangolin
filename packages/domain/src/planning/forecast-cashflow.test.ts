// `projectCashFlow` — the pure balance walk: day by day from `from` through `through` (both
// inclusive), each day's signed movements added to the running balance, and the first day
// strictly below an account's threshold reported as its dip. All figures hand-computed.
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { projectCashFlow } from "./forecast-cashflow.ts";

const d = parseDate;

describe("projectCashFlow", () => {
  it("walks the daily series and reports the first dip below the threshold", () => {
    const result = projectCashFlow({
      from: d("2026-01-10"),
      through: d("2026-01-13"),
      accounts: [
        {
          accountId: "a",
          openingCents: 1_000,
          thresholdCents: 900,
          movements: [
            { date: d("2026-01-11"), cents: -150 },
            { date: d("2026-01-12"), cents: 50 },
            { date: d("2026-01-14"), cents: -100 }, // after `through`: ignored
            { date: d("2026-01-09"), cents: -20 }, // before `from`: ignored
          ],
        },
      ],
    });

    expect(result.accounts).toHaveLength(1);
    const points = result.accounts[0]!.points;
    expect(points.map((p) => [p.date.toString(), p.balanceCents])).toEqual([
      ["2026-01-10", 1_000],
      ["2026-01-11", 850],
      ["2026-01-12", 900],
      ["2026-01-13", 900],
    ]);
    // First dip: 01-11 at 850 — the only day below 900 — named once with cents and date.
    expect(result.warnings).toEqual([{ accountId: "a", cents: 850, date: d("2026-01-11") }]);
  });

  it("treats a balance equal to the threshold as not a dip", () => {
    const result = projectCashFlow({
      from: d("2026-01-10"),
      through: d("2026-01-12"),
      accounts: [
        {
          accountId: "a",
          openingCents: 1_000,
          thresholdCents: 900,
          movements: [{ date: d("2026-01-11"), cents: -100 }], // lands exactly on 900
        },
      ],
    });
    expect(result.warnings).toEqual([]);
    expect(result.accounts[0]!.points[1]!.balanceCents).toBe(900);
  });

  it("warns on day zero when the opening balance is already below the threshold", () => {
    const result = projectCashFlow({
      from: d("2026-01-10"),
      through: d("2026-01-11"),
      accounts: [{ accountId: "overdrawn", openingCents: -50, thresholdCents: 0, movements: [] }],
    });
    expect(result.warnings).toEqual([
      { accountId: "overdrawn", cents: -50, date: d("2026-01-10") },
    ]);
    expect(result.accounts[0]!.points.map((p) => p.balanceCents)).toEqual([-50, -50]);
  });

  it("sums several movements falling on one day, including the first day", () => {
    const result = projectCashFlow({
      from: d("2026-01-10"),
      through: d("2026-01-11"),
      accounts: [
        {
          accountId: "a",
          openingCents: 0,
          thresholdCents: 0,
          movements: [
            { date: d("2026-01-10"), cents: 700 },
            { date: d("2026-01-10"), cents: -400 },
            { date: d("2026-01-11"), cents: -600 },
          ],
        },
      ],
    });
    expect(result.accounts[0]!.points.map((p) => p.balanceCents)).toEqual([300, -300]);
    expect(result.warnings).toEqual([{ accountId: "a", cents: -300, date: d("2026-01-11") }]);
  });

  it("walks each account independently and warns in input order", () => {
    const result = projectCashFlow({
      from: d("2026-01-10"),
      through: d("2026-01-11"),
      accounts: [
        {
          accountId: "dips",
          openingCents: 100,
          thresholdCents: 200,
          movements: [{ date: d("2026-01-10"), cents: -10 }],
        },
        {
          accountId: "fine",
          openingCents: 10_000,
          thresholdCents: 200,
          movements: [],
        },
        {
          accountId: "also-dips",
          openingCents: 0,
          thresholdCents: 1,
          movements: [],
        },
      ],
    });
    expect(result.accounts.map((a) => a.accountId)).toEqual(["dips", "fine", "also-dips"]);
    expect(result.warnings.map((w) => w.accountId)).toEqual(["dips", "also-dips"]);
    expect(result.warnings[0]).toEqual({ accountId: "dips", cents: 90, date: d("2026-01-10") });
    expect(result.warnings[1]).toEqual({
      accountId: "also-dips",
      cents: 0,
      date: d("2026-01-10"),
    });
  });

  it("emits a single point when from equals through", () => {
    const result = projectCashFlow({
      from: d("2026-01-10"),
      through: d("2026-01-10"),
      accounts: [
        {
          accountId: "a",
          openingCents: 100,
          thresholdCents: 0,
          movements: [{ date: d("2026-01-10"), cents: 25 }],
        },
      ],
    });
    expect(result.accounts[0]!.points).toEqual([{ date: d("2026-01-10"), balanceCents: 125 }]);
  });

  it("rejects a window whose end precedes its start", () => {
    expect(() =>
      projectCashFlow({
        from: d("2026-01-11"),
        through: d("2026-01-10"),
        accounts: [],
      }),
    ).toThrow(RangeError);
  });
});
