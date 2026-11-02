import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import {
  BILL_ALERT_MISSED_PAYMENT_REVIEW,
  BILL_ALERT_PRICE_RISE_REVIEW,
  billMissedPaymentDedupeKey,
  billPriceRiseDedupeKey,
  dismissBillAlertReviewItem,
  syncAllBillAlertReviewItems,
} from "./bill-alerts.ts";

function createTestContext(viewerPersonId: string = "person-a"): UseCaseContext {
  const clock = {
    today: () => parseDate("2026-04-20"),
    now: () => parseDate("2026-04-20").toZonedDateTime("Australia/Sydney").toInstant(),
  };

  let idCounter = 1;
  const newId = <B extends string>() =>
    `01H000000000000000000000${(idCounter++).toString().padStart(2, "0")}` as Id<B>;

  const uow = memoryUnitOfWork();

  uow.state.people = [
    {
      id: "person-a" as Id<"Person">,
      displayName: "Person A",
      colour: "#FF0000",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      userId: "user-a",
    },
    {
      id: "person-b" as Id<"Person">,
      displayName: "Person B",
      colour: "#00FF00",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
      userId: "user-b",
    },
  ];

  uow.state.accounts = [
    {
      id: "acct-joint" as Id<"Account">,
      institutionId: "inst-1" as Id<"Institution">,
      name: "Joint Everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      accountNumberMasked: null,
      routingNumber: null,
      closedOn: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    },
    {
      id: "acct-priv-b" as Id<"Account">,
      institutionId: "inst-1" as Id<"Institution">,
      name: "Partner B Secret",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      accountNumberMasked: null,
      routingNumber: null,
      closedOn: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    },
  ];

  uow.state.accountOwners = [
    {
      accountId: "acct-joint" as Id<"Account">,
      personId: "person-a" as Id<"Person">,
      shareBp: 5000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      accountId: "acct-joint" as Id<"Account">,
      personId: "person-b" as Id<"Person">,
      shareBp: 5000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      accountId: "acct-priv-b" as Id<"Account">,
      personId: "person-b" as Id<"Person">,
      shareBp: 10000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  uow.state.payees = [
    {
      id: "payee-netflix" as Id<"Payee">,
      name: "Netflix",
      scopePersonId: null,
      defaultCategoryId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    },
    {
      id: "payee-gym" as Id<"Payee">,
      name: "Gym",
      scopePersonId: null,
      defaultCategoryId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      deletedAt: null,
    },
  ];

  return {
    viewer: { kind: "person", personId: viewerPersonId as Id<"Person"> },
    clock,
    newId,
    uow,
  };
}

describe("bill-alerts application use cases", () => {
  it("generates missed payment alert when nextDueOn + grace < today and no matching payment", () => {
    const ctx = createTestContext("person-a");

    // Confirmed monthly series with nextDueOn = 2026-04-10. Today is 2026-04-20 (> 7 days grace)
    ctx.uow.state.recurringSeries.push({
      id: "series-netflix" as Id<"RecurringSeries">,
      accountId: "acct-joint" as Id<"Account">,
      payeeId: "payee-netflix" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 1999,
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    syncAllBillAlertReviewItems(ctx);

    const items = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe(BILL_ALERT_MISSED_PAYMENT_REVIEW.kind);
    expect(items[0]?.accountId).toBe("acct-joint");
    expect(items[0]?.dedupeKey).toBe(billMissedPaymentDedupeKey("series-netflix", "2026-04-10"));
  });

  it("does not generate missed payment alert if still within grace period", () => {
    const ctx = createTestContext("person-a");

    // nextDueOn is 2026-04-15 (monthly grace = 7 days -> cutoff 2026-04-22). Today is 2026-04-20.
    ctx.uow.state.recurringSeries.push({
      id: "series-netflix" as Id<"RecurringSeries">,
      accountId: "acct-joint" as Id<"Account">,
      payeeId: "payee-netflix" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 1999,
      toleranceBp: 1500,
      nextDueOn: "2026-04-15",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    syncAllBillAlertReviewItems(ctx);

    const items = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(items).toHaveLength(0);
  });

  it("auto-resolves open missed payment alert when matching payment is detected", () => {
    const ctx = createTestContext("person-a");

    ctx.uow.state.recurringSeries.push({
      id: "series-netflix" as Id<"RecurringSeries">,
      accountId: "acct-joint" as Id<"Account">,
      payeeId: "payee-netflix" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 1999,
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // 1. Run sync: generates missed alert
    syncAllBillAlertReviewItems(ctx);
    expect(ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer))).toHaveLength(1);

    // 2. Matching payment transaction occurs on 2026-04-11
    ctx.uow.state.transactions.push({
      id: "t-netflix-paid" as Id<"Transaction">,
      accountId: "acct-joint" as Id<"Account">,
      postedOn: "2026-04-11",
      amountCents: -1999,
      descriptionRaw: "Netflix payment",
      payeeId: "payee-netflix" as Id<"Payee">,
      status: "posted",
      externalId: null,
      fingerprint: "fp-paid",
      fingerprintVersion: 1,
      importId: null,
      performedBy: "person-a" as Id<"Person">,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: "2026-04-11T00:00:00Z",
      updatedAt: "2026-04-11T00:00:00Z",
      deletedAt: null,
    });

    // 3. Re-run sync: should resolve missed payment alert
    syncAllBillAlertReviewItems(ctx);
    const openItems = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(openItems).toHaveLength(0);

    const resolved = ctx.uow.state.reviewItems.find(
      (r) => r.dedupeKey === billMissedPaymentDedupeKey("series-netflix", "2026-04-10"),
    );
    expect(resolved?.resolution).toBe("paid");
  });

  it("raises price rise alert when matching payment is > 10% higher than expected", () => {
    const ctx = createTestContext("person-a");

    ctx.uow.state.recurringSeries.push({
      id: "series-netflix" as Id<"RecurringSeries">,
      accountId: "acct-joint" as Id<"Account">,
      payeeId: "payee-netflix" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 10000, // $100
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Payment occurs for $114 (-11,400 cents, +14%)
    ctx.uow.state.transactions.push({
      id: "t-netflix-rise" as Id<"Transaction">,
      accountId: "acct-joint" as Id<"Account">,
      postedOn: "2026-04-10",
      amountCents: -11400,
      descriptionRaw: "Netflix new price",
      payeeId: "payee-netflix" as Id<"Payee">,
      status: "posted",
      externalId: null,
      fingerprint: "fp-rise",
      fingerprintVersion: 1,
      importId: null,
      performedBy: "person-a" as Id<"Person">,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: "2026-04-10T00:00:00Z",
      updatedAt: "2026-04-10T00:00:00Z",
      deletedAt: null,
    });

    syncAllBillAlertReviewItems(ctx);

    const items = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe(BILL_ALERT_PRICE_RISE_REVIEW.kind);
    expect(items[0]?.dedupeKey).toBe(billPriceRiseDedupeKey("series-netflix", "t-netflix-rise"));
  });

  it("does not raise price rise alert when payment increase is <= 10%", () => {
    const ctx = createTestContext("person-a");

    ctx.uow.state.recurringSeries.push({
      id: "series-netflix" as Id<"RecurringSeries">,
      accountId: "acct-joint" as Id<"Account">,
      payeeId: "payee-netflix" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 10000, // $100
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Payment occurs for $108 (-10,800 cents, +8%)
    ctx.uow.state.transactions.push({
      id: "t-netflix-normal" as Id<"Transaction">,
      accountId: "acct-joint" as Id<"Account">,
      postedOn: "2026-04-10",
      amountCents: -10800,
      descriptionRaw: "Netflix normal variation",
      payeeId: "payee-netflix" as Id<"Payee">,
      status: "posted",
      externalId: null,
      fingerprint: "fp-norm",
      fingerprintVersion: 1,
      importId: null,
      performedBy: "person-a" as Id<"Person">,
      transferGroupId: null,
      needsReview: false,
      isHidden: false,
      nameHiddenBy: null,
      nameHiddenUntil: null,
      notes: null,
      createdAt: "2026-04-10T00:00:00Z",
      updatedAt: "2026-04-10T00:00:00Z",
      deletedAt: null,
    });

    syncAllBillAlertReviewItems(ctx);

    const items = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(items).toHaveLength(0);
  });

  it("allows user to dismiss bill alert with 'acknowledged'", () => {
    const ctx = createTestContext("person-a");

    ctx.uow.state.recurringSeries.push({
      id: "series-netflix" as Id<"RecurringSeries">,
      accountId: "acct-joint" as Id<"Account">,
      payeeId: "payee-netflix" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 1999,
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    syncAllBillAlertReviewItems(ctx);
    const items = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(items).toHaveLength(1);
    const itemRow = items[0];
    expect(itemRow).toBeDefined();
    if (!itemRow) throw new Error("Expected itemRow");
    const itemId = itemRow.id;

    dismissBillAlertReviewItem(ctx, { id: itemId });

    const openItems = ctx.uow.read((r) => r.reviewItems.listOpenFor(ctx.viewer));
    expect(openItems).toHaveLength(0);

    const item = ctx.uow.state.reviewItems.find((r) => r.id === itemId);
    expect(item?.resolution).toBe("acknowledged");
  });

  it("respects privacy scoping: partner A cannot see or dismiss partner B's private bill alert", () => {
    let idCounter = 1;
    const newId = <B extends string>() =>
      `01H000000000000000000000${(idCounter++).toString().padStart(2, "0")}` as Id<B>;
    const uow = memoryUnitOfWork();
    const ctxA = { ...createTestContext("person-a"), uow, newId };
    const ctxB = { ...createTestContext("person-b"), uow, newId };

    uow.state.people = createTestContext().uow.state.people;
    uow.state.accounts = createTestContext().uow.state.accounts;
    uow.state.accountOwners = createTestContext().uow.state.accountOwners;
    uow.state.payees = createTestContext().uow.state.payees;

    // Series in partner B's private account
    uow.state.recurringSeries.push({
      id: "series-priv" as Id<"RecurringSeries">,
      accountId: "acct-priv-b" as Id<"Account">,
      payeeId: "payee-gym" as Id<"Payee">,
      direction: "bill",
      cadence: "monthly",
      expectedCents: 5000,
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    // Run sync as partner B (or system viewer)
    syncAllBillAlertReviewItems(ctxB);

    // Partner A sees 0 items
    expect(ctxA.uow.read((r) => r.reviewItems.listOpenFor(ctxA.viewer))).toHaveLength(0);

    // Partner B sees 1 item
    const itemsB = ctxB.uow.read((r) => r.reviewItems.listOpenFor(ctxB.viewer));
    expect(itemsB).toHaveLength(1);
    const itemRowB = itemsB[0];
    expect(itemRowB).toBeDefined();
    if (!itemRowB) throw new Error("Expected itemRowB");
    const itemId = itemRowB.id;

    // Partner A cannot dismiss Partner B's item
    expect(() => dismissBillAlertReviewItem(ctxA, { id: itemId })).toThrow(AppError);

    // Partner B can dismiss it
    dismissBillAlertReviewItem(ctxB, { id: itemId });
    expect(ctxB.uow.read((r) => r.reviewItems.listOpenFor(ctxB.viewer))).toHaveLength(0);
  });
});
