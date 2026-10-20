import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";
import {
  dismissTransferAmbiguity,
  keepProbableDuplicate,
  removeProbableDuplicate,
} from "./match-transfers.ts";
import { fixSetAsideRow } from "./set-aside.ts";

registerTransactionNeedsReviewSync();

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");
const clock = manualClock("2026-10-20T12:00:00.000Z");

function setup() {
  let ms = 1792400000000;
  const newId = createIdGenerator({ now: () => ++ms, random: () => 0.5 });
  const uow = memoryUnitOfWork();
  const alexId = newId<"Person">();
  const samId = newId<"Person">();
  const stamp = now.toString();
  for (const [id, name] of [
    [alexId, "Alex"],
    [samId, "Sam"],
  ] as const) {
    uow.state.people.push({
      id,
      userId: `user-${name}`,
      displayName: name,
      colour: "#ff0000",
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
    });
  }
  const account = (name: string, isPrivate: boolean, owner: typeof alexId) => {
    const id = newId<"Account">();
    uow.state.accounts.push({
      id,
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate,
      institutionId: null,
      openedOn: "2024-01-01",
      closedOn: null,
      isSavings: false,
      createdAt: stamp,
      updatedAt: stamp,
    });
    uow.state.accountOwners.push({
      accountId: id,
      personId: owner,
      shareBp: 10000,
      createdAt: stamp,
      updatedAt: stamp,
    });
    return id;
  };
  const a = account("A", false, alexId);
  const b = account("B", false, alexId);
  const c = account("C", false, alexId);
  const samPrivate = account("Sam private", true, samId);
  const alexViewer: Viewer = { kind: "person", personId: alexId, authAt: now };
  const samViewer: Viewer = { kind: "person", personId: samId, authAt: now };
  const ctx = { viewer: alexViewer, clock, newId, uow };
  const samCtx = { viewer: samViewer, clock, newId, uow };
  const load = (
    who: typeof ctx,
    accountId: typeof a,
    rows: readonly (readonly [string, string, string])[],
  ) =>
    importStatement(who, {
      accountId,
      format: "commbank_csv",
      content: `Date,Amount,Description,Balance\n${rows
        .map(([d, amt, desc]) => `${d},${amt},"${desc}",0.00`)
        .join("\n")}`,
    });
  const open = (kind: string) =>
    uow.state.reviewItems.filter((i) => i.kind === kind && i.resolvedAt === null);
  return { uow, ctx, samCtx, a, b, c, samPrivate, load, open };
}

