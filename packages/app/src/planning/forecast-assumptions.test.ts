// `planning.forecastAssumptions` — per-person forecast rates (integer basis points) with
// defaults-on-read, partial-merge upserts, wholesale mortgage-list replacement, one audited
// row per write, and the AD-22 guards: only the person reads or writes their own values, a
// cross-person `personId` is `NotFound`, and every listed loan must be a visible `home_loan`.
// Every row of the ticket's I/O matrix is covered here on the memory uow.
import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import type { AppError } from "../errors.ts";
import type { AccountRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import type { MemoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import {
  FORECAST_ASSUMPTION_DEFAULTS,
  getForecastAssumptions,
  upsertForecastAssumptions,
} from "./forecast-assumptions.ts";

const STAMP = "2026-10-17T09:00:00Z";

function account(id: string, type: AccountRow["type"], isPrivate = false): AccountRow {
  return {
    id: id as Id<"Account">,
    name: id,
    type,
    currency: "AUD",
    isPrivate,
    institutionId: null,
    openedOn: "2026-01-01",
    closedOn: null,
    isSavings: false,
    lowBalanceThresholdCents: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function setup() {
  const clock = manualClock("2026-10-17T10:00:00Z");
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
  // Two household home loans both partners see, B's private home loan, and a plain
  // transaction account that is not a loan at all.
  uow.state.accounts = [
    account("loan-1", "home_loan"),
    account("loan-2", "home_loan"),
    account("loan-b-private", "home_loan", true),
    account("acc-main", "transaction"),
  ];
  uow.state.accountOwners = [
    {
      accountId: "loan-b-private" as Id<"Account">,
      personId: b,
      shareBp: 10_000,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ];
  const viewerA = { ...ctx, viewer: personViewer(a, clock.now()) };
  const viewerB = { ...ctx, viewer: personViewer(b, clock.now()) };
  return { ctx, uow, clock, a, b, viewerA, viewerB };
}

function auditRowsFor(uow: MemoryUnitOfWork, personId: string, entity = "forecast_assumption") {
  return uow.state.audit.filter((a) => a.entity === entity && a.entityId === personId);
}

const ZEROS = {
  savingsRateBps: 0,
  returnLowBps: 0,
  returnMidBps: 0,
  returnHighBps: 0,
  superRateBps: 0,
  mortgages: [],
};

/** A mortgage in an expectation: the selection, plus its terms — null unless given. */
function mortgage(
  accountId: string,
  countOffset: boolean,
  terms?: { annualRatePercent?: string; monthlyRepaymentCents?: number },
) {
  return {
    accountId,
    countOffset,
    annualRatePercent: terms?.annualRatePercent ?? null,
    monthlyRepaymentCents: terms?.monthlyRepaymentCents ?? null,
  };
}

function expectError(fn: () => unknown, code: "NotFound" | "Validation" | "Unauthenticated"): void {
  try {
    fn();
    throw new Error(`expected an AppError with code ${code}, but nothing was thrown`);
  } catch (err) {
    expect((err as AppError).code).toBe(code);
  }
}

describe("planning.forecastAssumptions", () => {
  describe("getForecastAssumptions", () => {
    it("returns neutral zeros and an empty mortgage list when nothing is stored, writing nothing", () => {
      const { uow, viewerA } = setup();
      expect(getForecastAssumptions(viewerA, {})).toEqual(ZEROS);
      expect(uow.state.forecastAssumptions).toEqual([]);
      expect(uow.state.forecastAssumptionMortgages).toEqual([]);
      expect(uow.state.audit).toEqual([]);
    });

    it("defaults match the exported FORECAST_ASSUMPTION_DEFAULTS", () => {
      const { viewerA } = setup();
      expect(getForecastAssumptions(viewerA)).toEqual(FORECAST_ASSUMPTION_DEFAULTS);
    });

    it("throws Unauthenticated for a non-person viewer", () => {
      const { ctx } = setup();
      expectError(() => getForecastAssumptions(ctx, {}), "Unauthenticated");
    });

    it("rejects an unknown key on the GET input", () => {
      const { viewerA } = setup();
      expectError(
        () => getForecastAssumptions(viewerA, { personId: "person-b" } as never),
        "Validation",
      );
    });
  });

  describe("upsertForecastAssumptions", () => {
    it("round-trips scalars and the mortgage list, and audits before/after", () => {
      const { uow, viewerA, a } = setup();
      const after = upsertForecastAssumptions(viewerA, {
        savingsRateBps: 4500,
        mortgages: [{ accountId: "loan-1", countOffset: true }],
      });
      expect(after).toEqual({
        ...ZEROS,
        savingsRateBps: 4500,
        mortgages: [mortgage("loan-1", true)],
      });
      expect(getForecastAssumptions(viewerA, {})).toEqual(after);

      const audit = auditRowsFor(uow, a);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.action).toBe("update");
      expect(audit[0]?.before).toBeNull();
      expect(JSON.parse(audit[0]?.after ?? "null")).toEqual(after);

      // One stored row, created and updated at the clock.
      expect(uow.state.forecastAssumptions).toHaveLength(1);
      expect(uow.state.forecastAssumptions[0]?.createdAt).toBe("2026-10-17T10:00:00.000Z");
    });

    it("partial-merges scalars: an omitted field keeps its existing value, the list stays", () => {
      const { uow, viewerA } = setup();
      upsertForecastAssumptions(viewerA, {
        savingsRateBps: 4500,
        returnHighBps: 700,
        mortgages: [{ accountId: "loan-1", countOffset: true }],
      });
      const after = upsertForecastAssumptions(viewerA, { returnMidBps: 600 });
      expect(after).toEqual({
        savingsRateBps: 4500,
        returnLowBps: 0,
        returnMidBps: 600,
        returnHighBps: 700,
        superRateBps: 0,
        mortgages: [mortgage("loan-1", true)],
      });
      expect(getForecastAssumptions(viewerA, {})).toEqual(after);
      expect(uow.state.forecastAssumptionMortgages).toHaveLength(1);
    });

    it("replaces the mortgage list wholesale when present", () => {
      const { uow, viewerA } = setup();
      upsertForecastAssumptions(viewerA, {
        mortgages: [{ accountId: "loan-1", countOffset: true }],
      });
      const after = upsertForecastAssumptions(viewerA, {
        mortgages: [{ accountId: "loan-2", countOffset: false }],
      });
      expect(after.mortgages).toEqual([mortgage("loan-2", false)]);
      expect(getForecastAssumptions(viewerA, {}).mortgages).toEqual([mortgage("loan-2", false)]);
      expect(uow.state.forecastAssumptionMortgages).toHaveLength(1);
    });

    it("an empty mortgage list clears the selections", () => {
      const { uow, viewerA } = setup();
      upsertForecastAssumptions(viewerA, {
        mortgages: [
          { accountId: "loan-1", countOffset: true },
          { accountId: "loan-2", countOffset: false },
        ],
      });
      const after = upsertForecastAssumptions(viewerA, { mortgages: [] });
      expect(after.mortgages).toEqual([]);
      expect(uow.state.forecastAssumptionMortgages).toEqual([]);
    });

    it("keeps createdAt across updates and moves updatedAt", () => {
      const { uow, clock, viewerA, a } = setup();
      upsertForecastAssumptions(viewerA, { savingsRateBps: 100 });
      clock.advance(60_000);
      upsertForecastAssumptions(viewerA, { savingsRateBps: 200 });
      const row = uow.state.forecastAssumptions.find((r) => r.personId === a);
      expect(row?.createdAt).toBe("2026-10-17T10:00:00.000Z");
      expect(row?.updatedAt).toBe("2026-10-17T10:01:00.000Z");
      expect(uow.state.forecastAssumptions).toHaveLength(1);
      expect(auditRowsFor(uow, a)).toHaveLength(2);
    });

    it("audits the previous state as before on the second write", () => {
      const { uow, viewerA, a } = setup();
      upsertForecastAssumptions(viewerA, {
        savingsRateBps: 4500,
        mortgages: [{ accountId: "loan-1", countOffset: true }],
      });
      const after = upsertForecastAssumptions(viewerA, { returnMidBps: 600 });
      const audit = auditRowsFor(uow, a);
      expect(audit).toHaveLength(2);
      expect(JSON.parse(audit[1]?.before ?? "null")).toEqual({
        ...ZEROS,
        savingsRateBps: 4500,
        mortgages: [mortgage("loan-1", true)],
      });
      expect(JSON.parse(audit[1]?.after ?? "null")).toEqual(after);
    });

    it("a person targeting another person's personId is NotFound and writes nothing", () => {
      const { uow, viewerA, b } = setup();
      expectError(
        () => upsertForecastAssumptions(viewerA, { personId: b, savingsRateBps: 4500 }),
        "NotFound",
      );
      expect(uow.state.forecastAssumptions).toEqual([]);
      expect(uow.state.forecastAssumptionMortgages).toEqual([]);
      expect(auditRowsFor(uow, b)).toEqual([]);
    });

    it("a person may name their own personId", () => {
      const { viewerA, a } = setup();
      expect(upsertForecastAssumptions(viewerA, { personId: a, savingsRateBps: 100 })).toEqual({
        ...ZEROS,
        savingsRateBps: 100,
      });
    });

    it("a listed account the viewer cannot see is NotFound and writes nothing", () => {
      const { uow, viewerA } = setup();
      expectError(
        () =>
          upsertForecastAssumptions(viewerA, {
            mortgages: [{ accountId: "loan-b-private", countOffset: true }],
          }),
        "NotFound",
      );
      expect(uow.state.forecastAssumptions).toEqual([]);
      expect(uow.state.forecastAssumptionMortgages).toEqual([]);
    });

    it("a listed account that is not a home_loan is NotFound", () => {
      const { uow, viewerA } = setup();
      expectError(
        () =>
          upsertForecastAssumptions(viewerA, {
            mortgages: [{ accountId: "acc-main", countOffset: true }],
          }),
        "NotFound",
      );
      expectError(
        () =>
          upsertForecastAssumptions(viewerA, {
            mortgages: [{ accountId: "no-such", countOffset: false }],
          }),
        "NotFound",
      );
      expect(uow.state.forecastAssumptions).toEqual([]);
    });

    it("a closed home_loan can still be listed (the FK never dangles; 8.5 filters closed)", () => {
      const { uow, viewerA } = setup();
      const closed = { ...account("loan-old", "home_loan"), closedOn: "2026-06-30" };
      uow.state.accounts.push(closed);
      const after = upsertForecastAssumptions(viewerA, {
        mortgages: [{ accountId: "loan-old", countOffset: false }],
      });
      expect(after.mortgages).toEqual([mortgage("loan-old", false)]);
    });

    it("rejects bad bodies with Validation and writes nothing", () => {
      const { uow, viewerA } = setup();
      const badBodies: Record<string, unknown>[] = [
        { unknownKey: 1 },
        { savingsRateBps: -1 },
        { savingsRateBps: 10_001 },
        { returnLowBps: 1.5 },
        { superRateBps: "500" },
        { mortgages: [{ accountId: "loan-1", countOffset: true, extra: 1 }] },
        { mortgages: [{ accountId: "loan-1" }] },
        {
          mortgages: [
            { accountId: "loan-1", countOffset: true },
            { accountId: "loan-1", countOffset: false },
          ],
        },
      ];
      for (const body of badBodies) {
        expectError(() => upsertForecastAssumptions(viewerA, body as never), "Validation");
      }
      expect(uow.state.forecastAssumptions).toEqual([]);
      expect(uow.state.forecastAssumptionMortgages).toEqual([]);
      expect(uow.state.audit).toEqual([]);
    });

    it("the system viewer (the seed) writes a named person's values through the use case", () => {
      const { ctx, uow, viewerA, viewerB, b } = setup();
      const seeded = upsertForecastAssumptions(ctx, {
        personId: b,
        savingsRateBps: 4500,
        returnLowBps: 300,
        returnMidBps: 500,
        returnHighBps: 700,
        superRateBps: 1200,
        mortgages: [{ accountId: "loan-1", countOffset: true }],
      });
      expect(seeded).toEqual({
        savingsRateBps: 4500,
        returnLowBps: 300,
        returnMidBps: 500,
        returnHighBps: 700,
        superRateBps: 1200,
        mortgages: [mortgage("loan-1", true)],
      });
      expect(getForecastAssumptions(viewerA, {})).toEqual(ZEROS); // A is untouched
      expect(getForecastAssumptions(viewerB, {})).toEqual(seeded);
      expect(auditRowsFor(uow, b)).toHaveLength(1);
    });

    it("the system viewer needs a personId", () => {
      const { ctx } = setup();
      expectError(() => upsertForecastAssumptions(ctx, { savingsRateBps: 100 }), "Validation");
    });

    it("an unknown personId is Validation", () => {
      const { ctx } = setup();
      expectError(
        () => upsertForecastAssumptions(ctx, { personId: "ghost", savingsRateBps: 100 }),
        "Validation",
      );
    });

    it("round-trips mortgage terms; omitting terms on a listed loan means no terms", () => {
      const { uow, viewerA } = setup();
      const after = upsertForecastAssumptions(viewerA, {
        mortgages: [
          {
            accountId: "loan-1",
            countOffset: true,
            annualRatePercent: "6.175",
            monthlyRepaymentCents: 420_000,
          },
        ],
      });
      expect(after.mortgages).toEqual([
        mortgage("loan-1", true, { annualRatePercent: "6.175", monthlyRepaymentCents: 420_000 }),
      ]);
      expect(getForecastAssumptions(viewerA, {}).mortgages).toEqual(after.mortgages);
      expect(uow.state.forecastAssumptionMortgages[0]).toMatchObject({
        annualRatePercent: "6.175",
        monthlyRepaymentCents: 420_000,
      });

      // The list is replaced wholesale, so omitted terms become null — not the old values.
      const cleared = upsertForecastAssumptions(viewerA, {
        mortgages: [{ accountId: "loan-1", countOffset: false }],
      });
      expect(cleared.mortgages).toEqual([mortgage("loan-1", false)]);
      expect(getForecastAssumptions(viewerA, {}).mortgages).toEqual([mortgage("loan-1", false)]);
    });

    it("keeps stored terms across a write that omits the mortgage list", () => {
      const { viewerA } = setup();
      upsertForecastAssumptions(viewerA, {
        mortgages: [
          {
            accountId: "loan-1",
            countOffset: true,
            annualRatePercent: "6.175",
            monthlyRepaymentCents: 420_000,
          },
        ],
      });
      const after = upsertForecastAssumptions(viewerA, { savingsRateBps: 100 });
      expect(after.mortgages).toEqual([
        mortgage("loan-1", true, { annualRatePercent: "6.175", monthlyRepaymentCents: 420_000 }),
      ]);
    });

    it("rejects malformed terms with Validation and writes nothing", () => {
      const { uow, viewerA } = setup();
      const badBodies: Record<string, unknown>[] = [
        { mortgages: [{ accountId: "loan-1", countOffset: true, annualRatePercent: "abc" }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, annualRatePercent: "" }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, annualRatePercent: "-6.175" }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, annualRatePercent: "6e2" }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, annualRatePercent: 6.175 }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, monthlyRepaymentCents: 0 }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, monthlyRepaymentCents: -1 }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, monthlyRepaymentCents: 1.5 }] },
        { mortgages: [{ accountId: "loan-1", countOffset: true, monthlyRepaymentCents: "4200" }] },
      ];
      for (const body of badBodies) {
        expectError(() => upsertForecastAssumptions(viewerA, body as never), "Validation");
      }
      expect(uow.state.forecastAssumptions).toEqual([]);
      expect(uow.state.forecastAssumptionMortgages).toEqual([]);
      expect(uow.state.audit).toEqual([]);
    });
  });
});
