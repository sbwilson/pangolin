import { idSchema } from "@pangolin/shared";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../clock.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import type { PayAnchorRow } from "../ports/unit-of-work.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { detectPayDeposits } from "./detect-pay-deposits.ts";
import { getPayAnchor, listPayAnchors, upsertPayAnchor } from "./pay-anchor.ts";
import { resolvePayCalendar } from "./pay-calendar.ts";

const personA = idSchema("Person").parse("01J0000000000000000000000A");
const personB = idSchema("Person").parse("01J0000000000000000000000B");
const accountIdA = idSchema("Account").parse("01J0000000000000000000001A");
const accountIdB = idSchema("Account").parse("01J0000000000000000000001B");

const now = Temporal.Instant.from("2026-10-31T00:00:00Z");

function setup(viewer: Viewer = personViewer(personA, now)) {
  const uow = memoryUnitOfWork();
  // seed people
  uow.state.people.push(
    {
      id: personA,
      userId: "user-a",
      displayName: "Person A",
      colour: "#ff0000",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
    {
      id: personB,
      userId: "user-b",
      displayName: "Person B",
      colour: "#0000ff",
      createdAt: now.toString(),
      updatedAt: now.toString(),
      deletedAt: null,
    },
  );
  // seed accounts
  uow.state.accounts.push(
    {
      id: accountIdA,
      name: "Account A",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      id: accountIdB,
      name: "Account B",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      institutionId: null,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );
  uow.state.accountOwners.push(
    {
      accountId: accountIdA,
      personId: personA,
      shareBp: 10000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
    {
      accountId: accountIdB,
      personId: personB,
      shareBp: 10000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    },
  );

  const ctx: UseCaseContext = {
    viewer,
    clock: fixedClock(parseDate("2026-10-31"), now),
    newId: createIdGenerator({ now: () => now.epochMilliseconds, random: () => 0.5 }),
    uow,
  };
  return { ctx, uow };
}

describe("pay-anchor and pay-calendar", () => {
  it("upserts and gets personal pay anchor, respecting cross-partner privacy", () => {
    const { ctx } = setup();

    const created = upsertPayAnchor(ctx, {
      accountId: accountIdA,
      cadence: "fortnightly",
      anchorDate: "2026-10-10",
      alignment: "calendar",
      expectedNetCents: 350000,
      expectedGrossCents: 500000,
    });

    expect(created.personId).toBe(personA);
    expect(created.expectedNetCents).toBe(350000);

    const read = getPayAnchor(ctx, {});
    expect(read).toEqual(created);

    // Partner B cannot query Partner A's pay anchor
    const partnerCtx: UseCaseContext = {
      ...ctx,
      viewer: personViewer(personB, now),
    };

    expect(() => getPayAnchor(partnerCtx, { personId: personA })).toThrow(AppError);
    expect(listPayAnchors(partnerCtx)).toEqual([]);
  });

  it("resolves calendar alignment with weekend roll-back", () => {
    const { ctx } = setup();
    const anchor: PayAnchorRow = {
      id: idSchema("PayAnchor").parse("01J000000000000000000000AA"),
      personId: personA,
      accountId: accountIdA,
      cadence: "fortnightly",
      anchorDate: "2026-10-10", // Saturday
      dayOfMonth: null,
      alignment: "calendar",
      expectedNetCents: 300000,
      expectedGrossCents: 450000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    };

    const calendar = resolvePayCalendar(ctx, anchor);
    const p = calendar.periodContaining(parseDate("2026-10-10"));
    expect(p.start.toString()).toBe("2026-10-10");
    expect(p.end.toString()).toBe("2026-10-24");
    expect(p.expectedPayDate.toString()).toBe("2026-10-09"); // rolled back to Friday
  });

  it("resolves deposit alignment when deposits exist and falls back to calendar when none exist", () => {
    const { ctx, uow } = setup();
    const anchor: PayAnchorRow = {
      id: idSchema("PayAnchor").parse("01J000000000000000000000AA"),
      personId: personA,
      accountId: accountIdA,
      cadence: "fortnightly",
      anchorDate: "2026-10-09", // Friday
      dayOfMonth: null,
      alignment: "deposit",
      expectedNetCents: 300000,
      expectedGrossCents: 450000,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    };

    // No deposits yet -> cleanly falls back to calendar
    const calendarFallback = resolvePayCalendar(ctx, anchor);
    const pFallback = calendarFallback.periodContaining(parseDate("2026-10-09"));
    expect(pFallback.start.toString()).toBe("2026-10-09");
    expect(pFallback.actualPayDate).toBeNull();

    // Now insert pay deposits (e.g. deposited on Thursday 2026-10-08 instead of Friday 2026-10-09)
    uow.state.transactions.push({
      id: idSchema("Transaction").parse("01J000000000000000000000TX"),
      accountId: accountIdA,
      postedOn: "2026-10-08",
      amountCents: 300000,
      descriptionRaw: "ACME CORP SALARY",
      notes: null,
      status: "posted",
      nameHiddenBy: null,
      nameHiddenUntil: null,
      performedBy: personA,
      transferGroupId: null,
      externalId: null,
      fingerprint: "fp1",
      fingerprintVersion: 1,
      payeeId: null,
      importId: null,
      isHidden: false,
      needsReview: false,
      createdAt: now.toString(),
      updatedAt: now.toString(),
    });

    const detected = detectPayDeposits(ctx, anchor);
    expect(detected).toHaveLength(1);
    expect(detected[0]?.postedOn.toString()).toBe("2026-10-08");

    const calendarWithDeposit = resolvePayCalendar(ctx, anchor);
    const pDeposit = calendarWithDeposit.periodContaining(parseDate("2026-10-08"));
    expect(pDeposit.start.toString()).toBe("2026-10-08");
    expect(pDeposit.actualPayDate?.toString()).toBe("2026-10-08");
  });
});