describe("transfer matching", () => {
  it("links a unique pair in one auto group and audits both sides", () => {
    const { uow, ctx, a, b, load, open } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN"]]);
    load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(1);
    expect(uow.state.transferGroups[0]?.matchedBy).toBe("auto");
    const ids = uow.state.transactions.map((t) => t.transferGroupId);
    expect(ids.every((g) => g === uow.state.transferGroups[0]?.id)).toBe(true);
    const updates = uow.state.audit.filter(
      (r) => r.entity === "transaction" && r.action === "update",
    );
    expect(updates.map((r) => r.accountId).sort()).toEqual([a, b].sort());
    expect(open("import.transfer_ambiguous")).toHaveLength(0);
  });

  it("links when the second leg is imported later, in either order", () => {
    const { uow, ctx, a, b, load } = setup();
    load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(0);
    load(ctx, b, [["04/03/2026", "500.00", "PAY IN"]]);
    expect(uow.state.transferGroups).toHaveLength(1);
  });

  it("does not link an ambiguous match and raises one item per new transaction", () => {
    const { uow, ctx, a, b, c, load, open } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN B"]]);
    load(ctx, c, [["02/03/2026", "500.00", "PAY IN C"]]);
    const res = load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(0);
    const items = open("import.transfer_ambiguous");
    expect(items).toHaveLength(1);
    expect(items[0]?.entityRef).toBe(`transaction:${res.transactionIds[0]}`);
    expect(uow.state.transactions.find((t) => t.id === res.transactionIds[0])?.needsReview).toBe(
      true,
    );
  });

  it("is ambiguous when two new rows both fit one existing leg", () => {
    const { uow, ctx, a, b, load, open } = setup();
    load(ctx, b, [["02/03/2026", "500.00", "PAY IN"]]);
    load(ctx, a, [
      ["01/03/2026", "-500.00", "OUT ONE"],
      ["03/03/2026", "-500.00", "OUT TWO"],
    ]);
    expect(uow.state.transferGroups).toHaveLength(0);
    expect(open("import.transfer_ambiguous")).toHaveLength(2);
  });

  it("can dismiss an ambiguity", () => {
    const { ctx, a, b, c, load, open } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN B"]]);
    load(ctx, c, [["02/03/2026", "500.00", "PAY IN C"]]);
    const res = load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    dismissTransferAmbiguity(ctx, { transactionId: res.transactionIds[0] as string });
    expect(open("import.transfer_ambiguous")).toHaveLength(0);
  });

  it("ignores an opposite amount four days away", () => {
    const { uow, ctx, a, b, load, open } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN"]]);
    load(ctx, a, [["05/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(0);
    expect(open("import.transfer_ambiguous")).toHaveLength(0);
  });

  it("ignores a candidate in an account closed before its date", () => {
    const { uow, ctx, a, b, load, open } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN"]]);
    uow.state.accounts = uow.state.accounts.map((x) =>
      x.id === b ? { ...x, closedOn: "2026-02-01" } : x,
    );
    load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(0);
    expect(open("import.transfer_ambiguous")).toHaveLength(0);
  });

  it("never matches a partner's private account", () => {
    const { uow, ctx, samCtx, a, samPrivate, load, open } = setup();
    load(samCtx, samPrivate, [["01/03/2026", "500.00", "PAY IN"]]);
    load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(0);
    expect(open("import.transfer_ambiguous")).toHaveLength(0);
  });
});

describe("probable duplicates", () => {
  it("flags a one-day shift and lets the person keep or remove it", () => {
    const { uow, ctx, a, load, open } = setup();
    load(ctx, a, [["02/03/2026", "-4.50", "CAFE"]]);
    const res = load(ctx, a, [["03/03/2026", "-4.50", "CAFE"]]);
    const items = open("import.probable_duplicate");
    expect(items).toHaveLength(1);
    expect(items[0]?.entityRef).toBe(`transaction:${res.transactionIds[0]}`);
    expect(uow.state.transactions.find((t) => t.id === res.transactionIds[0])?.needsReview).toBe(
      true,
    );
    // The row is also unclassified; settle that item so only the duplicate flag holds needsReview.
    uow.state.reviewItems = uow.state.reviewItems.map((i) =>
      i.kind === "classify.unclassified"
        ? { ...i, resolvedAt: now.toString(), resolution: "x" }
        : i,
    );
    keepProbableDuplicate(ctx, { transactionId: res.transactionIds[0] as string });
    expect(open("import.probable_duplicate")).toHaveLength(0);
    expect(uow.state.transactions.find((t) => t.id === res.transactionIds[0])?.needsReview).toBe(
      false,
    );
    expect(() =>
      keepProbableDuplicate(ctx, { transactionId: res.transactionIds[0] as string }),
    ).toThrow(AppError);
  });

  it("removes a flagged duplicate", () => {
    const { uow, ctx, a, load, open } = setup();
    load(ctx, a, [["02/03/2026", "-4.50", "CAFE"]]);
    const res = load(ctx, a, [["03/03/2026", "-4.50", "CAFE"]]);
    const id = res.transactionIds[0] as string;
    removeProbableDuplicate(ctx, { transactionId: id });
    expect(uow.state.deleted.has(id)).toBe(true);
    expect(open("import.probable_duplicate")).toHaveLength(0);
    expect(
      uow.state.reviewItems.filter(
        (i) => i.entityRef === `transaction:${id}` && i.resolvedAt === null,
      ),
    ).toHaveLength(0);
  });

  it("does not flag genuine consecutive coffees in one statement", () => {
    const { ctx, a, load, open } = setup();
    load(ctx, a, [["02/03/2026", "-4.50", "CAFE"]]);
    load(ctx, a, [
      ["02/03/2026", "-4.50", "CAFE"],
      ["03/03/2026", "-4.50", "CAFE"],
    ]);
    expect(open("import.probable_duplicate")).toHaveLength(0);
  });

  it("does not flag same-day twins", () => {
    const { uow, ctx, a, load, open } = setup();
    load(ctx, a, [
      ["02/03/2026", "-4.50", "CAFE"],
      ["02/03/2026", "-4.50", "CAFE"],
    ]);
    expect(uow.state.transactions).toHaveLength(2);
    expect(open("import.probable_duplicate")).toHaveLength(0);
  });
});

describe("idempotence", () => {
  it("re-importing the same file adds no rows, links or items", () => {
    const { uow, ctx, a, b, load } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN"]]);
    const rows = [
      ["03/03/2026", "-500.00", "PAY OUT"],
      ["02/03/2026", "-4.50", "CAFE"],
      ["03/03/2026", "-4.50", "CAFE"],
    ] as const;
    load(ctx, a, rows);
    const snapshot = () => [
      uow.state.transactions.length,
      uow.state.transferGroups.length,
      uow.state.reviewItems.length,
    ];
    const before = snapshot();
    load(ctx, a, rows);
    expect(snapshot()).toEqual(before);
  });
});

describe("fixSetAsideRow", () => {
  function seedSetAside(t: ReturnType<typeof setup>, accountId: string): { rowId: string } {
    const stamp = now.toString();
    const batchId = `${t.uow.state.importBatches.length}-b`;
    const rowId = `${batchId}-r`;
    t.uow.state.importBatches.push({
      id: batchId,
      accountId,
      source: "commbank_csv",
      fileSha256: `sha-${batchId}`,
      rowCount: 1,
      newCount: 0,
      dupCount: 0,
      status: "committed",
      createdAt: stamp,
      updatedAt: stamp,
    } as never);
    t.uow.state.importRows.push({
      id: rowId,
      batchId,
      rowNumber: 1,
      rawLine: "bad",
      status: "set_aside",
      reason: "Invalid",
      pdfPage: null,
      createdAt: stamp,
      updatedAt: stamp,
    } as never);
    return { rowId };
  }

  it("auto-links a fixed row to an opposite unlinked transaction in another account", () => {
    const t = setup();
    t.load(t.ctx, t.b, [["01/03/2026", "500.00", "PAY IN"]]);
    const { rowId } = seedSetAside(t, t.a);
    fixSetAsideRow(t.ctx, {
      rowId,
      postedOn: "2026-03-03",
      amountCents: -50000,
      description: "PAY OUT",
    });
    expect(t.uow.state.transferGroups).toHaveLength(1);
    expect(t.uow.state.transferGroups[0]?.matchedBy).toBe("auto");
    expect(t.uow.state.transactions.every((x) => x.transferGroupId !== null)).toBe(true);
  });

  it("flags a fixed row that looks like an existing transaction", () => {
    const t = setup();
    t.load(t.ctx, t.a, [["02/03/2026", "-4.50", "CAFE"]]);
    const { rowId } = seedSetAside(t, t.a);
    const res = fixSetAsideRow(t.ctx, {
      rowId,
      postedOn: "2026-03-03",
      amountCents: -450,
      description: "CAFE",
    });
    const items = t.open("import.probable_duplicate");
    expect(items).toHaveLength(1);
    expect(items[0]?.entityRef).toBe(`transaction:${res.transactionId}`);
    expect(t.uow.state.transactions.find((x) => x.id === res.transactionId)?.needsReview).toBe(
      true,
    );
  });
});
