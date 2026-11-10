import type { Id } from "@pangolin/shared";
import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { type MemoryUnitOfWork, memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer } from "../viewer.ts";
import {
  confirmRecurringSeries,
  createRecurringSeries,
  deleteRecurringSeries,
  detectRecurringBillCandidates,
  listCandidateSeries,
  listRecurringSeries,
  rejectRecurringSeries,
} from "./recurring-bills.ts";

function createTestContext(viewerPersonId: string = "person-a"): {
  ctx: UseCaseContext;
  uow: MemoryUnitOfWork;
} {
  const clock = {
    today: () => parseDate("2026-04-01"),
    now: () => parseDate("2026-04-01").toZonedDateTime("Australia/Sydney").toInstant(),
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
      userId: "user-a",
      deletedAt: null,
    },
    {
      id: "person-b" as Id<"Person">,
      displayName: "Person B",
      colour: "#00FF00",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      userId: "user-b",
      deletedAt: null,
    },
  ];

  uow.state.institutions = [
    {
      id: "inst-1" as Id<"Institution">,
      name: "CommBank",
      kind: "bank",
      websiteUrl: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  // Shared account
  uow.state.accounts = [
    {
      id: "acct-joint" as Id<"Account">,
      institutionId: "inst-1" as Id<"Institution">,
      name: "Joint Everyday",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "acct-priv-b" as Id<"Account">,
      institutionId: "inst-1" as Id<"Institution">,
      name: "Partner B Secret",
      type: "transaction",
      currency: "AUD",
      isPrivate: true,
      openedOn: null,
      closedOn: null,
      isSavings: false,
      lowBalanceThresholdCents: 0,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
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
      websiteUrl: null,
      logoAttachmentId: null,
      scopePersonId: null,
      defaultCategoryId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "payee-gym" as Id<"Payee">,
      name: "Gym",
      websiteUrl: null,
      logoAttachmentId: null,
      scopePersonId: null,
      defaultCategoryId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "payee-employer" as Id<"Payee">,
      name: "Acme Corp Payroll",
      websiteUrl: null,
      logoAttachmentId: null,
      scopePersonId: null,
      defaultCategoryId: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  return {
    ctx: {
      viewer: personViewer(viewerPersonId as Id<"Person">, clock.now()),
      clock,
      newId,
      uow,
    },
    uow,
  };
}

describe("recurring-bills service", () => {
  it("detects recurring bill candidates for stable occurrences", () => {
    const { ctx, uow } = createTestContext("person-a");

    // Add 3 monthly Netflix transactions in joint account
    uow.state.transactions = [
      {
        id: "t1" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-01-15",
        amountCents: -1999,
        descriptionRaw: "Netflix subscription",
        payeeId: "payee-netflix" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp1",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-15T00:00:00Z",
        updatedAt: "2026-01-15T00:00:00Z",
      },
      {
        id: "t2" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-02-15",
        amountCents: -1999,
        descriptionRaw: "Netflix subscription",
        payeeId: "payee-netflix" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp2",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-02-15T00:00:00Z",
        updatedAt: "2026-02-15T00:00:00Z",
      },
      {
        id: "t3" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-03-15",
        amountCents: -1999,
        descriptionRaw: "Netflix subscription",
        payeeId: "payee-netflix" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp3",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-03-15T00:00:00Z",
        updatedAt: "2026-03-15T00:00:00Z",
      },
    ];

    const detected = detectRecurringBillCandidates(ctx);
    expect(detected).toHaveLength(1);
    expect(detected[0]?.payeeId).toBe("payee-netflix");
    expect(detected[0]?.cadence).toBe("monthly");
    expect(detected[0]?.expectedCents).toBe(1999);
    expect(detected[0]?.nextDueOn).toBe("2026-04-15");
    expect(detected[0]?.status).toBe("candidate");

    // Second run generates nothing new
    const secondRun = detectRecurringBillCandidates(ctx);
    expect(secondRun).toHaveLength(0);

    // Can query candidates
    const candidates = listCandidateSeries(ctx);
    expect(candidates).toHaveLength(1);

    // Can confirm candidate
    const detectedId = detected[0]?.id;
    if (!detectedId) throw new Error("Expected detected candidate");
    const confirmed = confirmRecurringSeries(ctx, { id: detectedId });
    expect(confirmed.status).toBe("confirmed");

    // After confirmation, no candidates left
    expect(listCandidateSeries(ctx)).toHaveLength(0);
    expect(listRecurringSeries(ctx, { status: "confirmed" })).toHaveLength(1);
  });

  it("can reject a candidate", () => {
    const { ctx, uow } = createTestContext("person-a");
    uow.state.recurringSeries = [
      {
        id: "series-1" as Id<"RecurringSeries">,
        accountId: "acct-joint" as Id<"Account">,
        payeeId: "payee-netflix" as Id<"Payee">,
        direction: "bill",
        cadence: "monthly",
        expectedCents: 1999,
        toleranceBp: 1500,
        nextDueOn: "2026-04-15",
        status: "candidate",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    const rejected = rejectRecurringSeries(ctx, { id: "series-1" });
    expect(rejected.status).toBe("rejected");
    expect(listCandidateSeries(ctx)).toHaveLength(0);
  });

  it("excludes internal transfers from candidate detection", () => {
    const { ctx, uow } = createTestContext("person-a");

    uow.state.transactions = [
      {
        id: "t1" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-01-01",
        amountCents: -5000,
        descriptionRaw: "Transfer to savings",
        payeeId: "payee-gym" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp1",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: "group-1" as Id<"TransferGroup">,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "t2" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-01-15",
        amountCents: -5000,
        descriptionRaw: "Transfer to savings",
        payeeId: "payee-gym" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp2",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: "group-2" as Id<"TransferGroup">,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-15T00:00:00Z",
        updatedAt: "2026-01-15T00:00:00Z",
      },
      {
        id: "t3" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-01-29",
        amountCents: -5000,
        descriptionRaw: "Transfer to savings",
        payeeId: "payee-gym" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp3",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: "group-3" as Id<"TransferGroup">,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-29T00:00:00Z",
        updatedAt: "2026-01-29T00:00:00Z",
      },
    ];

    const detected = detectRecurringBillCandidates(ctx);
    expect(detected).toHaveLength(0);
  });

  it("excludes salary deposits matching pay anchor (AD-25)", () => {
    const { ctx, uow } = createTestContext("person-a");

    uow.state.payAnchors = [
      {
        id: "anchor-1" as Id<"PayAnchor">,
        personId: "person-a" as Id<"Person">,
        accountId: "acct-joint" as Id<"Account">,
        cadence: "fortnightly",
        dayOfMonth: null,
        anchorDate: "2026-01-08",
        alignment: "deposit",
        expectedNetCents: 350000,
        expectedGrossCents: 500000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    // Incoming salary deposits
    uow.state.transactions = [
      {
        id: "t1" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-01-08",
        amountCents: 350000,
        descriptionRaw: "Acme Corp Payroll",
        payeeId: "payee-employer" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp1",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-08T00:00:00Z",
        updatedAt: "2026-01-08T00:00:00Z",
      },
      {
        id: "t2" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-01-22",
        amountCents: 350000,
        descriptionRaw: "Acme Corp Payroll",
        payeeId: "payee-employer" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp2",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-22T00:00:00Z",
        updatedAt: "2026-01-22T00:00:00Z",
      },
      {
        id: "t3" as Id<"Transaction">,
        accountId: "acct-joint" as Id<"Account">,
        postedOn: "2026-02-05",
        amountCents: 350000,
        descriptionRaw: "Acme Corp Payroll",
        payeeId: "payee-employer" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp3",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-a" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-02-05T00:00:00Z",
        updatedAt: "2026-02-05T00:00:00Z",
      },
    ];

    const detected = detectRecurringBillCandidates(ctx);
    expect(detected).toHaveLength(0);
  });

  it("respects account privacy boundaries (AD-3, AD-22)", () => {
    const uow = memoryUnitOfWork();
    const { ctx: baseA } = createTestContext("person-a");
    const ctxA: UseCaseContext = { ...baseA, uow };
    const ctxB: UseCaseContext = {
      ...baseA,
      viewer: personViewer("person-b" as Id<"Person">, baseA.clock.now()),
      uow,
    };

    // Copy setup from ctxA to shared uow
    uow.state.people = createTestContext().uow.state.people;
    uow.state.institutions = createTestContext().uow.state.institutions;
    uow.state.accounts = createTestContext().uow.state.accounts;
    uow.state.accountOwners = createTestContext().uow.state.accountOwners;
    uow.state.payees = createTestContext().uow.state.payees;

    // Add 3 gym transactions in Partner B's private account
    uow.state.transactions = [
      {
        id: "t1" as Id<"Transaction">,
        accountId: "acct-priv-b" as Id<"Account">,
        postedOn: "2026-01-01",
        amountCents: -4500,
        descriptionRaw: "Gym membership",
        payeeId: "payee-gym" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp1",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-b" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "t2" as Id<"Transaction">,
        accountId: "acct-priv-b" as Id<"Account">,
        postedOn: "2026-01-15",
        amountCents: -4500,
        descriptionRaw: "Gym membership",
        payeeId: "payee-gym" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp2",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-b" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-15T00:00:00Z",
        updatedAt: "2026-01-15T00:00:00Z",
      },
      {
        id: "t3" as Id<"Transaction">,
        accountId: "acct-priv-b" as Id<"Account">,
        postedOn: "2026-01-29",
        amountCents: -4500,
        descriptionRaw: "Gym membership",
        payeeId: "payee-gym" as Id<"Payee">,
        status: "posted",
        externalId: null,
        fingerprint: "fp3",
        fingerprintVersion: 1,
        importId: null,
        performedBy: "person-b" as Id<"Person">,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: null,
        createdAt: "2026-01-29T00:00:00Z",
        updatedAt: "2026-01-29T00:00:00Z",
      },
    ];

    // Partner A running detection cannot see Partner B's private account
    const detectedByA = detectRecurringBillCandidates(ctxA);
    expect(detectedByA).toHaveLength(0);

    // Partner B running detection detects gym candidate in their private account
    const detectedByB = detectRecurringBillCandidates(ctxB);
    expect(detectedByB).toHaveLength(1);
    expect(detectedByB[0]?.accountId).toBe("acct-priv-b");
    expect(detectedByB[0]?.payeeId).toBe("payee-gym");

    // Partner A cannot see the series
    expect(listRecurringSeries(ctxA)).toHaveLength(0);

    // Partner B sees the series
    expect(listRecurringSeries(ctxB)).toHaveLength(1);

    // Partner A cannot confirm Partner B's private series
    const candidateBId = detectedByB[0]?.id;
    if (!candidateBId) throw new Error("Expected candidate B");
    expect(() => confirmRecurringSeries(ctxA, { id: candidateBId })).toThrow(AppError);
  });

  it("can manually create and delete a recurring series with privacy enforcement", () => {
    let idCounter = 1;
    const newId = <B extends string>() =>
      `01H000000000000000000000${(idCounter++).toString().padStart(2, "0")}` as Id<B>;
    const uow = memoryUnitOfWork();
    const { ctx: baseA } = createTestContext("person-a");
    const ctxA: UseCaseContext = { ...baseA, uow, newId };
    const ctxB: UseCaseContext = {
      ...baseA,
      viewer: personViewer("person-b" as Id<"Person">, baseA.clock.now()),
      uow,
      newId,
    };

    uow.state.people = createTestContext().uow.state.people;
    uow.state.institutions = createTestContext().uow.state.institutions;
    uow.state.accounts = createTestContext().uow.state.accounts;
    uow.state.accountOwners = createTestContext().uow.state.accountOwners;
    uow.state.payees = [
      ...createTestContext().uow.state.payees,
      {
        id: "payee-rent" as Id<"Payee">,
        name: "Landlord",
        websiteUrl: null,
        logoAttachmentId: null,
        scopePersonId: null,
        defaultCategoryId: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    // Create a confirmed series on joint account
    const series = createRecurringSeries(ctxA, {
      accountId: "acct-joint",
      payeeId: "payee-rent",
      direction: "bill",
      cadence: "monthly",
      expectedCents: 250000,
      toleranceBp: 1000,
      nextDueOn: "2026-05-01",
    });

    expect(series.id).toBeDefined();
    expect(series.status).toBe("confirmed");
    expect(series.expectedCents).toBe(250000);
    expect(series.cadence).toBe("monthly");

    // Both A and B can see series on joint account
    expect(listRecurringSeries(ctxA)).toHaveLength(1);
    expect(listRecurringSeries(ctxB)).toHaveLength(1);

    // Creating series on private account
    const privSeries = createRecurringSeries(ctxB, {
      accountId: "acct-priv-b",
      payeeId: "payee-rent",
      direction: "bill",
      cadence: "weekly",
      expectedCents: 5000,
      toleranceBp: 1500,
      nextDueOn: "2026-04-10",
    });

    // A cannot see privSeries, B can see both
    expect(listRecurringSeries(ctxA)).toHaveLength(1);
    expect(listRecurringSeries(ctxB)).toHaveLength(2);

    // A cannot delete privSeries (404)
    expect(() => deleteRecurringSeries(ctxA, { id: privSeries.id })).toThrow(AppError);

    // A cannot create a series for an account they cannot access or doesn't exist
    expect(() =>
      createRecurringSeries(ctxA, {
        accountId: "acct-priv-b",
        payeeId: "payee-rent",
        direction: "bill",
        cadence: "weekly",
        expectedCents: 5000,
        nextDueOn: "2026-04-10",
      }),
    ).toThrow(AppError);

    // B can delete privSeries
    expect(deleteRecurringSeries(ctxB, { id: privSeries.id })).toBe(true);
    expect(listRecurringSeries(ctxB)).toHaveLength(1);

    // Once deleted, deleting again throws NotFound
    expect(() => deleteRecurringSeries(ctxB, { id: privSeries.id })).toThrow(AppError);
  });
});
