import { describe, expect, it } from "vitest";
import { memoryContext, manualClock } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { createAccount } from "../accounts/create-account.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { createGoal } from "./goals.ts";
import { executeDrawdown } from "./goal-drawdown.ts";
import {
  adjustBufferForMismatch,
  DEFAULT_LARGE_WITHDRAWAL_THRESHOLD_CENTS,
  dismissSavingsReviewItem,
  getLargeWithdrawalThresholdCents,
  linkWithdrawalToGoal,
  SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW,
  SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW,
  SAVINGS_MISMATCH_HOUSEHOLD_REVIEW,
  SAVINGS_SHORTFALL_HOUSEHOLD_REVIEW,
  SAVINGS_SHORTFALL_PERSONAL_REVIEW,
  savingsLargeWithdrawalDedupeKey,
  savingsMismatchDedupeKey,
  savingsShortfallDedupeKey,
  syncAllSavingsReviewItems,
  syncLargeWithdrawalReviewItems,
  syncSavingsReconciliationReviewItems,
  takeFromBufferReviewItem,
} from "./savings-review.ts";
import { createTransferGroup } from "../ledger/transfer-groups.ts";
import { listReviewCards } from "../system/review-view.ts";

describe("planning/savings-review", () => {
  const alice = "01HF7YAT000000000000000001";
  const bob = "01HF7YAT000000000000000002";
  const clock = manualClock("2026-01-15T12:00:00Z");

  it("detects large savings withdrawal >= threshold ($2,000 default) with household scope for shared pool", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    // Shared savings account with $10,000 opening snapshot
    const sharedSavingsId = createAccount(ctx, {
      name: "Shared Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: alice, shareBp: 5000 },
        { personId: bob, shareBp: 5000 },
      ],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    uow.state.balanceSnapshots.push({
      id: "snap-shared-1" as any,
      accountId: sharedSavingsId as any,
      asOf: "2026-01-01",
      balanceCents: 1_000_000,
      source: "manual",
      capturedAt: "2026-01-01T00:00:00Z",
    });

    // Transaction >= $2,000 ($2,500 withdrawal)
    const largeTxn = createTransaction(ctx, {
      accountId: sharedSavingsId,
      postedOn: "2026-01-10",
      amountCents: -250_000,
      description: "Car repair",
    });

    // Transaction < threshold ($1,500 withdrawal)
    const smallTxn = createTransaction(ctx, {
      accountId: sharedSavingsId,
      postedOn: "2026-01-11",
      amountCents: -150_000,
      description: "Groceries",
    });

    syncAllSavingsReviewItems(ctx);

    const openItems = uow.state.reviewItems.filter((i) => i.resolvedAt === null);
    expect(openItems).toHaveLength(1);
    expect(openItems[0]?.kind).toBe(SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind);
    expect(openItems[0]?.entityRef).toBe(`transaction:${largeTxn}`);
    expect(openItems[0]?.dedupeKey).toBe(savingsLargeWithdrawalDedupeKey(largeTxn));
    expect(openItems[0]?.personId).toBeNull(); // Household scope

    // Bob can also see it
    const cardsBob = listReviewCards({ ...ctx, viewer: personViewer(bob, clock.now()) });
    expect(cardsBob).toHaveLength(1);
    expect(cardsBob[0]?.detail.type).toBe("savings_large_withdrawal");
  });

  it("detects personal large savings withdrawal with person scope", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    // Alice personal savings account
    const personalSavingsId = createAccount(ctx, {
      name: "Alice Stash",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alice, shareBp: 10000 }],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    uow.state.balanceSnapshots.push({
      id: "snap-alice-1" as any,
      accountId: personalSavingsId as any,
      asOf: "2026-01-01",
      balanceCents: 1_000_000,
      source: "manual",
      capturedAt: "2026-01-01T00:00:00Z",
    });

    const largeTxn = createTransaction(ctx, {
      accountId: personalSavingsId,
      postedOn: "2026-01-10",
      amountCents: -300_000,
      description: "Alice Laptop",
    });

    syncAllSavingsReviewItems(ctx);

    const openItems = uow.state.reviewItems.filter((i) => i.resolvedAt === null);
    expect(openItems).toHaveLength(1);
    expect(openItems[0]?.kind).toBe(SAVINGS_LARGE_WITHDRAWAL_PERSONAL_REVIEW.kind);
    expect(openItems[0]?.personId).toBe(alice); // Person scope

    // Bob CANNOT see Alice's personal review item
    const cardsBob = listReviewCards({ ...ctx, viewer: personViewer(bob, clock.now()) });
    expect(cardsBob).toHaveLength(0);
  });

  it("does not raise review item for internal transfer between savings accounts in same pool", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    const s1Id = createAccount(ctx, {
      name: "Savings 1",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alice, shareBp: 10000 }],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    const s2Id = createAccount(ctx, {
      name: "Savings 2",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alice, shareBp: 10000 }],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    uow.state.balanceSnapshots.push({
      id: "snap-s1" as any,
      accountId: s1Id as any,
      asOf: "2026-01-01",
      balanceCents: 500_000,
      source: "manual",
      capturedAt: "2026-01-01T00:00:00Z",
    });

    const t1 = createTransaction(ctx, {
      accountId: s1Id,
      postedOn: "2026-01-10",
      amountCents: -250_000,
      description: "Transfer to S2",
    });

    const t2 = createTransaction(ctx, {
      accountId: s2Id,
      postedOn: "2026-01-10",
      amountCents: 250_000,
      description: "Transfer from S1",
    });

    // Link into transfer group
    createTransferGroup(ctx, {
      transactionIds: [t1, t2],
    });

    syncAllSavingsReviewItems(ctx);

    const openItems = uow.state.reviewItems.filter((i) => i.resolvedAt === null);
    expect(openItems).toHaveLength(0);
  });

  it("does not raise review item if withdrawal is already linked to goal drawdown", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    const s1Id = createAccount(ctx, {
      name: "Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [{ personId: alice, shareBp: 10000 }],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    uow.state.balanceSnapshots.push({
      id: "snap-s1" as any,
      accountId: s1Id as any,
      asOf: "2026-01-01",
      balanceCents: 500_000,
      source: "manual",
      capturedAt: "2026-01-01T00:00:00Z",
    });

    const txnId = createTransaction(ctx, {
      accountId: s1Id,
      postedOn: "2026-01-10",
      amountCents: -250_000,
      description: "Holiday flights",
    });

    const goal = createGoal(ctx, {
      name: "Holiday",
      pool: alice,
      targetCents: 500_000,
    });

    uow.state.goalAllocations.push({
      id: "alloc-h1" as any,
      goalId: goal.id as any,
      periodStart: "2026-01-01",
      allocatedCents: 300_000,
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Execute drawdown linked to txn
    executeDrawdown(ctx, {
      pool: alice,
      reason: "large_purchase",
      amountCents: 250_000,
      label: "Holiday flights",
      transactionId: txnId,
      adjustments: [{ goalId: goal.id, amountCents: 250_000 }],
    });

    syncAllSavingsReviewItems(ctx);

    const openItems = uow.state.reviewItems.filter((i) => i.resolvedAt === null);
    expect(openItems).toHaveLength(0);
  });

  it("raises shortfall review item when pool is over-committed and cures it when status is ok", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    // Shared pool with goals = $1,000, savings = $800 -> shortfall = $200
    const goal = createGoal(ctx, {
      name: "Emergency",
      pool: "shared",
      targetCents: 100_000,
    });

    uow.state.goalAllocations.push({
      id: "alloc-e1" as any,
      goalId: goal.id as any,
      periodStart: "2026-01-01",
      allocatedCents: 100_000,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const savingsId = createAccount(ctx, {
      name: "Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: alice, shareBp: 5000 },
        { personId: bob, shareBp: 5000 },
      ],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    // Seed snapshot: balance = $800 on 2026-01-10
    uow.state.balanceSnapshots.push({
      id: "snap-1" as any,
      accountId: savingsId as any,
      asOf: "2026-01-10",
      balanceCents: 80_000,
      source: "manual",
      capturedAt: "2026-01-10T00:00:00Z",
    });

    syncAllSavingsReviewItems(ctx);

    let openItems = uow.state.reviewItems.filter((i) => i.resolvedAt === null);
    expect(openItems).toHaveLength(1);
    expect(openItems[0]?.kind).toBe(SAVINGS_SHORTFALL_HOUSEHOLD_REVIEW.kind);
    expect(openItems[0]?.dedupeKey).toBe(savingsShortfallDedupeKey("shared"));

    // Now increase bank balance to $1,200 (curing shortfall)
    uow.state.balanceSnapshots.push({
      id: "snap-2" as any,
      accountId: savingsId as any,
      asOf: "2026-01-15",
      balanceCents: 120_000,
      source: "manual",
      capturedAt: "2026-01-15T00:00:00Z",
    });

    syncAllSavingsReviewItems(ctx);

    openItems = uow.state.reviewItems.filter((i) => i.resolvedAt === null);
    expect(openItems).toHaveLength(0);

    const cured = uow.state.reviewItems.find((i) => i.dedupeKey === savingsShortfallDedupeKey("shared"));
    expect(cured?.resolution).toBe("cured");
  });

  it("handles 'Take it from the buffer' action when buffer is sufficient", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    const savingsId = createAccount(ctx, {
      name: "Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: alice, shareBp: 5000 },
        { personId: bob, shareBp: 5000 },
      ],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    // Balance $5,000 opening snapshot on 2026-01-01
    uow.state.balanceSnapshots.push({
      id: "snap-1" as any,
      accountId: savingsId as any,
      asOf: "2026-01-01",
      balanceCents: 500_000,
      source: "manual",
      capturedAt: "2026-01-01T00:00:00Z",
    });

    const goal = createGoal(ctx, {
      name: "Emergency",
      pool: "shared",
      targetCents: 100_000,
    });

    uow.state.goalAllocations.push({
      id: "alloc-e1" as any,
      goalId: goal.id as any,
      periodStart: "2026-01-01",
      allocatedCents: 100_000,
      createdAt: "2026-01-01T00:00:00Z",
    });

    // Withdrawal of $2,000 on 2026-01-15 -> balance becomes $3,000
    // Buffer = actualSavings ($3,000) - goalTotal ($1,000) = $2,000.
    // canTakeFromBuffer = buffer ($2,000) >= abs(withdrawal) ($2,000) = true!
    const txnId = createTransaction(ctx, {
      accountId: savingsId,
      postedOn: "2026-01-15",
      amountCents: -200_000,
      description: "Dental work",
    });

    syncAllSavingsReviewItems(ctx);

    const openItem = uow.state.reviewItems.find((i) => i.resolvedAt === null && i.kind === SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind);
    expect(openItem).toBeDefined();

    // Verify detail in review cards
    const [card] = listReviewCards(ctx);
    expect(card?.detail.type).toBe("savings_large_withdrawal");
    if (card?.detail.type === "savings_large_withdrawal") {
      expect(card.detail.canTakeFromBuffer).toBe(true);
      expect(card.detail.bufferCents).toBe(200_000);
    }

    // Act: Take it from the buffer
    takeFromBufferReviewItem(ctx, { id: openItem!.id });

    const resolved = uow.state.reviewItems.find((i) => i.id === openItem!.id);
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolution).toBe("buffer");
  });

  it("handles 'It's for a goal' action, creating drawdown and resolving item", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    const savingsId = createAccount(ctx, {
      name: "Savings",
      type: "savings",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: alice, shareBp: 5000 },
        { personId: bob, shareBp: 5000 },
      ],
      isSavings: true,
      openedOn: "2026-01-01",
    });

    uow.state.balanceSnapshots.push({
      id: "snap-shared-1" as any,
      accountId: savingsId as any,
      asOf: "2026-01-01",
      balanceCents: 1_000_000,
      source: "manual",
      capturedAt: "2026-01-01T00:00:00Z",
    });

    const goal = createGoal(ctx, {
      name: "Car Fund",
      pool: "shared",
      targetCents: 500_000,
    });

    uow.state.goalAllocations.push({
      id: "alloc-cf1" as any,
      goalId: goal.id as any,
      periodStart: "2026-01-01",
      allocatedCents: 300_000,
      createdAt: "2026-01-01T00:00:00Z",
    });

    const txnId = createTransaction(ctx, {
      accountId: savingsId,
      postedOn: "2026-01-15",
      amountCents: -200_000,
      description: "Car tyres",
    });

    syncAllSavingsReviewItems(ctx);

    const openItem = uow.state.reviewItems.find((i) => i.resolvedAt === null && i.kind === SAVINGS_LARGE_WITHDRAWAL_HOUSEHOLD_REVIEW.kind);
    expect(openItem).toBeDefined();

    // Act: link withdrawal to goal
    const result = linkWithdrawalToGoal(ctx, {
      id: openItem!.id,
      goalId: goal.id,
    });

    expect(result.drawdown.transactionId).toBe(txnId);
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0]?.goalId).toBe(goal.id);
    expect(result.adjustments[0]?.amountCents).toBe(200_000);

    const resolved = uow.state.reviewItems.find((i) => i.id === openItem!.id);
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolution).toBe("linked");
  });

  it("handles 'Put difference in buffer' for mismatch", () => {
    const { ctx, uow } = memoryContext(personViewer(alice, clock.now()), clock);
    uow.state.people = [
      { id: alice, displayName: "Alice", role: "primary", authRole: "admin", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
      { id: bob, displayName: "Bob", role: "partner", authRole: "member", createdAt: "2026-01-01T00:00:00Z", deletedAt: null, userId: null },
    ];

    // Raise mismatch item manually or via sync
    const dedupeKey = savingsMismatchDedupeKey("shared");
    uow.state.reviewItems.push({
      id: "rev-mismatch-1" as any,
      kind: SAVINGS_MISMATCH_HOUSEHOLD_REVIEW.kind,
      accountId: null,
      personId: null,
      entityRef: "savings_pool:shared",
      dedupeKey,
      createdAt: "2026-01-15T00:00:00Z",
      resolvedAt: null,
      resolution: null,
    });

    adjustBufferForMismatch(ctx, { id: "rev-mismatch-1" });

    const resolved = uow.state.reviewItems.find((i) => i.id === "rev-mismatch-1");
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.resolution).toBe("buffer adjusted");
  });
});
