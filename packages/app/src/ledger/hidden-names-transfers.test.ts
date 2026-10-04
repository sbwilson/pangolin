import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import type { UseCaseContext } from "../context.ts";
import { createPerson } from "../identity/create-person.ts";
import { listAudit } from "../system/list-audit.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createTransaction } from "./create-transaction.ts";
import { deleteTransaction } from "./delete-transaction.ts";
import { getTransaction } from "./get-transaction.ts";
import { hideTransactionName, unhideTransactionName } from "./hide-name.ts";
import { listTransactions } from "./list-transactions.ts";
import { createTransferGroup, deleteTransferGroup } from "./transfer-groups.ts";
import { updateTransaction } from "./update-transaction.ts";

const clock = manualClock("2026-09-27T00:00:00Z");

function setup() {
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const as = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = as(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "Ann", colour: "#000000" });
  const b = createPerson(sys, { displayName: "Bob", colour: "#ffffff" });
  const viewerOf = (id: Id<"Person">) => as(personViewer(id, clock.now()));
  const account = (name: string, isPrivate: boolean, owners: [Id<"Person">, number][]) =>
    createAccount(sys, {
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate,
      owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
    });
  const shared = account("Joint", false, [
    [a, 5000],
    [b, 5000],
  ]);
  const shared2 = account("Joint 2", false, [
    [a, 5000],
    [b, 5000],
  ]);
  const privateA = account("A private", true, [[a, 10000]]);
  const privateB = account("B private", true, [[b, 10000]]);
  const line = (ctx: UseCaseContext, accountId: string, amountCents: number, description = "x") =>
    createTransaction(ctx, { accountId, postedOn: "2026-09-01", amountCents, description });
  return { uow, sys, a, b, as: viewerOf, shared, shared2, privateA, privateB, line };
}

const code = (c: string) => expect.objectContaining({ code: c });

