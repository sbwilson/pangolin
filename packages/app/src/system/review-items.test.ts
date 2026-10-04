import { type Id, idSchema } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, memoryContext } from "../testing/fixtures.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import {
  defineReviewKind,
  JOB_DEAD_REVIEW,
  listReviewItems,
  type RaiseReviewItemInput,
  raiseReviewItem,
  resolveReviewItem,
} from "./review-items.ts";

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
    isPrivate: false,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
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

  it("shows a person their own and the household's open items, hiding account-scoped ones", () => {
    const { ctx } = seeded();
    const asA = { ...ctx, viewer: personViewer(personA, now) };
    expect(listReviewItems(asA, {}).map((row) => row.entityRef)).toEqual(["goal:a", "thing:h"]);
    const asB = { ...ctx, viewer: personViewer(personB, now) };
    expect(listReviewItems(asB).map((row) => row.entityRef)).toEqual(["goal:b", "thing:h"]);
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
