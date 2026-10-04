import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createTransaction } from "./create-transaction.ts";
import { listTransactions } from "./list-transactions.ts";

const clock = manualClock("2026-09-27T00:00:00Z");

function setup() {
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const as = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = as(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "A", colour: "#000000" });
  const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const viewerOf = (id: Id<"Person">) => as(personViewer(id, clock.now()));
  const shared = createAccount(sys, {
    name: "Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [
      { personId: a, shareBp: 5000 },
      { personId: b, shareBp: 5000 },
    ],
  });
  const privateA = createAccount(sys, {
    name: "A private",
    type: "savings",
    currency: "AUD",
    isPrivate: true,
    owners: [{ personId: a, shareBp: 10000 }],
  });
  return { uow, sys, a, b, as: viewerOf, shared, privateA };
}

const txn = (accountId: string, description = "Coffee") => ({
  accountId,
  postedOn: "2026-09-01",
  amountCents: -450,
  description,
});

describe("accounts.createAccount", () => {
  it("audits the create with the account's id", () => {
    const { uow, shared } = setup();
    const entry = uow.state.audit.find(
      (row) => row.entity === "account" && row.entityId === shared,
    );
    expect(entry).toMatchObject({ action: "create", accountId: shared, actor: "cli:test" });
    expect(JSON.parse(entry?.after ?? "{}")).toMatchObject({ name: "Joint", isPrivate: false });
  });

  it("refuses a private account with two owners, bad shares, an unknown owner or another currency", () => {
    const { sys, a, b } = setup();
    const base = { name: "X", type: "savings", currency: "AUD" } as const;
    const bad = [
      {
        ...base,
        isPrivate: true,
        owners: [
          { personId: a, shareBp: 5000 },
          { personId: b, shareBp: 5000 },
        ],
      },
      { ...base, isPrivate: false, owners: [{ personId: a, shareBp: 4000 }] },
      { ...base, isPrivate: false, owners: [{ personId: "nobody", shareBp: 10000 }] },
      { ...base, currency: "USD", isPrivate: false, owners: [{ personId: a, shareBp: 10000 }] },
    ];
    for (const input of bad) {
      expect(() => createAccount(sys, input)).toThrow(AppError);
    }
  });

  it("refuses a person making a private account for someone else", () => {
    const { as, a, b } = setup();
    expect(() =>
      createAccount(as(a), {
        name: "X",
        type: "savings",
        currency: "AUD",
        isPrivate: true,
        owners: [{ personId: b, shareBp: 10000 }],
      }),
    ).toThrow(/yourself/);
  });
});

describe("ledger.createTransaction and listTransactions", () => {
  it("returns shared transactions to both partners and a private account's only to its owner", () => {
    const { as, a, b, shared, privateA } = setup();
    createTransaction(as(a), txn(shared, "Groceries"));
    createTransaction(as(a), txn(privateA, "Secret"));
    const names = (id: Id<"Person">) => listTransactions(as(id)).map((row) => row.descriptionRaw);
    expect(names(a).sort()).toEqual(["Groceries", "Secret"]);
    expect(names(b)).toEqual(["Groceries"]);
  });

  it("gives a private account's split the owner as beneficiary, and a shared one 'shared'", () => {
    const { as, a, shared, privateA } = setup();
    createTransaction(as(a), txn(shared));
    createTransaction(as(a), txn(privateA));
    const rows = listTransactions(as(a));
    const byAccount = (id: string) => rows.find((row) => row.accountId === id);
    expect(byAccount(privateA)?.splits.map((s) => s.beneficiary)).toEqual([a]);
    expect(byAccount(shared)?.splits.map((s) => s.beneficiary)).toEqual(["shared"]);
    expect(byAccount(shared)?.splits[0]?.amountCents).toBe(-450);
  });

  it("answers NotFound to another person's private account, and to a missing one", () => {
    const { uow, as, b, privateA } = setup();
    const before = uow.state.audit.length;
    for (const accountId of [privateA, "01J99999999999999999999999"]) {
      try {
        createTransaction(as(b), txn(accountId));
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ code: "NotFound" });
      }
    }
    expect(uow.state.transactions).toHaveLength(0);
    expect(uow.state.audit).toHaveLength(before);
  });

  it("audits the create with the account id, and rolls back when the audit fails", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const entry = uow.state.audit.find((row) => row.entity === "transaction");
    expect(entry).toMatchObject({ entityId: id, accountId: shared, action: "create" });
    uow.failAudit = true;
    expect(() => createTransaction(as(a), txn(shared))).toThrow();
    expect(uow.state.transactions).toHaveLength(1);
  });

  it("validates input", () => {
    const { as, a, shared } = setup();
    expect(() => createTransaction(as(a), { ...txn(shared), postedOn: "2026-02-30" })).toThrow(
      AppError,
    );
    expect(() => createTransaction(as(a), { ...txn(shared), amountCents: 1.5 })).toThrow(AppError);
  });

  it("lists newest first", () => {
    const { as, a, shared } = setup();
    createTransaction(as(a), { ...txn(shared, "old"), postedOn: "2026-01-01" });
    createTransaction(as(a), { ...txn(shared, "new"), postedOn: "2026-03-01" });
    expect(listTransactions(as(a)).map((row) => row.descriptionRaw)).toEqual(["new", "old"]);
  });
});