describe("hide and unhide a transaction name", () => {
  it("hides for 12 months by default: partner sees the placeholder, hider the name", () => {
    const { as, a, b, shared, line, uow } = setup();
    const id = line(as(a), shared, -500, "Surprise");
    const out = hideTransactionName(as(a), { id });
    expect(out.descriptionRaw).toBe("Surprise");
    expect(uow.state.transactions[0]).toMatchObject({
      nameHiddenBy: a,
      nameHiddenUntil: "2027-09-27",
    });
    const seen = getTransaction(as(b), { id });
    expect(seen.descriptionRaw).toBe("Hidden until 27 Sep 2027");
    expect(JSON.stringify(listTransactions(as(b)))).not.toContain("Surprise");
    // Amounts and notes stay visible; the partner's later private edits change nothing for them.
    expect(seen.amountCents).toBe(-500);
    updateTransaction(as(a), { id, description: "Renamed" });
    expect(JSON.stringify(getTransaction(as(b), { id }))).not.toContain("Renamed");
  });

  it("shows the name again once the day arrives, without a write", () => {
    const { as, a, b, shared, line } = setup();
    const id = line(as(a), shared, -500, "Surprise");
    hideTransactionName(as(a), { id, until: "2026-09-28" });
    expect(getTransaction(as(b), { id }).descriptionRaw).toBe("Hidden until 28 Sep 2026");
    clock.set("2026-09-28T00:00:00Z");
    try {
      expect(getTransaction(as(b), { id }).descriptionRaw).toBe("Surprise");
    } finally {
      clock.set("2026-09-27T00:00:00Z");
    }
  });

  it("rejects a day over the cap, today, the past, a bad date and a private account", () => {
    const { as, a, shared, privateA, line, uow } = setup();
    const id = line(as(a), shared, -500);
    const mine = line(as(a), privateA, -500);
    for (const until of ["2027-09-28", "2026-09-27", "2026-09-26", "2026-02-30", "soon"]) {
      expect(() => hideTransactionName(as(a), { id, until })).toThrow(code("Validation"));
    }
    expect(hideTransactionName(as(a), { id, until: "2027-09-27" }).id).toBe(id);
    expect(() => hideTransactionName(as(a), { id: mine })).toThrow(code("Validation"));
    expect(uow.state.transactions.find((t) => t.id === mine)?.nameHiddenUntil).toBeNull();
  });

  it("lets the hider re-hide (restarting the clock) and unhide, and refuses the partner", () => {
    const { as, a, b, shared, line, uow } = setup();
    const id = line(as(a), shared, -500, "Surprise");
    hideTransactionName(as(a), { id, until: "2026-12-01" });
    expect(() => hideTransactionName(as(b), { id })).toThrow(code("Conflict"));
    expect(() => unhideTransactionName(as(b), { id })).toThrow(code("Conflict"));
    expect(uow.state.transactions[0]).toMatchObject({
      nameHiddenBy: a,
      nameHiddenUntil: "2026-12-01",
    });
    hideTransactionName(as(a), { id, until: "2027-01-01" });
    expect(uow.state.transactions[0]?.nameHiddenUntil).toBe("2027-01-01");
    unhideTransactionName(as(a), { id });
    expect(uow.state.transactions[0]).toMatchObject({ nameHiddenBy: null, nameHiddenUntil: null });
    expect(getTransaction(as(b), { id }).descriptionRaw).toBe("Surprise");
    // No-op unhide writes and audits nothing.
    const audits = uow.state.audit.length;
    expect(unhideTransactionName(as(b), { id }).id).toBe(id);
    expect(uow.state.audit.length).toBe(audits);
  });

  it("lets anyone replace a lapsed hiding", () => {
    const { as, a, b, shared, line, uow } = setup();
    const id = line(as(a), shared, -500);
    const row = uow.state.transactions[0];
    if (row === undefined) throw new Error("missing");
    uow.state.transactions[0] = { ...row, nameHiddenBy: a, nameHiddenUntil: "2026-09-27" };
    hideTransactionName(as(b), { id });
    expect(uow.state.transactions[0]).toMatchObject({
      nameHiddenBy: b,
      nameHiddenUntil: "2027-09-27",
    });
  });

  it("treats a partner-private, missing or deleted transaction as NotFound", () => {
    const { as, a, b, privateA, line } = setup();
    const mine = line(as(a), privateA, -500);
    expect(() => hideTransactionName(as(b), { id: mine })).toThrow(code("NotFound"));
    expect(() => unhideTransactionName(as(b), { id: mine })).toThrow(code("NotFound"));
    expect(() => hideTransactionName(as(a), { id: "nope" })).toThrow(code("NotFound"));
  });

  it("treats a soft-deleted transaction as NotFound for hide, unhide and linking", () => {
    const { as, a, shared, shared2, line } = setup();
    const gone = line(as(a), shared, -500);
    const live = line(as(a), shared2, 500);
    deleteTransaction(as(a), { id: gone });
    expect(() => hideTransactionName(as(a), { id: gone })).toThrow(code("NotFound"));
    expect(() => unhideTransactionName(as(a), { id: gone })).toThrow(code("NotFound"));
    expect(() => createTransferGroup(as(a), { transactionIds: [gone, live] })).toThrow(
      code("NotFound"),
    );
  });

  it("hides the real description from the partner's audit, including the hide's own rows", () => {
    const { as, a, b, shared, line } = setup();
    const id = line(as(a), shared, -500, "Surprise");
    hideTransactionName(as(a), { id });
    updateTransaction(as(a), { id, description: "Other secret" });
    const forB = JSON.stringify(listAudit(as(b)));
    expect(forB).not.toContain("Surprise");
    expect(forB).not.toContain("Other secret");
    expect(JSON.stringify(listAudit(as(a)))).toContain("Other secret");
  });

  it("audits each write with accountId, before and after", () => {
    const { as, a, b, shared, line, sys } = setup();
    const id = line(as(a), shared, -500, "Surprise");
    hideTransactionName(as(a), { id });
    unhideTransactionName(as(a), { id });
    const rows = listAudit(sys).filter((r) => r.entityId === id && r.action === "update");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.accountId === shared)).toBe(true);
    const [hide, unhide] = rows.map((r) => ({
      before: JSON.parse(r.before ?? "{}"),
      after: JSON.parse(r.after ?? "{}"),
    }));
    expect(hide?.before.nameHiddenBy).toBeNull();
    expect(hide?.after).toMatchObject({ nameHiddenBy: a, nameHiddenUntil: "2027-09-27" });
    expect(unhide?.after.nameHiddenUntil).toBeNull();
    expect(b).toBeDefined();
  });
});

