// `planning.forecastNetWorth` — the three-line net-worth projection use case on the memory uow.
// Every matrix row: defaults flat at today's net worth, horizons 1/2/5/10 (and a 400-worthy
// `horizon=3`), savings/super shares of pay-anchor income, selected loans amortising on their
// stored terms (offset pool netted when `countOffset`), termless and closed loans flat, the
// bps→decimal-string-percent boundary, assumption changes moving the affected lines, person
// isolation, and the person-only guard. Hand-computed against: everyday 3_000_000, offset
// 1_000_000, card −250_000, loan-1 −10_000_000, so today's net worth is −6_250_000.
import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import type { AppError } from "../errors.ts";
import type { AccountRow, BalanceSnapshotRow } from "../ports/unit-of-work.ts";
import { netWorth } from "../reports/net-worth.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { upsertForecastAssumptions } from "./forecast-assumptions.ts";
import { forecastNetWorth } from "./forecast-networth.ts";

const STAMP = "2026-01-15T09:00:00Z";
const TODAY = "2026-01-15";

/** Today's net worth for A on the setup below: 3M + 1M − 250k − 10M. */
const A_NET_WORTH = -6_250_000;

function account(id: string, type: AccountRow["type"], closedOn: string | null = null): AccountRow {
  return {
    id: id as Id<"Account">,
    name: id,
    type,
    currency: "AUD",
    isPrivate: false,
    institutionId: null,
    openedOn: "2026-01-01",
    closedOn,
    isSavings: false,
    lowBalanceThresholdCents: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function snapshot(accountId: string, balanceCents: number, asOf = TODAY): BalanceSnapshotRow {
  return {
    id: `snap-${accountId}` as Id<"BalanceSnapshot">,
    accountId: accountId as Id<"Account">,
    asOf,
    balanceCents,
    source: "manual",
    importBatchId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function setup() {
  const clock = manualClock("2026-01-15T10:00:00Z");
  const { ctx, uow } = memoryContext(systemViewer("cli:test"), clock);
  const a = "person-a" as Id<"Person">;
  const b = "person-b" as Id<"Person">;
  uow.state.people = [
    {
      id: a,
      displayName: "Alex",
      colour: "#2563eb",
      createdAt: STAMP,
      updatedAt: STAMP,
      deletedAt: null,
      userId: "user-a",
    },
    {
      id: b,
      displayName: "Sam",
      colour: "#9c4277",
      createdAt: STAMP,
      updatedAt: STAMP,
      deletedAt: null,
      userId: "user-b",
    },
  ];
  // Joint household accounts A and B both see; a closed joint loan; and B's private loan,
  // invisible to A. Balances: see `A_NET_WORTH`.
  uow.state.accounts = [
    account("everyday", "transaction"),
    account("offset", "offset"),
    account("card", "credit_card"),
    account("loan-1", "home_loan"),
    account("loan-closed", "home_loan", "2025-12-01"),
    { ...account("loan-b-private", "home_loan"), isPrivate: true },
  ];
  const joint = ["everyday", "offset", "card", "loan-1", "loan-closed"];
  uow.state.accountOwners = [
    ...joint.map((accountId) => ({
      accountId: accountId as Id<"Account">,
      personId: a,
      shareBp: 5000,
      createdAt: STAMP,
      updatedAt: STAMP,
    })),
    ...joint.map((accountId) => ({
      accountId: accountId as Id<"Account">,
      personId: b,
      shareBp: 5000,
      createdAt: STAMP,
      updatedAt: STAMP,
    })),
    {
      accountId: "loan-b-private" as Id<"Account">,
      personId: b,
      shareBp: 10_000,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  uow.state.balanceSnapshots = [
    snapshot("everyday", 3_000_000),
    snapshot("offset", 1_000_000),
    snapshot("card", -250_000),
    snapshot("loan-1", -10_000_000),
    snapshot("loan-closed", -5_000_000),
    snapshot("loan-b-private", -7_000_000),
  ];
  // A's own monthly pay anchor (1_200_000 net): monthly income 1_200_000 for contributions.
  uow.state.payAnchors = [
    {
      id: "anchor-a" as Id<"PayAnchor">,
      personId: a,
      accountId: "everyday" as Id<"Account">,
      cadence: "monthly",
      dayOfMonth: 25,
      anchorDate: "2026-01-25",
      alignment: "calendar",
      expectedNetCents: 1_200_000,
      expectedGrossCents: 1_600_000,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  return {
    ctx,
    uow,
    clock,
    a,
    b,
    viewerA: { ...ctx, viewer: personViewer(a, clock.now()) },
    viewerB: { ...ctx, viewer: personViewer(b, clock.now()) },
  };
}

/** The loan terms every mortgage test uses unless it says otherwise: 12% p.a., $3,500/mo. */
const TERMS = { annualRatePercent: "12", monthlyRepaymentCents: 350_000 };

function expectError(fn: () => unknown, code: "Validation" | "Unauthenticated"): void {
  try {
    fn();
    throw new Error(`expected an AppError with code ${code}, but nothing was thrown`);
  } catch (err) {
    expect((err as AppError).code).toBe(code);
  }
}

describe("planning.forecastNetWorth", () => {
  it("answers defaults with flat lines at today's net worth over 25 monthly points", () => {
    const { viewerA } = setup();
    const report = forecastNetWorth(viewerA);
    expect(report.asOf).toBe(TODAY);
    expect(report.horizonYears).toBe(2);
    const { low, mid, high } = report.lines;
    expect(low).toEqual({ returnBps: 0, annualReturnPercent: "0", points: low.points });
    for (const line of [low, mid, high]) {
      expect(line.points).toHaveLength(25);
      expect(line.points[0]).toEqual({ month: 0, date: TODAY, netWorthCents: A_NET_WORTH });
      expect(line.points.every((p) => p.netWorthCents === A_NET_WORTH)).toBe(true);
    }
    // Point 0 is exactly today's `netWorth()` figure.
    expect(low.points[0]?.netWorthCents).toBe(netWorth(viewerA).netWorthCents);
  });

  it("keeps point 0 at today's net worth when a visible asset account is overdrawn", () => {
    const { uow, viewerA } = setup();
    // Balances carry no sign CHECK: everyday goes below zero, dragging visible assets to −1M.
    uow.state.balanceSnapshots = uow.state.balanceSnapshots.map((s) =>
      s.accountId === ("everyday" as Id<"Account">) ? { ...s, balanceCents: -2_000_000 } : s,
    );
    const today = netWorth(viewerA);
    expect(today.assetsCents).toBe(-1_000_000);
    const report = forecastNetWorth(viewerA);
    // The compounded pot floors at 0 and the 1_000_000 excess rides the flat deduction:
    // 0 − 10_000_000 − (250_000 + 1_000_000) — exactly today's net worth, flat all horizon.
    for (const line of [report.lines.low, report.lines.mid, report.lines.high]) {
      expect(line.points[0]?.netWorthCents).toBe(today.netWorthCents);
      expect(line.points.every((p) => p.netWorthCents === today.netWorthCents)).toBe(true);
    }
  });

  it("takes 13 / 25 / 61 / 121 points for horizons 1 / 2 / 5 / 10 (string or number)", () => {
    const { viewerA } = setup();
    for (const [horizon, months] of [
      [1, 12],
      ["1", 12],
      [2, 24],
      [5, 60],
      ["10", 120],
    ] as const) {
      const report = forecastNetWorth(viewerA, { horizon });
      expect(report.horizonYears).toBe(Number(horizon));
      expect(report.lines.low.points).toHaveLength(months + 1);
      expect(report.lines.low.points[months]?.month).toBe(months);
    }
  });

  it("rejects any horizon outside 1 / 2 / 5 / 10 with Validation", () => {
    const { viewerA } = setup();
    for (const horizon of ["3", 3, 0, 11, 2.5, "abc", ""]) {
      expectError(() => forecastNetWorth(viewerA, { horizon }), "Validation");
    }
  });

  it("throws Unauthenticated for a non-person viewer", () => {
    const { ctx } = setup();
    expectError(() => forecastNetWorth(ctx), "Unauthenticated");
  });

  it("walks savings, super, the compound and an amortising loan cent for cent", () => {
    const { viewerA } = setup();
    // Monthly income 1_200_000 → savings 10% = 120_000, super 5% = 60_000.
    upsertForecastAssumptions(viewerA, {
      savingsRateBps: 1000,
      superRateBps: 500,
      returnMidBps: 1200,
      returnHighBps: 1800,
      mortgages: [{ accountId: "loan-1", countOffset: true, ...TERMS }],
    });
    const report = forecastNetWorth(viewerA);
    expect(report.lines.mid.returnBps).toBe(1200);
    expect(report.lines.mid.annualReturnPercent).toBe("12");

    // Month 1: pot 4_000_000 + 180_000 = 4_180_000, ×1.01 = 4_221_800; the loan's interest
    // base nets the 1_000_000 offset pool: interest 90_000, principal 260_000 → 9_740_000.
    const mid1 = report.lines.mid.points[1]?.netWorthCents;
    expect(mid1).toBe(4_221_800 - 9_740_000 - 250_000); // −5_768_200
    // The low line (0%) shares everything but the compound: 4_180_000 − 9_740_000 − 250_000.
    expect(report.lines.low.points[1]?.netWorthCents).toBe(-5_810_000);
    // low ≤ mid ≤ high at every point, and the loan's paydown lifts the line above the pot-free
    // flat month 0 figure every month.
    for (let m = 0; m <= 24; m++) {
      const low = report.lines.low.points[m]!.netWorthCents;
      const mid = report.lines.mid.points[m]!.netWorthCents;
      const high = report.lines.high.points[m]!.netWorthCents;
      expect(low).toBeLessThanOrEqual(mid);
      expect(mid).toBeLessThanOrEqual(high);
      expect(mid).toBeGreaterThanOrEqual(A_NET_WORTH);
    }
  });

  it("nets the whole open-offset pool only for countOffset loans (the matrix row)", () => {
    const netted = setup();
    const flat = setup();
    for (const { viewer, countOffset } of [
      { viewer: netted.viewerA, countOffset: true },
      { viewer: flat.viewerA, countOffset: false },
    ]) {
      upsertForecastAssumptions(viewer, {
        mortgages: [{ accountId: "loan-1", countOffset, ...TERMS }],
      });
    }
    // Same everything (no contributions, zero returns): the netted loan accrues 90_000
    // interest against the unnetted 100_000, so month 1's balances — and lines — differ:
    // 4_000_000 − 9_740_000 − 250_000 netted, 4_000_000 − 9_750_000 − 250_000 unnetted.
    expect(forecastNetWorth(netted.viewerA).lines.low.points[1]?.netWorthCents).toBe(-5_990_000);
    expect(forecastNetWorth(flat.viewerA).lines.low.points[1]?.netWorthCents).toBe(-6_000_000);
    // ...and the netted line stays at or above across the horizon (faster payoff).
    const nettedLine = forecastNetWorth(netted.viewerA).lines.low.points;
    const flatLine = forecastNetWorth(flat.viewerA).lines.low.points;
    expect(nettedLine.every((p, i) => p.netWorthCents >= flatLine[i]!.netWorthCents)).toBe(true);
  });

  it("annualises fortnightly income (×26 ÷ 12) half-even into each contribution", () => {
    const { uow, viewerA } = setup();
    uow.state.payAnchors = [
      {
        id: "anchor-a" as Id<"PayAnchor">,
        personId: viewerA.viewer.personId,
        accountId: "everyday" as Id<"Account">,
        cadence: "fortnightly",
        dayOfMonth: null,
        anchorDate: "2026-01-02",
        alignment: "calendar",
        expectedNetCents: 385_000,
        expectedGrossCents: 520_000,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    ];
    upsertForecastAssumptions(viewerA, { savingsRateBps: 4500, superRateBps: 1200 });
    // Annual 385_000 × 26 = 10_010_000 → monthly 834_166⅔ → savings 375_375, super 100_100.
    // Zero returns and no selected loans: every month adds exactly 475_475.
    const line = forecastNetWorth(viewerA).lines.low.points;
    expect(line[1]?.netWorthCents).toBe(A_NET_WORTH + 475_475);
    expect(line[12]?.netWorthCents).toBe(A_NET_WORTH + 12 * 475_475);
  });

  it("contributes nothing without a pay anchor while returns still move the lines", () => {
    const { uow, viewerA } = setup();
    uow.state.payAnchors = [];
    upsertForecastAssumptions(viewerA, { savingsRateBps: 4500, returnMidBps: 1200 });
    const report = forecastNetWorth(viewerA);
    // No savings/super: month 1 moves only by the compound on the untouched pot.
    expect(report.lines.low.points[1]?.netWorthCents).toBe(A_NET_WORTH);
    expect(report.lines.mid.points[1]?.netWorthCents).toBe(
      // pot 4_000_000 × 1.01 = 4_040_000 − flat loan 10_000_000 − cards 250_000.
      4_040_000 - 10_000_000 - 250_000,
    );
  });

  it("holds termless loans flat and closed loans out of the projection entirely", () => {
    const { viewerA } = setup();
    // Terms on the closed loan, no terms on the open one: neither amortises.
    upsertForecastAssumptions(viewerA, {
      mortgages: [
        { accountId: "loan-1", countOffset: true },
        { accountId: "loan-closed", countOffset: false, ...TERMS },
      ],
    });
    const line = forecastNetWorth(viewerA).lines.low.points;
    // Loan balances stay at today's values; the closed loan is not part of today either.
    expect(line.every((p) => p.netWorthCents === A_NET_WORTH)).toBe(true);
  });

  it("moves the affected line when a stored assumption changes", () => {
    const { viewerA } = setup();
    const first = forecastNetWorth(viewerA);
    expect(first.lines.mid.points[1]?.netWorthCents).toBe(A_NET_WORTH);

    // Savings lift all three lines; super lifts them further.
    upsertForecastAssumptions(viewerA, { savingsRateBps: 1000 });
    const withSavings = forecastNetWorth(viewerA);
    expect(withSavings.lines.mid.points[1]!.netWorthCents).toBeGreaterThan(A_NET_WORTH);
    upsertForecastAssumptions(viewerA, { superRateBps: 500 });
    const withSuper = forecastNetWorth(viewerA);
    expect(withSuper.lines.mid.points[1]!.netWorthCents).toBeGreaterThan(
      withSavings.lines.mid.points[1]!.netWorthCents,
    );

    // The mid return moves mid alone.
    upsertForecastAssumptions(viewerA, { returnMidBps: 617 });
    const withReturn = forecastNetWorth(viewerA);
    expect(withReturn.lines.mid.annualReturnPercent).toBe("6.17");
    expect(withReturn.lines.mid.points[1]!.netWorthCents).toBeGreaterThan(
      withSuper.lines.mid.points[1]!.netWorthCents,
    );
    expect(withReturn.lines.low.points[1]).toEqual(withSuper.lines.low.points[1]);

    // Selecting the loan with terms pays it down: the line lifts by month 1; clearing the
    // terms flattens it again.
    upsertForecastAssumptions(viewerA, {
      mortgages: [{ accountId: "loan-1", countOffset: false, ...TERMS }],
    });
    const withLoan = forecastNetWorth(viewerA);
    expect(withLoan.lines.low.points[1]!.netWorthCents).toBeGreaterThan(
      withReturn.lines.low.points[1]!.netWorthCents,
    );
    upsertForecastAssumptions(viewerA, {
      mortgages: [{ accountId: "loan-1", countOffset: false }],
    });
    const termless = forecastNetWorth(viewerA);
    expect(termless.lines.low.points[1]?.netWorthCents).toBe(
      withReturn.lines.low.points[1]?.netWorthCents,
    );

    // Toggling countOffset changes the line again.
    upsertForecastAssumptions(viewerA, {
      mortgages: [{ accountId: "loan-1", countOffset: true, ...TERMS }],
    });
    expect(forecastNetWorth(viewerA).lines.low.points[1]!.netWorthCents).toBeGreaterThan(
      termless.lines.low.points[1]!.netWorthCents,
    );
  });

  it("keeps each person's own accounts and assumptions behind their own lines", () => {
    const { viewerA, viewerB } = setup();
    // B sees the private loan too: B's point 0 is B's net worth, not A's.
    const reportB = forecastNetWorth(viewerB);
    expect(reportB.lines.low.points[0]?.netWorthCents).toBe(netWorth(viewerB).netWorthCents);
    expect(reportB.lines.low.points[0]!.netWorthCents).toBeLessThan(A_NET_WORTH);

    // A's private-view figures are untouched by B's assumptions or B's private loan.
    const beforeA = forecastNetWorth(viewerA);
    upsertForecastAssumptions(viewerB, {
      savingsRateBps: 4500,
      returnMidBps: 700,
      mortgages: [{ accountId: "loan-b-private", countOffset: true, ...TERMS }],
    });
    const afterA = forecastNetWorth(viewerA);
    expect(afterA).toEqual(beforeA);

    // ...and B's own line moved while A's stayed flat.
    const movedB = forecastNetWorth(viewerB);
    expect(movedB.lines.mid.points[1]!.netWorthCents).toBeGreaterThan(
      reportB.lines.mid.points[1]!.netWorthCents,
    );
  });

  it("writes nothing: the query is read-only", () => {
    const { uow, viewerA } = setup();
    forecastNetWorth(viewerA);
    forecastNetWorth(viewerA, { horizon: 10 });
    expect(uow.state.forecastAssumptions).toEqual([]);
    expect(uow.state.forecastAssumptionMortgages).toEqual([]);
    expect(uow.state.audit).toEqual([]);
  });
});
