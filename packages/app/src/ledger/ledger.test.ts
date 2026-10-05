import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import { createPayee } from "../classify/payees.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { createPerson } from "../identity/create-person.ts";
import { listAudit } from "../system/list-audit.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { write } from "../write.ts";
import { createTransaction } from "./create-transaction.ts";
import { deleteTransaction } from "./delete-transaction.ts";
import { fingerprintManual, MANUAL_FINGERPRINT_VERSION } from "./fingerprint.ts";
import { getTransaction } from "./get-transaction.ts";
import { listTransactions } from "./list-transactions.ts";
import { transactionEntityRef } from "./needs-review.ts";
import { updateTransaction } from "./update-transaction.ts";

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

describe("ledger.createTransaction with a payee", () => {
  it("sets the payee, audited with the transaction", () => {
    const { as, a, b, shared, uow } = setup();
    const payee = createPayee(as(a), { name: "Woolworths" });
    const id = createTransaction(as(a), { ...txn(shared), payeeId: payee.id });
    for (const viewer of [a, b]) {
      expect(getTransaction(as(viewer), { id })).toMatchObject({
        payeeId: payee.id,
        payeeName: "Woolworths",
      });
    }
    const entry = uow.state.audit.find(
      (row) => row.entity === "transaction" && row.entityId === id,
    );
    expect(JSON.parse(entry?.after ?? "{}")).toMatchObject({ payeeId: payee.id });
    expect(getTransaction(as(a), { id: createTransaction(as(a), txn(shared)) }).payeeId).toBeNull();
  });

  it("answers NotFound for an unknown payee or another person's owner-only one", () => {
    const { as, a, b, privateA, shared } = setup();
    expect(() => createTransaction(as(a), { ...txn(shared), payeeId: "nope" })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    const mine = createPayee(as(a), { name: "Book shop", originAccountId: privateA });
    expect(() => createTransaction(as(b), { ...txn(shared), payeeId: mine.id })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    // The owner can use it in their own private account, not in a shared one yet.
    expect(createTransaction(as(a), { ...txn(privateA), payeeId: mine.id })).toBeTruthy();
    expect(() => createTransaction(as(a), { ...txn(shared), payeeId: mine.id })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
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
    expect(() => createTransaction(as(a), txn(shared, "Lunch"))).toThrow("audit append failed");
    expect(uow.state.transactions).toHaveLength(1);
    expect(uow.state.transactions.map((row) => row.descriptionRaw)).toEqual(["Coffee"]);
  });

  it("stamps a version 2 manual fingerprint and lets identical lines coexist", () => {
    const { uow, as, a, shared, privateA } = setup();
    const first = createTransaction(as(a), txn(shared));
    const second = createTransaction(as(a), txn(shared));
    const [one, two] = [first, second].map((id) => uow.state.transactions.find((r) => r.id === id));
    expect(one?.fingerprintVersion).toBe(MANUAL_FINGERPRINT_VERSION);
    expect(one?.fingerprint).toBe(fingerprintManual(shared, first));
    expect(two?.fingerprint).toBe(fingerprintManual(shared, second));
    expect(one?.fingerprint).not.toBe(two?.fingerprint);
    createTransaction(as(a), txn(shared, "Tea"));
    createTransaction(as(a), txn(privateA));
    expect(uow.state.transactions).toHaveLength(4);
    expect(listTransactions(as(a))).toHaveLength(4);
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

describe("audit scope", () => {
  it("gives every audit row written by the accounts and ledger use cases an account id", () => {
    const { uow, as, a, shared, privateA } = setup();
    createTransaction(as(a), txn(shared));
    createTransaction(as(a), txn(privateA, "Tea"));
    const rows = uow.state.audit.filter(
      (r) => r.entity === "account" || r.entity === "transaction",
    );
    expect(rows.map((r) => r.entity).sort()).toEqual([
      "account",
      "account",
      "transaction",
      "transaction",
    ]);
    for (const row of rows) expect(row.accountId).not.toBeNull();
  });

  it("lists audit rows by account scope, redacting the partner's entries about a hidden name", () => {
    const { uow, as, a, b, shared, privateA } = setup();
    const id = createTransaction(as(a), txn(shared, "Surprise"));
    createTransaction(as(a), txn(privateA, "Tea"));
    const row = uow.state.transactions.find((r) => r.id === id);
    if (row === undefined) throw new Error("missing");
    uow.state.transactions[uow.state.transactions.indexOf(row)] = {
      ...row,
      nameHiddenBy: a,
      nameHiddenUntil: "2027-03-12",
    };
    const forB = listAudit(as(b));
    expect(forB.some((r) => r.accountId === privateA)).toBe(false);
    expect(JSON.stringify(forB)).not.toContain("Surprise");
    const entry = forB.find((r) => r.entityId === id);
    expect(JSON.parse(entry?.after ?? "{}").descriptionRaw).toBe("Hidden until 12 Mar 2027");
    expect(JSON.stringify(listAudit(as(a)))).toContain("Surprise");
  });

  it("redacts from an audit row's own after state once the live hide is gone", () => {
    const { uow, as, a, b, shared } = setup();
    const id = createTransaction(as(a), txn(shared, "Real"));
    uow.state.audit.push({
      id: "AU9" as never,
      at: "2999-01-01T00:00:00.000Z",
      actor: "x",
      entity: "transaction",
      entityId: id,
      accountId: shared,
      personId: null,
      action: "update",
      before: null,
      after: JSON.stringify({
        descriptionRaw: "Secret name",
        payeeId: "P9",
        nameHiddenBy: a,
        nameHiddenUntil: "2999-03-12",
      }),
    });
    const seen = listAudit(as(b)).find((r) => r.id === ("AU9" as never));
    expect(seen?.hiddenUntil).toBe("2999-03-12");
    const json = JSON.parse(seen?.after ?? "{}");
    expect(json.descriptionRaw).toBe("Hidden until 12 Mar 2999");
    // The key is kept (nulled by the projection) and labelled; none is added.
    expect(json.payeeId).toBe("Hidden until 12 Mar 2999");
    expect(json.fingerprint).toBeUndefined();
    const own = listAudit(as(a)).find((r) => r.id === ("AU9" as never));
    expect(own?.hiddenUntil).toBeNull();
    expect(JSON.parse(own?.after ?? "{}").descriptionRaw).toBe("Secret name");
  });

  it("renders the placeholder in the list for the partner, and the real name for the hider", () => {
    const { uow, as, a, b, shared } = setup();
    const id = createTransaction(as(a), txn(shared, "Surprise"));
    const row = uow.state.transactions.find((r) => r.id === id);
    if (row === undefined) throw new Error("missing");
    uow.state.transactions[uow.state.transactions.indexOf(row)] = {
      ...row,
      nameHiddenBy: a,
      nameHiddenUntil: "2026-09-27",
    };
    // Lifts on the date itself.
    expect(listTransactions(as(b))[0]?.descriptionRaw).toBe("Surprise");
    uow.state.transactions[0] = { ...row, nameHiddenBy: a, nameHiddenUntil: "2026-09-28" };
    expect(listTransactions(as(b))[0]?.descriptionRaw).toBe("Hidden until 28 Sep 2026");
    expect(listTransactions(as(a))[0]?.descriptionRaw).toBe("Surprise");
  });
});

const TXN_REVIEW = defineReviewKind({
  kind: "ledger.test-review",
  module: "ledger",
  scope: "account",
});

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("ledger.updateTransaction", () => {
  it("edits a manual row, its split amount and audits once with the account id", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const fingerprint = uow.state.transactions[0]?.fingerprint;
    const audits = uow.state.audit.length;
    const out = updateTransaction(as(a), {
      id,
      postedOn: "2026-09-05",
      amountCents: -999,
      description: "Latte",
    });
    expect(out).toMatchObject({
      postedOn: "2026-09-05",
      amountCents: -999,
      descriptionRaw: "Latte",
    });
    expect(out.splits.map((s) => s.amountCents)).toEqual([-999]);
    expect(uow.state.transactions[0]).toMatchObject({ fingerprint, status: "posted" });
    expect(uow.state.audit).toHaveLength(audits + 1);
    const entry = uow.state.audit.at(-1);
    expect(entry).toMatchObject({ entity: "transaction", action: "update", accountId: shared });
    expect(JSON.parse(entry?.before ?? "{}")).toMatchObject({ amountCents: -450 });
    expect(JSON.parse(entry?.before ?? "{}").splits[0].amountCents).toBe(-450);
    expect(JSON.parse(entry?.after ?? "{}").splits[0].amountCents).toBe(-999);
  });

  it("refuses date, amount and description on an imported row, but allows notes", () => {
    const { uow, as, a, b, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const i = uow.state.transactions.findIndex((r) => r.id === id);
    const row = uow.state.transactions[i];
    if (row === undefined) throw new Error("missing");
    for (const link of [{ importId: "IMP1" }, { externalId: "EXT1" }]) {
      uow.state.transactions[i] = { ...row, importId: null, externalId: null, ...link };
      for (const change of [{ postedOn: "2026-09-02" }, { amountCents: 1 }, { description: "x" }]) {
        expect(codeOf(() => updateTransaction(as(a), { id, ...change }))).toBe("Conflict");
      }
    }
    const audits = uow.state.audit.length;
    updateTransaction(as(a), { id, notes: "Reimbursed by work" });
    expect(uow.state.audit).toHaveLength(audits + 1);
    expect(getTransaction(as(b), { id }).notes).toBe("Reimbursed by work");
    expect(updateTransaction(as(a), { id, notes: null }).notes).toBeNull();
    expect(codeOf(() => updateTransaction(as(a), { id, notes: "x".repeat(1001) }))).toBe(
      "Validation",
    );
    expect(codeOf(() => updateTransaction(as(a), { id, needsReview: true } as never))).toBe(
      "Validation",
    );
  });

  it("treats blank notes as clearing them, and writes nothing when there were none", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const audits = uow.state.audit.length;
    for (const blank of ["   ", ""]) updateTransaction(as(a), { id, notes: blank });
    expect(uow.state.audit).toHaveLength(audits);
    updateTransaction(as(a), { id, notes: "something" });
    for (const blank of ["   ", ""]) {
      updateTransaction(as(a), { id, notes: "again" });
      expect(updateTransaction(as(a), { id, notes: blank }).notes).toBeNull();
      expect(uow.state.transactions[0]?.notes).toBeNull();
    }
  });

  it("guards a name hidden from the viewer, and never exposes or overwrites it", () => {
    const { uow, as, a, b, shared } = setup();
    const id = createTransaction(as(a), txn(shared, "Surprise"));
    const row = uow.state.transactions[0];
    if (row === undefined) throw new Error("missing");
    uow.state.transactions[0] = { ...row, nameHiddenBy: a, nameHiddenUntil: "2999-03-12" };
    expect(codeOf(() => updateTransaction(as(b), { id, description: "Peek" }))).toBe("Conflict");
    const audits = uow.state.audit.length;
    const out = updateTransaction(as(b), { id, notes: "from B" });
    expect(uow.state.transactions[0]?.descriptionRaw).toBe("Surprise");
    expect(out.descriptionRaw).toBe("Hidden until 12 Mar 2999");
    // The stored audit is the true state; hiding applies when it is read (retro I1).
    const entry = uow.state.audit.slice(audits)[0];
    expect(JSON.parse(entry?.before ?? "{}").descriptionRaw).toBe("Surprise");
    expect(JSON.parse(entry?.after ?? "{}")).toMatchObject({
      descriptionRaw: "Surprise",
      notes: "from B",
    });
    expect(JSON.stringify(listAudit(as(b)))).not.toContain("Surprise");
  });

  it("refuses an amount change on a multi-split transaction", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const extra = { ...(uow.state.splits[0] as never as object), id: "SPX" } as never;
    uow.state.splits.push(extra);
    expect(codeOf(() => updateTransaction(as(a), { id, amountCents: -1 }))).toBe("Conflict");
    expect(updateTransaction(as(a), { id, description: "ok" }).descriptionRaw).toBe("ok");
  });

  it("does not write or audit a no-op edit", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const audits = uow.state.audit.length;
    const before = uow.state.transactions[0];
    updateTransaction(as(a), {
      id,
      postedOn: "2026-09-01",
      amountCents: -450,
      description: "Coffee",
    });
    updateTransaction(as(a), { id });
    expect(uow.state.audit).toHaveLength(audits);
    expect(uow.state.transactions[0]).toBe(before);
  });

  it("answers NotFound for a partner's private row, a missing row and a deleted row", () => {
    const { as, a, b, privateA, shared } = setup();
    const priv = createTransaction(as(a), txn(privateA));
    const gone = createTransaction(as(a), txn(shared));
    deleteTransaction(as(a), { id: gone });
    for (const id of [priv, gone, "nope"]) {
      expect(codeOf(() => updateTransaction(as(b), { id, notes: "x" }))).toBe("NotFound");
      expect(codeOf(() => getTransaction(as(b), { id }))).toBe("NotFound");
    }
    expect(codeOf(() => deleteTransaction(as(b), { id: priv }))).toBe("NotFound");
    expect(getTransaction(as(a), { id: priv }).descriptionRaw).toBe("Coffee");
  });
});

describe("ledger.deleteTransaction", () => {
  it("soft-deletes, resolves open review items, and audits with the account id", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const ctx = as(a);
    write(ctx, (tx, audit) =>
      raiseReviewItem(tx, audit, ctx, {
        kind: TXN_REVIEW,
        accountId: shared,
        entityRef: transactionEntityRef(id),
        dedupeKey: `t:${id}`,
      }),
    );
    expect(uow.state.transactions[0]?.needsReview).toBe(true);
    const audits = uow.state.audit.length;
    deleteTransaction(as(a), { id });
    expect(listTransactions(as(a))).toEqual([]);
    expect(uow.state.reviewItems[0]).toMatchObject({ resolution: "transaction deleted" });
    expect(uow.state.reviewItems[0]?.resolvedAt).not.toBeNull();
    expect(uow.state.transactions[0]?.needsReview).toBe(false);
    const rows = uow.state.audit.slice(audits);
    expect(rows.map((r) => `${r.entity}:${r.action}`).sort()).toEqual([
      "review_item:resolve",
      "transaction:delete",
    ]);
    const del = rows.find((r) => r.entity === "transaction");
    expect(del).toMatchObject({ accountId: shared, entityId: id });
    expect(del?.before).not.toBeNull();
    expect(del?.after).not.toBeNull();
  });

  it("needs recent authentication and changes nothing without it", () => {
    const { uow, a, as, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const stale: UseCaseContext = {
      viewer: personViewer(a, clock.now().subtract({ minutes: 10 })),
      clock,
      newId: sequentialIds(),
      uow,
    };
    const audits = uow.state.audit.length;
    expect(codeOf(() => deleteTransaction(stale, { id }))).toBe("ReauthRequired");
    expect(uow.state.audit).toHaveLength(audits);
    expect(listTransactions(as(a))).toHaveLength(1);
  });

  it("answers NotFound the second time", () => {
    const { as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    deleteTransaction(as(a), { id });
    expect(codeOf(() => deleteTransaction(as(a), { id }))).toBe("NotFound");
  });

  it("keeps the deleted row's key, so the same key is still blocked", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const row = uow.state.transactions[0];
    if (row === undefined) throw new Error("missing");
    deleteTransaction(as(a), { id });
    expect(() =>
      uow.transaction((tx) => tx.transactions.insert({ ...row, id: "T2" as never }, [])),
    ).toThrow(/UNIQUE/);
  });
});

describe("transaction.needs_review", () => {
  it("is true while an open review item names the transaction, and false once resolved", () => {
    const { uow, as, a, shared } = setup();
    const id = createTransaction(as(a), txn(shared));
    const other = createTransaction(as(a), txn(shared, "Other"));
    const ctx = as(a);
    const raise = (key: string, ref: string) =>
      write(ctx, (tx, audit) =>
        raiseReviewItem(tx, audit, ctx, {
          kind: TXN_REVIEW,
          accountId: shared,
          entityRef: ref,
          dedupeKey: key,
        }),
      );
    const flag = (txnId: string) => getTransaction(ctx, { id: txnId }).needsReview;
    expect(flag(id)).toBe(false);
    raise("k1", transactionEntityRef(id));
    raise("k2", transactionEntityRef(id));
    expect(flag(id)).toBe(true);
    expect(flag(other)).toBe(false);
    write(ctx, (tx, audit) =>
      resolveReviewItem(tx, audit, ctx, { dedupeKey: "k1", resolution: "ok" }),
    );
    expect(flag(id)).toBe(true);
    write(ctx, (tx, audit) =>
      resolveReviewItem(tx, audit, ctx, { dedupeKey: "k2", resolution: "ok" }),
    );
    expect(flag(id)).toBe(false);
    expect(uow.state.transactions.find((r) => r.id === id)?.needsReview).toBe(false);
  });
});
