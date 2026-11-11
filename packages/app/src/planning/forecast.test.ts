// `planning.forecastCashFlow` — per-viewer daily projection from the clock's today, with
// first-dip warnings. Fixtures pin: deposits on rolled pay days (AD-25, never series), confirmed
// `bill` series only rolled by cadence (monthly day 29-31 clamps), budget limits pro-rated daily
// with the remainder on the period's last day charged to the scope's deposit account, shared
// budgets without a household anchor contributing nothing, unknown horizons defaulting to 3, and
// private accounts visible only to their owner.
import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { type MemoryUnitOfWork, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import { FORECAST_HORIZONS, forecastCashFlow, parseForecastHorizon } from "./forecast.ts";

const TODAY = "2026-01-15"; // Thursday; horizon 3 ends 2026-04-15.

function fixedClock() {
  return {
    today: () => parseDate(TODAY),
    now: () => parseDate(TODAY).toZonedDateTime("Australia/Sydney").toInstant(),
  };
}

const STAMP = "2026-01-01T00:00:00Z";

function baseUow(): MemoryUnitOfWork {
  const uow = memoryUnitOfWork();
  uow.state.people = ["person-a", "person-b"].map((id, i) => ({
    id: id as Id<"Person">,
    displayName: `Person ${id.slice(-1).toUpperCase()}`,
    colour: `#0${i}0000`,
    createdAt: STAMP,
    updatedAt: STAMP,
    deletedAt: null,
    userId: `user-${id.slice(-1)}`,
  }));
  uow.state.accounts = [
    {
      id: "acc-main" as Id<"Account">,
      name: "Main",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "acc-priv-a" as Id<"Account">,
      name: "A Secret",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "acc-savings" as Id<"Account">,
      name: "Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: null,
      isSavings: true,
      lowBalanceThresholdCents: 0,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  uow.state.accountOwners = [
    {
      accountId: "acc-priv-a" as Id<"Account">,
      personId: "person-a" as Id<"Person">,
      shareBp: 10_000,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  uow.state.balanceSnapshots = [
    {
      id: "s-1" as Id<"BalanceSnapshot">,
      accountId: "acc-main" as Id<"Account">,
      asOf: TODAY,
      balanceCents: 1_000,
      source: "manual",
      importBatchId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "s-2" as Id<"BalanceSnapshot">,
      accountId: "acc-priv-a" as Id<"Account">,
      asOf: TODAY,
      balanceCents: 1_000,
      source: "manual",
      importBatchId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: "s-3" as Id<"BalanceSnapshot">,
      accountId: "acc-savings" as Id<"Account">,
      asOf: TODAY,
      balanceCents: 50_000,
      source: "manual",
      importBatchId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  return uow;
}

function ctxFor(uow: MemoryUnitOfWork, personId: string): UseCaseContext {
  return {
    viewer: personViewer(personId as Id<"Person">, fixedClock().now()),
    clock: fixedClock(),
    newId: () => "x" as never,
    uow,
  };
}

/** Anchor paid net `cents` fortnightly from Thu 2026-01-01 (calendar alignment) into `acc-main`. */
function fortnightlyAnchor(uow: MemoryUnitOfWork, personId: string, cents: number | null): void {
  uow.state.payAnchors.push({
    id: `anchor-${personId}` as Id<"PayAnchor">,
    personId: personId as Id<"Person">,
    accountId: "acc-main" as Id<"Account">,
    cadence: "fortnightly",
    dayOfMonth: null,
    anchorDate: "2026-01-01",
    alignment: "calendar",
    expectedNetCents: cents,
    expectedGrossCents: cents === null ? null : cents + 50,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
}

/** Day-by-day balance deltas of one account's series. */
function deltas(
  report: ReturnType<typeof forecastCashFlow>,
  accountId: string,
): Map<string, number> {
  const account = report.accounts.find((a) => a.accountId === accountId);
  expect(account).toBeDefined();
  const points = account!.points;
  const out = new Map<string, number>();
  for (let i = 0; i < points.length; i++) {
    const delta =
      i === 0
        ? points[i]!.balanceCents - 1_000
        : points[i]!.balanceCents - points[i - 1]!.balanceCents;
    out.set(points[i]!.date, delta);
  }
  return out;
}

describe("parseForecastHorizon", () => {
  it("accepts 3, 6, 12 as number or string and defaults everything else to 3", () => {
    for (const h of FORECAST_HORIZONS) {
      expect(parseForecastHorizon(h)).toBe(h);
      expect(parseForecastHorizon(String(h))).toBe(h);
    }
    expect(parseForecastHorizon(undefined)).toBe(3);
    expect(parseForecastHorizon("")).toBe(3);
    expect(parseForecastHorizon("bogus")).toBe(3);
    expect(parseForecastHorizon(4)).toBe(3);
    expect(parseForecastHorizon("4")).toBe(3);
  });
});

describe("forecastCashFlow", () => {
  it("projects a daily series per visible transaction account and warns on the first dip", () => {
    const uow = baseUow();
    // acc-main threshold 500; opens at 1,000 (below threshold only after bills bite).
    uow.state.accounts = uow.state.accounts.map((a) =>
      a.id === "acc-main" ? { ...a, lowBalanceThresholdCents: 500 } : a,
    );
    fortnightlyAnchor(uow, "person-a", 100); // pays 01-15, 01-29, 02-12, ...
    uow.state.recurringSeries.push({
      id: "ser-weekly" as Id<"RecurringSeries">,
      accountId: "acc-main" as Id<"Account">,
      payeeId: "payee-1" as Id<"Payee">,
      direction: "bill",
      cadence: "weekly",
      expectedCents: 400,
      toleranceBp: 1000,
      nextDueOn: "2026-01-15",
      status: "confirmed",
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    const report = forecastCashFlow(ctxFor(uow, "person-a"));
    expect(report.from).toBe(TODAY);
    expect(report.through).toBe("2026-04-15");
    expect(report.horizonMonths).toBe(3);
    expect(report.missingDepositSource).toBe(false);

    // Visible transaction accounts only: acc-main + acc-priv-a; savings excluded.
    expect(report.accounts.map((a) => a.accountId).sort()).toEqual(["acc-main", "acc-priv-a"]);

    const byDay = deltas(report, "acc-main");
    // Day 0 (01-15): +100 deposit -400 bill = 700.
    expect(byDay.get(TODAY)).toBe(-300);
    expect(report.accounts.find((a) => a.accountId === "acc-main")!.points[0]!.balanceCents).toBe(
      700,
    );
    expect(byDay.get("2026-01-16")).toBe(0);
    expect(byDay.get("2026-01-22")).toBe(-400); // second Tuesday
    expect(byDay.get("2026-01-29")).toBe(-300); // deposit + bill

    // The dip: first day strictly below 500 is 01-22 at 300, reported once per account.
    expect(report.warnings).toEqual([
      {
        accountId: "acc-main",
        accountName: "Main",
        cents: 300,
        date: "2026-01-22",
      },
    ]);

    // Series covers every day from today through `through` inclusive: 90 days + today.
    expect(report.accounts.find((a) => a.accountId === "acc-main")!.points).toHaveLength(91);
    expect(report.accounts.find((a) => a.accountId === "acc-main")!.points.at(-1)!.date).toBe(
      "2026-04-15",
    );

    // Private account: no movements, threshold 0, positive balance -> never warns; its balance
    // is the opening snapshot repeated.
    const priv = report.accounts.find((a) => a.accountId === "acc-priv-a")!;
    expect(priv.points.every((p) => p.balanceCents === 1_000)).toBe(true);
  });

  it("lands deposits on rolled pay days and ignores series and non-confirmed rows", () => {
    const uow = baseUow();
    // Sunday anchor: periods [01-04, 01-18), [01-18, 02-01); expected pay days roll back to the
    // Fridays 01-02 (past, dropped) and 01-16.
    uow.state.payAnchors.push({
      id: "anchor-sun" as Id<"PayAnchor">,
      personId: "person-a" as Id<"Person">,
      accountId: "acc-main" as Id<"Account">,
      cadence: "fortnightly",
      dayOfMonth: null,
      anchorDate: "2026-01-04",
      alignment: "calendar",
      expectedNetCents: 5_000,
      expectedGrossCents: 6_000,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    // A confirmed `income` series never rolls forward (deposits come from the calendar, AD-25)...
    uow.state.recurringSeries.push(
      {
        id: "ser-income" as Id<"RecurringSeries">,
        accountId: "acc-main" as Id<"Account">,
        payeeId: "payee-1" as Id<"Payee">,
        direction: "income",
        cadence: "weekly",
        expectedCents: 9_000,
        toleranceBp: 1000,
        nextDueOn: "2026-01-17",
        status: "confirmed",
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      // ...nor does a candidate `bill`.
      {
        id: "ser-candidate" as Id<"RecurringSeries">,
        accountId: "acc-main" as Id<"Account">,
        payeeId: "payee-2" as Id<"Payee">,
        direction: "bill",
        cadence: "weekly",
        expectedCents: 700,
        toleranceBp: 1000,
        nextDueOn: "2026-01-17",
        status: "candidate",
        createdAt: STAMP,
        updatedAt: STAMP,
      },
    );

    const report = forecastCashFlow(ctxFor(uow, "person-a"), {});
    const byDay = deltas(report, "acc-main");
    expect(byDay.get(TODAY)).toBe(0);
    expect(byDay.get("2026-01-16")).toBe(5_000); // rolled Friday pay day
    expect(byDay.get("2026-01-17")).toBe(0); // income and candidate bills ignored
    for (const w of report.warnings) expect(w.accountId).not.toBe("acc-main");
  });

  it("clamps monthly bills on days 29-31 to the shorter month's last day", () => {
    const uow = baseUow();
    uow.state.recurringSeries.push({
      id: "ser-monthly-end" as Id<"RecurringSeries">,
      accountId: "acc-main" as Id<"Account">,
      payeeId: "payee-1" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 100,
      toleranceBp: 1000,
      nextDueOn: "2026-01-31",
      status: "confirmed",
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    const report = forecastCashFlow(ctxFor(uow, "person-a"), { horizon: "3" });
    const byDay = deltas(report, "acc-main");
    expect(byDay.get("2026-01-31")).toBe(-100);
    expect(byDay.get("2026-02-28")).toBe(-100); // February clamp
    expect(byDay.get("2026-03-31")).toBe(-100);
    expect(byDay.get("2026-02-27")).toBe(0);
    expect(byDay.get("2026-04-01")).toBe(0);
  });

  it("pro-rates budget limits daily with the remainder on the period's last day", () => {
    const uow = baseUow();
    fortnightlyAnchor(uow, "person-a", null); // scope anchor only: no deposits, no warning
    uow.state.budgets.push({
      id: "bud-coffee" as Id<"Budget">,
      personId: "person-a" as Id<"Person">,
      categoryId: null,
      categoryGroupId: null,
      cadence: "fortnight",
      limitCents: 1_000,
      rollover: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    const report = forecastCashFlow(ctxFor(uow, "person-a"), { horizon: 3 });
    expect(report.missingDepositSource).toBe(true); // anchor exists but has no expected net
    const byDay = deltas(report, "acc-main");
    // 1,000 / 14 days -> 71 a day, remainder 6 on the last day of each pay-cycle period.
    expect(byDay.get("2026-01-15")).toBe(-71);
    expect(byDay.get("2026-01-27")).toBe(-71);
    expect(byDay.get("2026-01-28")).toBe(-77); // 71 + remainder 6 on the period's last day
    expect(byDay.get("2026-01-29")).toBe(-71); // next period starts
    expect(byDay.get("2026-04-07")).toBe(-71);
    expect(byDay.get("2026-04-08")).toBe(-77); // last period ending inside the horizon
  });

  it("skips a shared budget when the household has no pay anchor", () => {
    const uow = baseUow();
    uow.state.budgets.push({
      id: "bud-shared" as Id<"Budget">,
      personId: null, // shared
      categoryId: null,
      categoryGroupId: null,
      cadence: "fortnight",
      limitCents: 2_000,
      rollover: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    const report = forecastCashFlow(ctxFor(uow, "person-a"), {});
    const byDay = deltas(report, "acc-main");
    for (const delta of byDay.values()) expect(delta).toBe(0);
  });

  it("charges a shared budget to the household anchor's deposit account once set", () => {
    const uow = baseUow();
    uow.state.budgets.push({
      id: "bud-shared" as Id<"Budget">,
      personId: null,
      categoryId: null,
      categoryGroupId: null,
      cadence: "fortnight",
      limitCents: 1_000,
      rollover: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    // Person B's fortnightly calendar anchor becomes the household anchor.
    uow.state.payAnchors.push({
      id: "anchor-b" as Id<"PayAnchor">,
      personId: "person-b" as Id<"Person">,
      accountId: "acc-main" as Id<"Account">,
      cadence: "fortnightly",
      dayOfMonth: null,
      anchorDate: "2026-01-03", // Friday; periods [01-03+14k, ...) -> last days 01-16, 01-30, ...
      alignment: "calendar",
      expectedNetCents: null,
      expectedGrossCents: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    uow.state.settings = {
      ...uow.state.settings,
      householdPayAnchorPersonId: "person-b" as Id<"Person">,
    };

    const report = forecastCashFlow(ctxFor(uow, "person-a"), {});
    const byDay = deltas(report, "acc-main");
    expect(byDay.get("2026-01-15")).toBe(-71);
    expect(byDay.get("2026-01-16")).toBe(-77); // 71 + 6 remainder on the period's last day
  });

  it("shows private accounts only to their owner and honours the horizon", () => {
    const uow = baseUow();
    const asA = forecastCashFlow(ctxFor(uow, "person-a"), {});
    const asB = forecastCashFlow(ctxFor(uow, "person-b"), {});
    expect(asA.accounts.map((a) => a.accountId).sort()).toEqual(["acc-main", "acc-priv-a"]);
    expect(asB.accounts.map((a) => a.accountId)).toEqual(["acc-main"]);

    const six = forecastCashFlow(ctxFor(uow, "person-a"), { horizon: "6" });
    expect(six.horizonMonths).toBe(6);
    expect(six.through).toBe("2026-07-15");
    expect(six.accounts.find((a) => a.accountId === "acc-main")!.points).toHaveLength(182);
    // 300 days would be 01-15 to 11-11; six months ends 07-15 (181 days + today).
    expect(six.accounts.find((a) => a.accountId === "acc-main")!.points.at(-1)!.date).toBe(
      "2026-07-15",
    );
  });

  it("excludes closed accounts, which would otherwise warn on their stale balance", () => {
    const uow = baseUow();
    uow.state.accounts.push({
      id: "acc-closed" as Id<"Account">,
      name: "Old cheque account",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      institutionId: null,
      openedOn: "2026-01-01",
      closedOn: "2026-01-10",
      isSavings: false,
      lowBalanceThresholdCents: 5_000,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    uow.state.balanceSnapshots.push({
      id: "s-4" as Id<"BalanceSnapshot">,
      accountId: "acc-closed" as Id<"Account">,
      asOf: TODAY,
      balanceCents: 100, // far below the 5 000 threshold: a false dip if walked
      source: "manual",
      importBatchId: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    });

    const report = forecastCashFlow(ctxFor(uow, "person-a"), {});
    expect(report.accounts.map((a) => a.accountId).sort()).toEqual(["acc-main", "acc-priv-a"]);
    expect(report.warnings.map((w) => w.accountId)).not.toContain("acc-closed");
  });
});
