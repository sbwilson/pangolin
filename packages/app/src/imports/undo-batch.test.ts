import { Temporal } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { listAccounts } from "../accounts/list-accounts.ts";
import { AppError } from "../errors.ts";
import { createIdGenerator } from "../ids.ts";
import { registerTransactionNeedsReviewSync } from "../ledger/needs-review.ts";
import { manualClock } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import type { Viewer } from "../viewer.ts";
import { importStatement } from "./import-statement.ts";
import { undoImportBatch } from "./undo-batch.ts";

registerTransactionNeedsReviewSync();

const now = Temporal.Instant.from("2026-10-20T12:00:00.000Z");

function setup() {
  const clock = manualClock("2026-10-20T12:00:00.000Z");
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
  const samPrivate = account("Sam private", true, samId);
  const viewer = (personId: typeof alexId, authAt = now): Viewer => ({
    kind: "person",
    personId,
    authAt,
  });
  const ctx = { viewer: viewer(alexId), clock, newId, uow };
  const samCtx = { viewer: viewer(samId), clock, newId, uow };
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
  const live = (accountId: string) =>
    uow.state.transactions.filter((t) => t.accountId === accountId && !uow.state.deleted.has(t.id));
  const open = (kind: string) =>
    uow.state.reviewItems.filter((i) => i.kind === kind && i.resolvedAt === null);
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return e instanceof AppError ? e.code : "other";
    }
    return "none";
  };
  return { uow, clock, ctx, samCtx, alexId, a, b, samPrivate, load, live, open, code };
}

const FIVE = [
  ["01/03/2026", "-1.00", "ONE"],
  ["02/03/2026", "-2.00", "TWO"],
  ["03/03/2026", "-3.00", "THREE"],
  ["04/03/2026", "-4.00", "FOUR"],
  ["05/03/2026", "-5.00", "FIVE"],
] as const;

