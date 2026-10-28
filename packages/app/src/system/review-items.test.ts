import { type Id, idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { createCategory } from "../classify/categories.ts";
import { createCategoryGroup } from "../classify/category-groups.ts";
import "../classify/domain-link.ts"; // installs the domain-link listener, as any @pangolin/app load does
import { createPayee } from "../classify/payees.ts";
import { CLASSIFY_UNCLASSIFIED_REVIEW } from "../classify/rules.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createTransaction } from "../ledger/create-transaction.ts";
import { getTransaction } from "../ledger/get-transaction.ts";
import type { SuggestionRow } from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import {
  acceptSuggestionItem,
  bulkAcceptSuggestions,
  dismissSuggestionItem,
} from "./review-actions.ts";
import {
  defineReviewKind,
  JOB_DEAD_REVIEW,
  listReviewItems,
  type RaiseReviewItemInput,
  raiseReviewItem,
  registerEntitySync,
  resolveReviewItem,
  resolveReviewItemsForEntity,
} from "./review-items.ts";
import { listReviewCards } from "./review-view.ts";

const personA = idSchema("Person").parse("01J0000000000000000000000A");
const personB = idSchema("Person").parse("01J0000000000000000000000B");
const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

const personal = defineReviewKind({ kind: "test.personal", module: "planning", scope: "person" });
const perAccount = defineReviewKind({ kind: "test.account", module: "ledger", scope: "account" });
const household = defineReviewKind({
  kind: "test.household",
  module: "system",
  scope: "household",
});

function setup() {
  const clock = manualClock("2026-09-27T00:00:00Z");
  const made = memoryContext(systemViewer("job:test"), clock);
  // The review item's foreign key: the account the per-account items point at.
  made.uow.state.accounts.push({
    id: "acc1" as Id<"Account">,
    name: "Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  made.uow.state.accountOwners.push({
    accountId: "acc1" as Id<"Account">,
    personId: personA,
    shareBp: 10000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return { clock, ...made };
}

function raise(ctx: UseCaseContext, input: RaiseReviewItemInput) {
  return write(ctx, (tx, audit) => raiseReviewItem(tx, audit, ctx, input));
}

function resolve(ctx: UseCaseContext, dedupeKey: string, resolution = "dismissed") {
  return write(ctx, (tx, audit) => resolveReviewItem(tx, audit, ctx, { dedupeKey, resolution }));
}

describe("defineReviewKind", () => {
  it("registers job.dead with household scope", () => {
    expect(JOB_DEAD_REVIEW).toEqual({ kind: "job.dead", module: "system", scope: "household" });
  });

  it("returns the same kind when defined again identically, and refuses a conflict", () => {
    expect(defineReviewKind({ kind: "test.personal", module: "planning", scope: "person" })).toBe(
      personal,
    );
    expect(() =>
      defineReviewKind({ kind: "test.personal", module: "planning", scope: "household" }),
    ).toThrow(TypeError);
    expect(() => defineReviewKind({ kind: "nodot", module: "x", scope: "household" })).toThrow(
      TypeError,
    );
    expect(() =>
      defineReviewKind({ kind: "test.scope", module: "x", scope: "global" as never }),
    ).toThrow(TypeError);
  });
});

describe("raiseReviewItem / resolveReviewItem", () => {
  const item = { kind: household, entityRef: "thing:1", dedupeKey: "thing:1" };

  it("is idempotent while open; resolving closes it; raising again opens a new item", () => {
    const { ctx, clock, uow } = setup();
    const first = raise(ctx, item);
    expect(first.raised).toBe(true);
    expect(raise(ctx, item)).toEqual({ id: first.id, raised: false });
    expect(uow.state.reviewItems).toHaveLength(1);

    clock.advance(1000);
    expect(resolve(ctx, "thing:1", "cleared")).toBe(true);
    expect(uow.state.reviewItems[0]).toMatchObject({
      resolvedAt: "2026-09-27T00:00:01.000Z",
      resolution: "cleared",
    });
    expect(resolve(ctx, "thing:1")).toBe(false);

    const again = raise(ctx, item);
    expect(again.raised).toBe(true);
    expect(again.id).not.toBe(first.id);
    expect(uow.state.reviewItems.filter((row) => row.resolvedAt === null)).toHaveLength(1);
  });

  it("refuses a dedupe key that is already open under another kind", () => {
    const { ctx, uow } = setup();
    raise(ctx, item);
    const other = defineReviewKind({ kind: "test.other", module: "system", scope: "household" });
    expect(() => raise(ctx, { ...item, kind: other })).toThrow(
      /already open as test\.household, not test\.other/,
    );
    expect(uow.state.reviewItems.map((row) => row.kind)).toEqual(["test.household"]);
  });

  it("audits each raise and resolve, and nothing for a no-op", () => {
    const { ctx, uow } = setup();
    const { id } = raise(ctx, item);
    raise(ctx, item);
    resolve(ctx, "thing:1");
    resolve(ctx, "thing:1");
    expect(uow.state.audit.map((row) => [row.entity, row.entityId, row.action, row.actor])).toEqual(
      [
        ["review_item", id, "raise", "job:test"],
        ["review_item", id, "resolve", "job:test"],
      ],
    );
    const [raised, resolved] = uow.state.audit;
    expect(raised?.before).toBeNull();
    expect(JSON.parse(raised?.after ?? "")).toMatchObject({ id, resolvedAt: null });
    expect(JSON.parse(resolved?.after ?? "")).toMatchObject({ id, resolution: "dismissed" });
  });

  it("gives audit rows the item's scope", () => {
    const { ctx, uow } = setup();
    raise(ctx, { kind: personal, entityRef: "goal:1", dedupeKey: "p", personId: personA });
    raise(ctx, { kind: perAccount, entityRef: "acct:1", dedupeKey: "a", accountId: "acc1" });
    expect(uow.state.audit.map((row) => [row.personId, row.accountId])).toEqual([
      [personA, null],
      [null, "acc1"],
    ]);
  });

  it("enforces the kind's scope and a registered kind", () => {
    const { ctx, uow } = setup();
    const bad: RaiseReviewItemInput[] = [
      { kind: personal, entityRef: "x", dedupeKey: "x" },
      { kind: personal, entityRef: "x", dedupeKey: "x", personId: personA, accountId: "a" },
      { kind: perAccount, entityRef: "x", dedupeKey: "x" },
      { kind: household, entityRef: "x", dedupeKey: "x", personId: personA },
      {
        kind: { kind: "test.unregistered", module: "x", scope: "household" },
        entityRef: "x",
        dedupeKey: "x",
      },
    ];
    for (const input of bad) expect(() => raise(ctx, input)).toThrow(TypeError);
    expect(() => raise(ctx, { kind: household, entityRef: "", dedupeKey: "x" })).toThrow(AppError);
    expect(() => resolve(ctx, "x", "")).toThrow(AppError);
    expect(uow.state.reviewItems).toEqual([]);
  });
});

describe("entity sync", () => {
  const item = (entityRef: string, dedupeKey: string): RaiseReviewItemInput => ({
    kind: household,
    entityRef,
    dedupeKey,
  });

  it("refuses an empty prefix", () => {
    expect(() => registerEntitySync("", () => {})).toThrow(TypeError);
  });

  it("replaces the listener of a prefix and fires every matching prefix", () => {
    const { ctx } = setup();
    const calls: string[] = [];
    registerEntitySync("syncr:", () => calls.push("old"));
    registerEntitySync("syncr:", () => calls.push("new"));
    registerEntitySync("sync", () => calls.push("short"));
    raise(ctx, item("syncr:1", "sr1"));
    expect(calls.sort()).toEqual(["new", "short"]);
    calls.length = 0;
    resolve(ctx, "sr1");
    expect(calls.sort()).toEqual(["new", "short"]);
    calls.length = 0;
    raise(ctx, item("other:1", "sr2"));
    expect(calls).toEqual([]);
  });

  it("does not sync when a raise hits an open dedupe key", () => {
    const { ctx } = setup();
    const calls: string[] = [];
    registerEntitySync("syncd:", (_tx, _ctx, ref) => calls.push(ref));
    raise(ctx, item("syncd:1", "sd1"));
    raise(ctx, item("syncd:1", "sd1"));
    expect(calls).toEqual(["syncd:1"]);
  });

  it("resolves every open item for an entity once, syncing once", () => {
    const { ctx, uow } = setup();
    const calls: string[] = [];
    registerEntitySync("synce:", (_tx, _ctx, ref) => calls.push(ref));
    raise(ctx, item("synce:1", "se1"));
    raise(ctx, item("synce:1", "se2"));
    raise(ctx, item("synce:2", "se3"));
    calls.length = 0;
    const resolved = write(ctx, (tx, audit) =>
      resolveReviewItemsForEntity(tx, audit, ctx, { entityRef: "synce:1", resolution: "gone" }),
    );
    expect(resolved).toBe(2);
    expect(calls).toEqual(["synce:1"]);
    expect(uow.state.reviewItems.filter((r) => r.resolution === "gone")).toHaveLength(2);
    expect(uow.state.reviewItems.find((r) => r.dedupeKey === "se3")?.resolvedAt).toBeNull();
    expect(uow.state.audit.filter((r) => r.action === "resolve")).toHaveLength(2);
    calls.length = 0;
    const again = write(ctx, (tx, audit) =>
      resolveReviewItemsForEntity(tx, audit, ctx, { entityRef: "synce:1", resolution: "gone" }),
    );
    expect(again).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("listReviewItems", () => {
  function seeded() {
    const { ctx, clock, uow } = setup();
    raise(ctx, { kind: personal, entityRef: "goal:a", dedupeKey: "a", personId: personA });
    clock.advance(1);
    raise(ctx, { kind: personal, entityRef: "goal:b", dedupeKey: "b", personId: personB });
    clock.advance(1);
    raise(ctx, { kind: household, entityRef: "thing:h", dedupeKey: "h" });
    clock.advance(1);
    raise(ctx, { kind: perAccount, entityRef: "acct:1", dedupeKey: "acc", accountId: "acc1" });
    raise(ctx, { kind: household, entityRef: "thing:gone", dedupeKey: "gone" });
    resolve(ctx, "gone");
    return { ctx, uow };
  }

  it("shows a person their own, the household's and visible accounts' items, not another's private account", () => {
    const { ctx } = seeded();
    const asA = { ...ctx, viewer: personViewer(personA, now) };
    expect(listReviewItems(asA, {}).map((row) => row.entityRef)).toEqual([
      "goal:a",
      "thing:h",
      "acct:1",
    ]);
    const asB = { ...ctx, viewer: personViewer(personB, now) };
    expect(listReviewItems(asB).map((row) => row.entityRef)).toEqual(["goal:b", "thing:h"]);
  });

  it("keeps an item on a public account visible to both people", () => {
    const { ctx, uow } = seeded();
    uow.state.accounts.push({
      ...(uow.state.accounts[0] as (typeof uow.state.accounts)[number]),
      id: "pub1" as Id<"Account">,
      isPrivate: false,
    });
    raise(ctx, { kind: perAccount, entityRef: "acct:pub", dedupeKey: "pub", accountId: "pub1" });
    for (const person of [personA, personB]) {
      const refs = listReviewItems({ ...ctx, viewer: personViewer(person, now) }).map(
        (row) => row.entityRef,
      );
      expect(refs).toContain("acct:pub");
    }
  });

  it("shows a system viewer every open item", () => {
    const { ctx } = seeded();
    expect(listReviewItems(ctx).map((row) => row.entityRef)).toEqual([
      "goal:a",
      "goal:b",
      "thing:h",
      "acct:1",
    ]);
  });

  it("returns items without their dedupe key or resolution", () => {
    const { ctx } = seeded();
    const [first] = listReviewItems(ctx);
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "accountId",
      "createdAt",
      "entityRef",
      "id",
      "kind",
      "personId",
    ]);
  });

  it("rejects unknown input", () => {
    const { ctx } = seeded();
    expect(() => listReviewItems(ctx, { all: true } as never)).toThrow(AppError);
  });
});

describe("suggestion review actions", () => {
  function suggestionFixture() {
    const clock = manualClock("2026-09-27T00:00:00Z");
    const made = memoryContext(systemViewer("job:test"), clock);
    made.uow.state.people = [
      {
        id: personA,
        userId: null,
        displayName: "Alex",
        colour: "#000000",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      },
      {
        id: personB,
        userId: null,
        displayName: "Sam",
        colour: "#000000",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deletedAt: null,
      },
    ];
    made.uow.state.accounts.push(
      {
        id: "pub1" as Id<"Account">,
        name: "Joint everyday",
        type: "transaction",
        currency: "AUD",
        isPrivate: false,
        institutionId: null,
        openedOn: null,
        closedOn: null,
        isSavings: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "priv1" as Id<"Account">,
        name: "Alex private",
        type: "transaction",
        currency: "AUD",
        isPrivate: true,
        institutionId: null,
        openedOn: null,
        closedOn: null,
        isSavings: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    );
    made.uow.state.accountOwners.push(
      {
        accountId: "pub1" as Id<"Account">,
        personId: personA,
        shareBp: 5000,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        accountId: "pub1" as Id<"Account">,
        personId: personB,
        shareBp: 5000,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        accountId: "priv1" as Id<"Account">,
        personId: personA,
        shareBp: 10000,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    );

    const ctxA = { ...made.ctx, viewer: personViewer(personA, now) };
    const ctxB = { ...made.ctx, viewer: personViewer(personB, now) };

    const grp = createCategoryGroup(ctxA, { name: "Living", kind: "expense" });
    const cat = createCategory(ctxA, { groupId: grp.id, name: "Groceries", isFixedCost: false });

    return { ...made, clock, ctxA, ctxB, catId: cat.id };
  }

  it("accepts an AI suggestion: sets category with source llm, marks suggestion accepted, and resolves review item", () => {
    const f = suggestionFixture();
    const txnId = createTransaction(f.ctxA, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -5000,
      description: "Woolworths",
    });
    const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;

    const sugId = f.ctx.newId<"Suggestion">();
    const sugRow: SuggestionRow = {
      id: sugId,
      accountId: "pub1" as Id<"Account">,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: f.catId,
      payeeName: "Woolworths",
      websiteDomain: "woolworths.com.au",
      taxCategoryId: null,
      activityId: null,
      confidence: 0.95,
      model: "test-model",
      promptVersion: "1",
      outcome: "open",
      createdAt: "2026-09-27T00:00:00Z",
      resolvedAt: null,
    };
    f.uow.state.suggestions.push(sugRow);

    const reviewItemId = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txnId}`,
      dedupeKey: `classify.unclassified:${txnId}`,
      accountId: "pub1",
    }).id;

    // Verify card attaches suggestion details in listReviewCards
    const cardsBefore = listReviewCards(f.ctxA);
    const card = cardsBefore.find((c) => c.id === reviewItemId);
    expect(card).toBeDefined();
    expect(card?.detail.type).toBe("transaction");
    if (card?.detail.type === "transaction") {
      expect(card.detail.suggestion).toBeDefined();
      expect(card.detail.suggestion?.confidence).toBe(0.95);
      expect(card.detail.suggestion?.categoryName).toBe("Groceries");
    }

    // Accept suggestion
    acceptSuggestionItem(f.ctxA, { id: reviewItemId });

    // Verify split category and provenance
    const updatedTxn = getTransaction(f.ctxA, { id: txnId });
    expect(updatedTxn.splits[0]!.categoryId).toBe(f.catId);
    expect(updatedTxn.splits[0]!.categorySource).toBe("llm");

    // Verify suggestion outcome and resolvedAt
    const updatedSug = f.uow.state.suggestions.find((s) => s.id === sugId);
    expect(updatedSug?.outcome).toBe("accepted");
    expect(updatedSug?.resolvedAt).not.toBeNull();

    // Verify review item resolved
    const cardsAfter = listReviewCards(f.ctxA);
    expect(cardsAfter.some((c) => c.id === reviewItemId)).toBe(false);
  });

  it("dismisses an AI suggestion: marks suggestion rejected, leaves split unclassified and review item open", () => {
    const f = suggestionFixture();
    const txnId = createTransaction(f.ctxA, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -3500,
      description: "Coles",
    });
    const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;

    const sugId = f.ctx.newId<"Suggestion">();
    const sugRow: SuggestionRow = {
      id: sugId,
      accountId: "pub1" as Id<"Account">,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: f.catId,
      payeeName: "Coles",
      websiteDomain: "coles.com.au",
      taxCategoryId: null,
      activityId: null,
      confidence: 0.75,
      model: "test-model",
      promptVersion: "1",
      outcome: "open",
      createdAt: "2026-09-27T00:00:00Z",
      resolvedAt: null,
    };
    f.uow.state.suggestions.push(sugRow);

    const reviewItemId = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txnId}`,
      dedupeKey: `classify.unclassified:${txnId}`,
      accountId: "pub1",
    }).id;

    // Dismiss suggestion
    dismissSuggestionItem(f.ctxA, { id: reviewItemId });

    // Verify suggestion outcome rejected
    const updatedSug = f.uow.state.suggestions.find((s) => s.id === sugId);
    expect(updatedSug?.outcome).toBe("rejected");
    expect(updatedSug?.resolvedAt).not.toBeNull();

    // Verify split remains unclassified
    const currentTxn = getTransaction(f.ctxA, { id: txnId });
    expect(currentTxn.splits[0]!.categoryId).toBeNull();

    // Verify review item remains open, but no longer has open suggestion
    const cardsAfter = listReviewCards(f.ctxA);
    const card = cardsAfter.find((c) => c.id === reviewItemId);
    expect(card).toBeDefined();
    if (card?.detail.type === "transaction") {
      expect(card.detail.suggestion).toBeNull();
    }
  });

  it("bulk-accepts multiple high-confidence suggestions", () => {
    const f = suggestionFixture();
    const txn1Id = createTransaction(f.ctxA, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -5000,
      description: "Store 1",
    });
    const txn2Id = createTransaction(f.ctxA, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -7000,
      description: "Store 2",
    });
    const split1Id = getTransaction(f.ctxA, { id: txn1Id }).splits[0]!.id;
    const split2Id = getTransaction(f.ctxA, { id: txn2Id }).splits[0]!.id;

    const sug1 = f.ctx.newId<"Suggestion">();
    const sug2 = f.ctx.newId<"Suggestion">();
    f.uow.state.suggestions.push(
      {
        id: sug1,
        accountId: "pub1" as Id<"Account">,
        transactionId: txn1Id,
        splitId: split1Id,
        source: "llm",
        field: "category",
        suggestedValue: f.catId,
        payeeName: "Store 1",
        websiteDomain: null,
        taxCategoryId: null,
        activityId: null,
        confidence: 0.94,
        model: "test-model",
        promptVersion: "1",
        outcome: "open",
        createdAt: "2026-09-27T00:00:00Z",
        resolvedAt: null,
      },
      {
        id: sug2,
        accountId: "pub1" as Id<"Account">,
        transactionId: txn2Id,
        splitId: split2Id,
        source: "llm",
        field: "category",
        suggestedValue: f.catId,
        payeeName: "Store 2",
        websiteDomain: null,
        taxCategoryId: null,
        activityId: null,
        confidence: 0.98,
        model: "test-model",
        promptVersion: "1",
        outcome: "open",
        createdAt: "2026-09-27T00:00:00Z",
        resolvedAt: null,
      },
    );

    const item1 = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txn1Id}`,
      dedupeKey: `classify.unclassified:${txn1Id}`,
      accountId: "pub1",
    }).id;
    const item2 = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txn2Id}`,
      dedupeKey: `classify.unclassified:${txn2Id}`,
      accountId: "pub1",
    }).id;

    const result = bulkAcceptSuggestions(f.ctxA, { ids: [item1, item2] });
    expect(result.acceptedCount).toBe(2);

    expect(getTransaction(f.ctxA, { id: txn1Id }).splits[0]!.categorySource).toBe("llm");
    expect(getTransaction(f.ctxA, { id: txn2Id }).splits[0]!.categorySource).toBe("llm");
    expect(f.uow.state.suggestions.find((s) => s.id === sug1)?.outcome).toBe("accepted");
    expect(f.uow.state.suggestions.find((s) => s.id === sug2)?.outcome).toBe("accepted");
  });

  it("enforces privacy: partner B cannot see, accept, or dismiss private suggestions of partner A", () => {
    const f = suggestionFixture();
    const txnId = createTransaction(f.ctxA, {
      accountId: "priv1",
      postedOn: "2026-09-27",
      amountCents: -9900,
      description: "Secret Gift Shop",
    });
    const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;

    const sugId = f.ctx.newId<"Suggestion">();
    f.uow.state.suggestions.push({
      id: sugId,
      accountId: "priv1" as Id<"Account">,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: f.catId,
      payeeName: "Secret Gift",
      websiteDomain: null,
      taxCategoryId: null,
      activityId: null,
      confidence: 0.95,
      model: "test-model",
      promptVersion: "1",
      outcome: "open",
      createdAt: "2026-09-27T00:00:00Z",
      resolvedAt: null,
    });

    const privItem = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txnId}`,
      dedupeKey: `classify.unclassified:${txnId}`,
      accountId: "priv1",
    }).id;

    // Partner B cannot see card in review list
    expect(listReviewCards(f.ctxB).some((c) => c.id === privItem)).toBe(false);

    // Partner B cannot accept or dismiss A's private item
    expect(() => acceptSuggestionItem(f.ctxB, { id: privItem })).toThrow(AppError);
    expect(() => dismissSuggestionItem(f.ctxB, { id: privItem })).toThrow(AppError);
    expect(() => bulkAcceptSuggestions(f.ctxB, { ids: [privItem] })).toThrow(AppError);
  });

  it("handles duplicate review item IDs in bulkAcceptSuggestions without throwing", () => {
    const f = suggestionFixture();
    const txnId = createTransaction(f.ctxA, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -5000,
      description: "Store Duplicate",
    });
    const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;

    f.uow.state.suggestions.push({
      id: f.ctx.newId<"Suggestion">(),
      accountId: "pub1" as Id<"Account">,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: f.catId,
      payeeName: "Store",
      websiteDomain: null,
      taxCategoryId: null,
      activityId: null,
      confidence: 0.95,
      model: "test-model",
      promptVersion: "1",
      outcome: "open",
      createdAt: "2026-09-27T00:00:00Z",
      resolvedAt: null,
    });

    const item = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txnId}`,
      dedupeKey: `classify.unclassified:${txnId}`,
      accountId: "pub1",
    }).id;

    const result = bulkAcceptSuggestions(f.ctxA, { ids: [item, item] });
    expect(result.acceptedCount).toBe(1);
  });

  it("throws Conflict when accepting suggestion if split already set by user provenance", () => {
    const f = suggestionFixture();
    const txnId = createTransaction(f.ctxA, {
      accountId: "pub1",
      postedOn: "2026-09-27",
      amountCents: -5000,
      description: "Store User Set",
    });
    const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;

    // Simulate split already set by user
    f.uow.transaction((tx) => {
      tx.transactions.updateSplit({
        ...tx.transactions.findVisible(f.ctxA.viewer, txnId, "2026-09-27")!.splits[0]!,
        categoryId: f.catId,
        categorySource: "user",
      });
    });

    f.uow.state.suggestions.push({
      id: f.ctx.newId<"Suggestion">(),
      accountId: "pub1" as Id<"Account">,
      transactionId: txnId,
      splitId,
      source: "llm",
      field: "category",
      suggestedValue: f.catId,
      payeeName: "Store",
      websiteDomain: null,
      taxCategoryId: null,
      activityId: null,
      confidence: 0.95,
      model: "test-model",
      promptVersion: "1",
      outcome: "open",
      createdAt: "2026-09-27T00:00:00Z",
      resolvedAt: null,
    });

    const item = raise(f.ctx, {
      kind: CLASSIFY_UNCLASSIFIED_REVIEW,
      entityRef: `transaction:${txnId}`,
      dedupeKey: `classify.unclassified:${txnId}`,
      accountId: "pub1",
    }).id;

    expect(() => acceptSuggestionItem(f.ctxA, { id: item })).toThrow(AppError);
  });

  describe("accepting links the domain and asks for a logo", () => {
    function pushSuggestion(
      f: ReturnType<typeof suggestionFixture>,
      txnId: Id<"Transaction">,
      websiteDomain: string | null,
    ) {
      const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;
      f.uow.state.suggestions.push({
        id: f.ctx.newId<"Suggestion">(),
        accountId: "pub1" as Id<"Account">,
        transactionId: txnId,
        splitId,
        source: "llm",
        field: "category",
        suggestedValue: f.catId,
        payeeName: "Shop",
        websiteDomain,
        taxCategoryId: null,
        activityId: null,
        confidence: 0.95,
        model: "test-model",
        promptVersion: "1",
        outcome: "open",
        createdAt: "2026-09-27T00:00:00Z",
        resolvedAt: null,
      });
      return raise(f.ctx, {
        kind: CLASSIFY_UNCLASSIFIED_REVIEW,
        entityRef: `transaction:${txnId}`,
        dedupeKey: `classify.unclassified:${txnId}`,
        accountId: "pub1",
      }).id;
    }

    const logoJobs = (f: ReturnType<typeof suggestionFixture>) =>
      f.uow.state.jobs.filter((j) => j.kind === "logo-fetch");

    it("links the normalised website onto the payee and enqueues one net-lane job", () => {
      const f = suggestionFixture();
      const payee = createPayee(f.ctxA, { name: "Woolworths", originAccountId: "pub1" });
      const txnId = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -5000,
        description: "Woolworths",
        payeeId: payee.id,
      });
      const item = pushSuggestion(f, txnId, "https://www.Woolworths.com.au/store?x=1");

      acceptSuggestionItem(f.ctxA, { id: item });

      expect(f.uow.state.payees.find((p) => p.id === payee.id)?.websiteUrl).toBe(
        "https://woolworths.com.au",
      );
      const jobs = logoJobs(f);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.lane).toBe("net");
      expect(jobs[0]!.dedupeKey).toBe(`logo:${payee.id}`);
      expect(JSON.parse(jobs[0]!.payload)).toEqual({ payeeId: payee.id });
    });

    it("dedupes: a second accepted suggestion for the same payee adds no job", () => {
      const f = suggestionFixture();
      const payee = createPayee(f.ctxA, { name: "Woolworths", originAccountId: "pub1" });
      const txn1 = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -5000,
        description: "Woolworths 1",
        payeeId: payee.id,
      });
      const txn2 = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -6000,
        description: "Woolworths 2",
        payeeId: payee.id,
      });
      acceptSuggestionItem(f.ctxA, { id: pushSuggestion(f, txn1, "woolworths.com.au") });
      acceptSuggestionItem(f.ctxA, { id: pushSuggestion(f, txn2, "woolworths.com.au") });

      expect(logoJobs(f)).toHaveLength(1);
    });

    it("keeps an existing website and still asks for a logo", () => {
      const f = suggestionFixture();
      const payee = createPayee(f.ctxA, {
        name: "Woolworths",
        originAccountId: "pub1",
        websiteUrl: "https://existing.example.org",
      });
      // The create above already queued one job; clear it to watch the accept alone.
      f.uow.state.jobs.length = 0;
      const txnId = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -5000,
        description: "Woolworths",
        payeeId: payee.id,
      });
      const item = pushSuggestion(f, txnId, "woolworths.com.au");

      acceptSuggestionItem(f.ctxA, { id: item });

      expect(f.uow.state.payees.find((p) => p.id === payee.id)?.websiteUrl).toBe(
        "https://existing.example.org",
      );
      expect(logoJobs(f)).toHaveLength(1);
    });

    it("links a private payee's domain but enqueues no fetch", () => {
      const f = suggestionFixture();
      const payee = createPayee(f.ctxA, { name: "Secret Shop", originAccountId: "priv1" });
      const txnId = createTransaction(f.ctxA, {
        accountId: "priv1",
        postedOn: "2026-09-27",
        amountCents: -9900,
        description: "Secret Shop",
        payeeId: payee.id,
      });
      const splitId = getTransaction(f.ctxA, { id: txnId }).splits[0]!.id;
      f.uow.state.suggestions.push({
        id: f.ctx.newId<"Suggestion">(),
        accountId: "priv1" as Id<"Account">,
        transactionId: txnId,
        splitId,
        source: "llm",
        field: "category",
        suggestedValue: f.catId,
        payeeName: "Secret Shop",
        websiteDomain: "secret.example.net/path",
        taxCategoryId: null,
        activityId: null,
        confidence: 0.95,
        model: "test-model",
        promptVersion: "1",
        outcome: "open",
        createdAt: "2026-09-27T00:00:00Z",
        resolvedAt: null,
      });
      const item = raise(f.ctx, {
        kind: CLASSIFY_UNCLASSIFIED_REVIEW,
        entityRef: `transaction:${txnId}`,
        dedupeKey: `classify.unclassified:${txnId}`,
        accountId: "priv1",
      }).id;

      acceptSuggestionItem(f.ctxA, { id: item });

      expect(f.uow.state.payees.find((p) => p.id === payee.id)?.websiteUrl).toBe(
        "https://secret.example.net",
      );
      expect(logoJobs(f)).toHaveLength(0);
    });

    it("does nothing when the transaction has no payee or the domain is unusable", () => {
      const f = suggestionFixture();
      const txnId = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -5000,
        description: "Mystery",
      });
      acceptSuggestionItem(f.ctxA, { id: pushSuggestion(f, txnId, "mystery-brand.com") });
      expect(f.uow.state.payees).toHaveLength(0);
      expect(logoJobs(f)).toHaveLength(0);

      const payee = createPayee(f.ctxA, { name: "Local Thing", originAccountId: "pub1" });
      const txn2 = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -4000,
        description: "Local Thing",
        payeeId: payee.id,
      });
      acceptSuggestionItem(f.ctxA, { id: pushSuggestion(f, txn2, "http://192.168.0.7/") });
      expect(f.uow.state.payees.find((p) => p.id === payee.id)?.websiteUrl).toBeNull();
      expect(logoJobs(f)).toHaveLength(0);
    });

    it("bulk accept enqueues one job per distinct payee", () => {
      const f = suggestionFixture();
      const payee1 = createPayee(f.ctxA, { name: "Store One", originAccountId: "pub1" });
      const payee2 = createPayee(f.ctxA, { name: "Store Two", originAccountId: "pub1" });
      const txn1 = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -1000,
        description: "Store One",
        payeeId: payee1.id,
      });
      const txn2 = createTransaction(f.ctxA, {
        accountId: "pub1",
        postedOn: "2026-09-27",
        amountCents: -2000,
        description: "Store Two",
        payeeId: payee2.id,
      });
      const item1 = pushSuggestion(f, txn1, "one.example.com");
      const item2 = pushSuggestion(f, txn2, "two.example.com");

      bulkAcceptSuggestions(f.ctxA, { ids: [item1, item2] });

      expect(
        logoJobs(f)
          .map((j) => j.dedupeKey)
          .sort(),
      ).toEqual([`logo:${payee1.id}`, `logo:${payee2.id}`].sort());
    });
  });
});