describe("transfer groups", () => {
  it("links two opposite transactions and clears them again", () => {
    const { as, a, b, shared, shared2, line, uow } = setup();
    const out = line(as(a), shared, -1000);
    const into = line(as(a), shared2, 1000);
    const pair = createTransferGroup(as(a), { transactionIds: [out, into] });
    expect(pair.map((t) => t.id)).toEqual([out, into]);
    const groupId = pair[0]?.transferGroupId;
    expect(groupId).toBeTruthy();
    expect(pair[1]?.transferGroupId).toBe(groupId);
    expect(uow.state.transferGroups).toHaveLength(1);
    expect(uow.state.transferGroups[0]?.matchedBy).toBe("manual");
    deleteTransferGroup(as(b), { id: groupId as string });
    expect(uow.state.transferGroups).toHaveLength(0);
    expect(getTransaction(as(a), { id: out }).transferGroupId).toBeNull();
    expect(getTransaction(as(a), { id: into }).transferGroupId).toBeNull();
    expect(() => deleteTransferGroup(as(a), { id: groupId as string })).toThrow(code("NotFound"));
  });

  it("validates shape, accounts and amounts, and conflicts on an existing group", () => {
    const { as, a, shared, shared2, line, uow } = setup();
    const x = line(as(a), shared, -1000);
    const sameAccount = line(as(a), shared, 1000);
    const sameSign = line(as(a), shared2, -1000);
    const off = line(as(a), shared2, 900);
    const zero1 = line(as(a), shared, 0);
    const zero2 = line(as(a), shared2, 0);
    const ok = line(as(a), shared2, 1000);
    for (const ids of [
      [x, x],
      [x, sameAccount],
      [x, sameSign],
      [x, off],
      [zero1, zero2],
    ]) {
      expect(() => createTransferGroup(as(a), { transactionIds: ids as never })).toThrow(
        code("Validation"),
      );
    }
    expect(() => createTransferGroup(as(a), { transactionIds: [x] as never })).toThrow(
      code("Validation"),
    );
    expect(() => createTransferGroup(as(a), { transactionIds: [x, "nope"] })).toThrow(
      code("NotFound"),
    );
    expect(uow.state.transferGroups).toHaveLength(0);
    createTransferGroup(as(a), { transactionIds: [x, ok] });
    const another = line(as(a), shared2, 1000);
    expect(() => createTransferGroup(as(a), { transactionIds: [x, another] })).toThrow(
      code("Conflict"),
    );
    expect(uow.state.transferGroups).toHaveLength(1);
  });

  it("links a private transaction to a shared one; the partner reads a transfer label only", () => {
    const { as, a, b, shared, privateA, line, sys } = setup();
    const sharedSide = line(as(a), shared, 2500, "Top up");
    const privateSide = line(as(a), privateA, -2500, "Secret savings");
    // The partner cannot link to a private row they cannot see.
    expect(() => createTransferGroup(as(b), { transactionIds: [sharedSide, privateSide] })).toThrow(
      code("NotFound"),
    );
    createTransferGroup(as(a), { transactionIds: [sharedSide, privateSide] });
    const seen = getTransaction(as(b), { id: sharedSide });
    expect(seen.transferLabel).toBe("Transfer from Ann");
    const all = JSON.stringify(listTransactions(as(b)));
    expect(all).not.toContain("Secret savings");
    expect(all).not.toContain(privateSide);
    expect(JSON.stringify(listAudit(as(b)))).not.toContain("Secret savings");
    expect(
      listAudit(sys).filter((r) => r.accountId === privateA && r.action === "update"),
    ).toHaveLength(1);
  });

  it("reads Transfer to <owner> for an outflow whose counterpart is private", () => {
    const { as, a, b, shared, privateA, line } = setup();
    const out = line(as(a), shared, -2500);
    const into = line(as(a), privateA, 2500);
    createTransferGroup(as(a), { transactionIds: [out, into] });
    expect(getTransaction(as(b), { id: out }).transferLabel).toBe("Transfer to Ann");
  });

  it("keeps the private member's description out of the partner's audit after a group delete", () => {
    const { as, a, b, shared, privateA, line } = setup();
    const sharedSide = line(as(a), shared, 2500, "Top up");
    const privateSide = line(as(a), privateA, -2500, "Secret savings");
    const [first] = createTransferGroup(as(a), { transactionIds: [sharedSide, privateSide] });
    deleteTransferGroup(as(b), { id: first.transferGroupId as string });
    const forB = JSON.stringify(listAudit(as(b)));
    expect(forB).not.toContain("Secret savings");
    expect(forB).not.toContain(privateSide);
  });

  it("deletes a group whose other member the viewer cannot see", () => {
    const { as, a, b, shared, privateA, line, uow } = setup();
    const sharedSide = line(as(a), shared, 2500);
    const privateSide = line(as(a), privateA, -2500);
    const [pair] = [createTransferGroup(as(a), { transactionIds: [sharedSide, privateSide] })];
    const groupId = pair[0].transferGroupId as string;
    deleteTransferGroup(as(b), { id: groupId });
    expect(uow.state.transactions.every((t) => t.transferGroupId === null)).toBe(true);
    expect(uow.state.transferGroups).toHaveLength(0);
  });

  it("audits each affected transaction with accountId, before and after", () => {
    const { as, a, shared, shared2, line, sys } = setup();
    const x = line(as(a), shared, -1000);
    const y = line(as(a), shared2, 1000);
    const [pair] = [createTransferGroup(as(a), { transactionIds: [x, y] })];
    const groupId = pair[0].transferGroupId;
    deleteTransferGroup(as(a), { id: groupId as string });
    const rows = listAudit(sys).filter((r) => r.action === "update");
    expect(rows).toHaveLength(4);
    const byTxn = (id: string) => rows.filter((r) => r.entityId === id);
    for (const [id, accountId] of [
      [x, shared],
      [y, shared2],
    ] as const) {
      const [link, unlink] = byTxn(id);
      expect(link?.accountId).toBe(accountId);
      expect(JSON.parse(link?.before ?? "{}").transferGroupId).toBeNull();
      expect(JSON.parse(link?.after ?? "{}").transferGroupId).toBe(groupId);
      expect(JSON.parse(unlink?.before ?? "{}").transferGroupId).toBe(groupId);
      expect(JSON.parse(unlink?.after ?? "{}").transferGroupId).toBeNull();
    }
  });
});