describe("undoImportBatch", () => {
  it("soft-deletes every row, resolves open items and stamps undone_at", () => {
    const { uow, ctx, a, load, live, open } = setup();
    const res = load(ctx, a, FIVE);
    expect(live(a)).toHaveLength(5);
    expect(open("classify.unclassified").length).toBeGreaterThan(0);
    const out = undoImportBatch(ctx, { batchId: res.batchId });
    expect(out.undoneCount).toBe(5);
    expect(live(a)).toHaveLength(0);
    expect(uow.state.transactions).toHaveLength(5);
    expect(open("classify.unclassified")).toHaveLength(0);
    const batch = uow.state.importBatches.find((x) => x.id === res.batchId);
    expect(batch?.undoneAt).toBe("2026-10-20T12:00:00.000Z");
    const audited = uow.state.audit.filter(
      (r) => r.entity === "import_batch" && r.action === "update",
    );
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({ entityId: res.batchId, accountId: a, action: "update" });
    expect(batch?.importedByPersonId).toBe(ctx.viewer.kind === "person" && ctx.viewer.personId);
    expect(
      uow.state.audit.filter((r) => r.entity === "transaction" && r.action === "delete"),
    ).toHaveLength(5);
  });

  it("resolves the batch's set-aside item", () => {
    const { uow, ctx, a, open } = setup();
    const res = importStatement(ctx, {
      accountId: a,
      format: "commbank_csv",
      content:
        'Date,Amount,Description,Balance\n01/03/2026,-1.00,"OK",0.00\nnot-a-date,-2.00,"BAD",0.00',
    });
    expect(open("import.set_aside")).toHaveLength(1);
    undoImportBatch(ctx, { batchId: res.batchId });
    expect(open("import.set_aside")).toHaveLength(0);
    expect(uow.state.importBatches[0]?.undoneAt).not.toBeNull();
  });

  it("unlinks a transfer survivor in another account and deletes the group", () => {
    const { uow, ctx, a, b, load, live } = setup();
    load(ctx, b, [["01/03/2026", "500.00", "PAY IN"]]);
    const res = load(ctx, a, [["03/03/2026", "-500.00", "PAY OUT"]]);
    expect(uow.state.transferGroups).toHaveLength(1);
    undoImportBatch(ctx, { batchId: res.batchId });
    expect(uow.state.transferGroups).toHaveLength(0);
    const survivor = live(b);
    expect(survivor).toHaveLength(1);
    expect(survivor[0]?.transferGroupId).toBeNull();
    expect(live(a)).toHaveLength(0);
  });

  it("is NotFound for anyone but the importer, writing nothing", () => {
    const { uow, ctx, samCtx, a, load, live, code } = setup();
    const res = load(ctx, a, FIVE);
    const before = uow.state.audit.length;
    expect(code(() => undoImportBatch(samCtx, { batchId: res.batchId }))).toBe("NotFound");
    expect(code(() => undoImportBatch(ctx, { batchId: "nope" }))).toBe("NotFound");
    expect(uow.state.audit).toHaveLength(before);
    expect(live(a)).toHaveLength(5);
  });

  it("is NotFound when the account is another person's private one", () => {
    const { ctx, samCtx, samPrivate, load, code } = setup();
    const res = load(samCtx, samPrivate, FIVE);
    expect(code(() => undoImportBatch(ctx, { batchId: res.batchId }))).toBe("NotFound");
    expect(code(() => undoImportBatch(samCtx, { batchId: res.batchId }))).toBe("none");
  });

  it("asks for recent re-authentication first", () => {
    const { uow, ctx, alexId, a, load, live, code } = setup();
    const res = load(ctx, a, FIVE);
    const stale = {
      ...ctx,
      viewer: { kind: "person", personId: alexId, authAt: now.subtract({ minutes: 10 }) } as const,
    };
    expect(code(() => undoImportBatch(stale, { batchId: res.batchId }))).toBe("ReauthRequired");
    expect(live(a)).toHaveLength(5);
    expect(uow.state.importBatches[0]?.undoneAt).toBeNull();
  });

  it("refuses a second undo and a batch with no recorded importer", () => {
    const { uow, ctx, a, load, code } = setup();
    const res = load(ctx, a, FIVE);
    undoImportBatch(ctx, { batchId: res.batchId });
    expect(code(() => undoImportBatch(ctx, { batchId: res.batchId }))).toBe("Conflict");
    uow.state.importBatches = uow.state.importBatches.map((x) => ({
      ...x,
      importedByPersonId: null,
      undoneAt: null,
      reconcileStatus: null,
      reconcileGapCents: null,
      firstPostedOn: null,
      lastPostedOn: null,
    }));
    expect(code(() => undoImportBatch(ctx, { batchId: res.batchId }))).toBe("Conflict");
  });

  it("refuses the whole undo when a row sits after the account's closed date", () => {
    const { uow, ctx, a, load, live, code } = setup();
    const res = load(ctx, a, FIVE);
    uow.state.accounts = uow.state.accounts.map((x) =>
      x.id === a ? { ...x, closedOn: "2026-03-03" } : x,
    );
    expect(code(() => undoImportBatch(ctx, { batchId: res.batchId }))).toBe("Conflict");
    expect(live(a)).toHaveLength(5);
    expect(uow.state.importBatches[0]?.undoneAt).toBeNull();
  });

  it("refuses a staged or failed batch and writes nothing", () => {
    const { uow, ctx, a, load, live, code } = setup();
    const res = load(ctx, a, FIVE);
    for (const status of ["staged", "failed"] as const) {
      uow.state.importBatches = uow.state.importBatches.map((x) => ({ ...x, status }));
      const audits = uow.state.audit.length;
      expect(code(() => undoImportBatch(ctx, { batchId: res.batchId }))).toBe("Conflict");
      expect(uow.state.audit).toHaveLength(audits);
      expect(live(a)).toHaveLength(5);
      expect(uow.state.importBatches[0]?.undoneAt).toBeNull();
    }
  });

  it("keeps re-importing the same file blocked", () => {
    const { ctx, a, load, live } = setup();
    const res = load(ctx, a, FIVE);
    undoImportBatch(ctx, { batchId: res.batchId });
    const again = load(ctx, a, FIVE);
    expect(again.newCount).toBe(0);
    expect(again.transactionIds).toEqual([]);
    expect(live(a)).toHaveLength(0);
  });
});

describe("account freshness", () => {
  it("comes from the newest batch that is not undone", () => {
    const { clock, ctx, a, load } = setup();
    const first = load(ctx, a, [["01/03/2026", "-1.00", "OLD"]]);
    clock.advance(60_000);
    const second = load(ctx, a, [["20/03/2026", "-2.00", "NEW"]]);
    const view = () => listAccounts(ctx).find((x) => x.id === a);
    expect(view()?.lastImport).toEqual({
      through: "2026-03-20",
      source: "commbank_csv",
      importedAt: "2026-10-20T12:01:00.000Z",
    });
    undoImportBatch(ctx, { batchId: second.batchId });
    expect(view()?.lastImport).toEqual({
      through: "2026-03-01",
      source: "commbank_csv",
      importedAt: "2026-10-20T12:00:00.000Z",
    });
    undoImportBatch(ctx, { batchId: first.batchId });
    expect(view()?.lastImport).toBeNull();
  });

  it("is null for an account with no imports", () => {
    const { ctx, b } = setup();
    expect(listAccounts(ctx).find((x) => x.id === b)?.lastImport).toBeNull();
  });
});
