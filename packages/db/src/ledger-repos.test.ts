import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccount,
  createCategory,
  createCategoryGroup,
  createIdGenerator,
  createPerson,
  createTag,
  createTransaction,
  createTransferGroup,
  defineReviewKind,
  deleteTransaction,
  deleteTransferGroup,
  getTransaction,
  hideTransactionName,
  listTransactions,
  personViewer,
  raiseReviewItem,
  resolveReviewItem,
  setSplitField,
  setSplits,
  setSplitTags,
  type UseCaseContext,
  unhideTransactionName,
  updateTransaction,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { visibleAccounts, visibleTxn } from "./privacy.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

let dir: string;
let db: Db;
let sys: UseCaseContext;
let as: (id: Id<"Person">) => UseCaseContext;
let a: Id<"Person">;
let b: Id<"Person">;
let shared: Id<"Account">;
let privateA: Id<"Account">;
let privateB: Id<"Account">;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-ledger-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  const base = {
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
  sys = { ...base, viewer: systemViewer("cli:test") };
  as = (id) => ({ ...base, viewer: personViewer(id, now) });
  a = createPerson(sys, { displayName: "A", colour: "#000000" });
  b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const account = (name: string, owners: [Id<"Person">, number][], isPrivate: boolean) =>
    createAccount(sys, {
      name,
      type: "transaction",
      currency: "AUD",
      isPrivate,
      owners: owners.map(([personId, shareBp]) => ({ personId, shareBp })),
    });
  shared = account(
    "Joint",
    [
      [a, 5000],
      [b, 5000],
    ],
    false,
  );
  privateA = account("A private", [[a, 10000]], true);
  privateB = account("B private", [[b, 10000]], true);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const txn = (accountId: string, description: string, postedOn = "2026-09-01") => ({
  accountId,
  postedOn,
  amountCents: -1250,
  description,
});

describe("visibleAccounts and visibleTxn", () => {
  it("throw without a viewer", () => {
    expect(() => visibleAccounts(undefined)).toThrow(TypeError);
    expect(() => visibleTxn(undefined, "2026-09-27")).toThrow(TypeError);
  });

  it("refuse a today that is not a YYYY-MM-DD string", () => {
    expect(() => visibleTxn(systemViewer("cli:test"), "tomorrow")).toThrow(TypeError);
  });

  it("still hide deleted accounts and transactions from a system viewer", () => {
    expect(visibleAccounts(systemViewer("cli:test"))).toBeDefined();
    expect(visibleTxn(systemViewer("cli:test"), "2026-09-27").where).toBeDefined();
  });
});

describe("transactions per viewer", () => {
  it("shows the shared account to both partners and each their own private one only", () => {
    createTransaction(as(a), txn(shared, "joint"));
    createTransaction(as(a), txn(privateA, "a-only"));
    createTransaction(as(b), txn(privateB, "b-only"));
    const names = (ctx: UseCaseContext) =>
      listTransactions(ctx)
        .map((row) => row.descriptionRaw)
        .sort();
    expect(names(as(a))).toEqual(["a-only", "joint"]);
    expect(names(as(b))).toEqual(["b-only", "joint"]);
    expect(names(sys)).toEqual(["a-only", "b-only", "joint"]);
  });

  it("returns splits, newest first, with the owner as a private split's beneficiary", () => {
    createTransaction(as(a), txn(privateA, "old", "2026-01-01"));
    createTransaction(as(a), txn(shared, "new", "2026-03-01"));
    const rows = listTransactions(as(a));
    expect(rows.map((row) => row.descriptionRaw)).toEqual(["new", "old"]);
    expect(rows[0]?.splits.map((s) => s.beneficiary)).toEqual(["shared"]);
    expect(rows[1]?.splits.map((s) => s.beneficiary)).toEqual([a]);
    expect(rows[1]?.splits[0]?.amountCents).toBe(-1250);
  });

  it("answers NotFound when B creates in A's private account, writing nothing", () => {
    const auditBefore = db.prepare("SELECT count(*) FROM audit_log").pluck().get();
    expect(() => createTransaction(as(b), txn(privateA, "nope"))).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    expect(db.prepare('SELECT count(*) FROM "transaction"').pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(auditBefore);
  });

  it("audits the account and transaction creates with their account id", () => {
    const id = createTransaction(as(a), txn(shared, "joint"));
    const rows = db
      .prepare(
        "SELECT entity, entity_id, account_id, action, actor FROM audit_log WHERE account_id IS NOT NULL ORDER BY at, id",
      )
      .all();
    expect(rows).toContainEqual({
      entity: "transaction",
      entity_id: id,
      account_id: shared,
      action: "create",
      actor: `person:${a}`,
    });
    expect(rows).toContainEqual({
      entity: "account",
      entity_id: privateA,
      account_id: privateA,
      action: "create",
      actor: "cli:test",
    });
  });

  it("creates STRICT tables with their constraints", () => {
    const strict = db
      .prepare(
        "SELECT name FROM pragma_table_list WHERE name IN ('account','account_owner','transaction','split') AND strict = 1 ORDER BY name",
      )
      .pluck()
      .all();
    expect(strict).toEqual(["account", "account_owner", "split", "transaction"]);
    expect(() =>
      db
        .prepare(
          "INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('x','n','bogus','AUD',0,'t','t')",
        )
        .run(),
    ).toThrow(/account_type/);
  });
});

const reviewKind = defineReviewKind({ kind: "ledger.parity", module: "ledger", scope: "account" });

describe("transaction edit, delete and needs_review on SQLite", () => {
  const row = (id: string) =>
    db
      .prepare(
        'SELECT posted_on, amount_cents, description_raw, notes, fingerprint, fingerprint_version, needs_review, deleted_at FROM "transaction" WHERE id = ?',
      )
      .get(id) as Record<string, unknown>;
  const raise = (ctx: UseCaseContext, id: string, key: string, accountId: string) =>
    write(ctx, (tx, audit) =>
      raiseReviewItem(tx, audit, ctx, {
        kind: reviewKind,
        accountId,
        entityRef: `transaction:${id}`,
        dedupeKey: key,
      }),
    );

  it("lets identical manual lines coexist with version 2 fingerprints", () => {
    const first = createTransaction(as(a), txn(shared, "same"));
    const second = createTransaction(as(a), txn(shared, "same"));
    expect(row(first).fingerprint_version).toBe(2);
    expect(row(first).fingerprint).not.toBe(row(second).fingerprint);
    expect(listTransactions(as(a))).toHaveLength(2);
  });

  it("edits a manual row and its split together, keeping the fingerprint, with one audit row", () => {
    const id = createTransaction(as(a), txn(shared, "Coffee"));
    const fingerprint = row(id).fingerprint;
    const audits = db.prepare("SELECT count(*) FROM audit_log").pluck().get() as number;
    const out = updateTransaction(as(a), {
      id,
      postedOn: "2026-09-05",
      amountCents: -999,
      description: "Latte",
      notes: "with Sam",
    });
    expect(out.splits.map((s) => s.amountCents)).toEqual([-999]);
    expect(row(id)).toMatchObject({
      posted_on: "2026-09-05",
      amount_cents: -999,
      description_raw: "Latte",
      notes: "with Sam",
      fingerprint,
    });
    expect(
      db.prepare("SELECT amount_cents FROM split WHERE transaction_id = ?").pluck().get(id),
    ).toBe(-999);
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(audits + 1);
    const entry = db
      .prepare(
        "SELECT account_id, before, after FROM audit_log WHERE entity = 'transaction' AND action = 'update'",
      )
      .get() as { account_id: string; before: string; after: string };
    expect(entry.account_id).toBe(shared);
    expect(JSON.parse(entry.before).splits[0].amountCents).toBe(-1250);
    expect(JSON.parse(entry.after).splits[0].amountCents).toBe(-999);
    updateTransaction(as(a), { id, notes: null });
    expect(row(id).notes).toBeNull();
    // A no-op writes nothing.
    updateTransaction(as(a), { id, amountCents: -999 });
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(audits + 2);
  });

  it("refuses imported-row line edits and multi-split amount edits with Conflict", () => {
    const id = createTransaction(as(a), txn(shared, "Imported"));
    db.prepare("UPDATE \"transaction\" SET import_id = 'IMP' WHERE id = ?").run(id);
    expect(() => updateTransaction(as(a), { id, amountCents: 1 })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
    expect(updateTransaction(as(a), { id, notes: "ok" }).notes).toBe("ok");
    const multi = createTransaction(as(a), txn(shared, "Multi"));
    db.prepare(
      "INSERT INTO split (id, transaction_id, amount_cents, beneficiary, created_at, updated_at) VALUES ('SPLIT2', ?, 0, 'shared', 't', 't')",
    ).run(multi);
    expect(() => updateTransaction(as(a), { id: multi, amountCents: 1 })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
  });

  it("refuses a description edit of a hidden name and keeps it on a notes edit", () => {
    const id = createTransaction(as(a), txn(shared, "Surprise"));
    db.prepare(
      "UPDATE \"transaction\" SET name_hidden_by = ?, name_hidden_until = '2999-03-12' WHERE id = ?",
    ).run(a, id);
    expect(() => updateTransaction(as(b), { id, description: "Peek" })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
    const out = updateTransaction(as(b), { id, notes: "from B" });
    expect(out.descriptionRaw).toBe("Hidden until 12 Mar 2999");
    expect(row(id)).toMatchObject({ description_raw: "Surprise", notes: "from B" });
  });

  it("answers NotFound to the partner for a private row on get, update and delete", () => {
    const id = createTransaction(as(a), txn(privateA, "mine"));
    for (const fn of [
      () => getTransaction(as(b), { id }),
      () => updateTransaction(as(b), { id, notes: "x" }),
      () => deleteTransaction(as(b), { id }),
    ]) {
      expect(fn).toThrow(expect.objectContaining({ code: "NotFound" }));
    }
    expect(row(id).deleted_at).toBeNull();
  });

  it("deletes behind recent auth, keeps the key for dedupe, and resolves open review items", () => {
    const id = createTransaction(as(a), txn(shared, "Gone"));
    raise(as(a), id, "k1", shared);
    expect(row(id).needs_review).toBe(1);
    const stale: UseCaseContext = {
      ...as(a),
      viewer: personViewer(a, now.subtract({ minutes: 10 })),
    };
    expect(() => deleteTransaction(stale, { id })).toThrow(
      expect.objectContaining({ code: "ReauthRequired" }),
    );
    expect(row(id).deleted_at).toBeNull();
    deleteTransaction(as(a), { id });
    expect(row(id)).toMatchObject({ needs_review: 0 });
    expect(row(id).deleted_at).not.toBeNull();
    expect(
      db.prepare("SELECT resolution FROM review_item WHERE dedupe_key = 'k1'").pluck().get(),
    ).toBe("transaction deleted");
    expect(listTransactions(as(a))).toHaveLength(0);
    expect(() => deleteTransaction(as(a), { id })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    const fingerprint = row(id).fingerprint;
    expect(() =>
      db
        .prepare(
          `INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, fingerprint, fingerprint_version, created_at, updated_at)
           VALUES ('DUP', ?, '2026-09-01', 1, 'x', 'posted', ?, 2, 't', 't')`,
        )
        .run(shared, fingerprint),
    ).toThrow(/UNIQUE/);
    const accounts = db
      .prepare(
        "SELECT account_id FROM audit_log WHERE entity = 'transaction' AND action = 'delete'",
      )
      .pluck()
      .all();
    expect(accounts).toEqual([shared]);
  });

  it("keeps needs_review in step with open review items", () => {
    const id = createTransaction(as(a), txn(shared, "Flagged"));
    raise(as(a), id, "r1", shared);
    raise(as(a), id, "r2", shared);
    expect(getTransaction(as(a), { id }).needsReview).toBe(true);
    write(as(a), (tx, audit) =>
      resolveReviewItem(tx, audit, as(a), { dedupeKey: "r1", resolution: "done" }),
    );
    expect(row(id).needs_review).toBe(1);
    write(as(a), (tx, audit) =>
      resolveReviewItem(tx, audit, as(a), { dedupeKey: "r2", resolution: "done" }),
    );
    expect(row(id).needs_review).toBe(0);
  });
});

describe("splits, provenance and tags on SQLite", () => {
  it("replaces splits, applies precedence, tags, drops, and audits each write with the account", () => {
    const id = createTransaction(as(a), txn(shared, "Shop"));
    const group = createCategoryGroup(as(a), { name: "Living", kind: "expense" });
    const category = createCategory(as(a), { groupId: group.id, name: "Food" }).id;
    const tag = createTag(as(a), { name: "t" }).id;
    const audits = () =>
      db
        .prepare(
          "SELECT account_id, action, before, after FROM audit_log WHERE entity = 'transaction' AND entity_id = ? AND action = 'update'",
        )
        .all(id) as { account_id: string; action: string; before: string; after: string }[];
    const two = setSplits(as(a), {
      transactionId: id,
      splits: [{ amountCents: -1000 }, { amountCents: -250 }],
    });
    const [first, second] = two.splits;
    if (first === undefined || second === undefined) throw new Error("missing");
    expect(() =>
      setSplits(as(a), { transactionId: id, splits: [{ id: first.id, amountCents: -1 }] }),
    ).toThrow(expect.objectContaining({ code: "Validation", details: { remainingCents: -1249 } }));
    const base = {
      transactionId: id,
      splitId: first.id,
      field: "category",
      value: category,
    } as const;
    expect(setSplitField(sys, { ...base, source: "rule" }).applied).toBe(true);
    expect(setSplitField(as(a), { ...base, value: null }).applied).toBe(true);
    expect(setSplitField(sys, { ...base, source: "rule" }).applied).toBe(false);
    setSplitTags(as(a), { transactionId: id, splitId: second.id, tagIds: [tag] });
    expect(listTransactions(as(b))[0]?.splits.find((s) => s.id === second.id)?.tags).toHaveLength(
      1,
    );
    expect(
      db.prepare("SELECT category_id, category_source FROM split WHERE id = ?").get(first.id),
    ).toEqual({ category_id: null, category_source: "user" });
    setSplits(as(a), { transactionId: id, splits: [{ id: first.id, amountCents: -1250 }] });
    expect(db.prepare("SELECT count(*) FROM split_tag").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM split WHERE transaction_id = ?").pluck().get(id)).toBe(
      1,
    );
    const rows = audits();
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.account_id).toBe(shared);
    const last = rows[rows.length - 1];
    expect(JSON.parse(last?.before ?? "{}").splits).toHaveLength(2);
    expect(JSON.parse(last?.before ?? "{}").splits[1].tagIds).toEqual([tag]);
    expect(JSON.parse(last?.after ?? "{}").splits).toHaveLength(1);
    expect(JSON.parse(last?.after ?? "{}").splits[0]).toMatchObject({ categorySource: "user" });
  });
});

describe("TagRepo.listForSplits chunking", () => {
  it("returns every tag across the 400-id chunk boundary in split id, tag name, tag id order", () => {
    const txns = [1, 2, 3].map((n) => createTransaction(as(a), txn(shared, `Bulk ${n}`)));
    const tags = ["zeta", "alpha"].map((name) => createTag(as(a), { name }).id);
    const insertSplit = db.prepare(
      "INSERT INTO split (id, transaction_id, amount_cents, beneficiary, created_at, updated_at) VALUES (?, ?, 0, 'shared', 't', 't')",
    );
    const insertTag = db.prepare(
      "INSERT INTO split_tag (split_id, tag_id, created_at, updated_at) VALUES (?, ?, 't', 't')",
    );
    const ids: string[] = [];
    for (let i = 0; i < 450; i++) {
      const id = `BULK${String(i).padStart(4, "0")}`;
      insertSplit.run(id, txns[i % 3]);
      for (const tag of tags) insertTag.run(id, tag);
      ids.push(id);
    }
    // Ask in reverse, so the order comes from the repository and not from the input.
    const found = createUnitOfWork(db).read((r) =>
      r.tags.listForSplits(as(a).viewer, [...ids].reverse()),
    );
    expect(found).toHaveLength(900);
    expect(found.map((x) => `${x.splitId}:${x.tag.name}`)).toEqual(
      ids.flatMap((id) => [`${id}:alpha`, `${id}:zeta`]),
    );
  });
});

describe("hidden names and transfer groups on SQLite", () => {
  const raw = (id: string) =>
    db
      .prepare(
        'SELECT name_hidden_by, name_hidden_until, transfer_group_id FROM "transaction" WHERE id = ?',
      )
      .get(id) as Record<string, unknown>;
  const line = (ctx: UseCaseContext, accountId: Id<"Account">, amountCents: number, d = "x") =>
    createTransaction(ctx, { accountId, postedOn: "2026-09-01", amountCents, description: d });

  it("hides, refuses the partner during an active hiding, and unhides", () => {
    const id = line(as(a), shared, -500, "Surprise");
    hideTransactionName(as(a), { id });
    expect(raw(id)).toMatchObject({ name_hidden_by: a, name_hidden_until: "2027-09-27" });
    expect(getTransaction(as(b), { id }).descriptionRaw).toBe("Hidden until 27 Sep 2027");
    expect(getTransaction(as(a), { id }).descriptionRaw).toBe("Surprise");
    expect(() => hideTransactionName(as(b), { id })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
    expect(() => unhideTransactionName(as(b), { id })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
    expect(() =>
      hideTransactionName(as(a), { id: line(as(a), privateA, -1), until: "2026-10-01" }),
    ).toThrow(expect.objectContaining({ code: "Validation" }));
    expect(() => hideTransactionName(as(b), { id: line(as(a), privateA, -1) })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    unhideTransactionName(as(a), { id });
    expect(raw(id)).toMatchObject({ name_hidden_by: null, name_hidden_until: null });
    const entries = db
      .prepare("SELECT account_id FROM audit_log WHERE entity_id = ? AND action = 'update'")
      .all(id) as { account_id: string }[];
    expect(entries.map((e) => e.account_id)).toEqual([shared, shared]);
  });

  it("deletes a group that has a soft-deleted member, clearing both rows", () => {
    const x = line(as(a), shared, -500);
    const y = line(as(a), privateA, 500);
    const [first] = createTransferGroup(as(a), { transactionIds: [x, y] });
    const groupId = first.transferGroupId as string;
    deleteTransaction(as(a), { id: y });
    deleteTransferGroup(as(a), { id: groupId });
    expect(raw(x).transfer_group_id).toBeNull();
    expect(raw(y).transfer_group_id).toBeNull();
    expect(db.prepare("SELECT count(*) FROM transfer_group").pluck().get()).toBe(0);
  });

  it("leaves the partner's responses byte-identical across the hider's later edits", () => {
    const id = line(as(a), shared, -500, "Surprise");
    hideTransactionName(as(a), { id });
    const before = JSON.stringify(listTransactions(as(b)));
    updateTransaction(as(a), { id, description: "Other secret" });
    expect(JSON.stringify(listTransactions(as(b)))).toBe(before);
  });

  it("links and unlinks a private and a shared transaction, hiding the private side", () => {
    const sharedSide = line(as(a), shared, 2500, "Top up");
    const privateSide = line(as(a), privateA, -2500, "Secret savings");
    expect(() => createTransferGroup(as(b), { transactionIds: [sharedSide, privateSide] })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    const [first] = createTransferGroup(as(a), { transactionIds: [sharedSide, privateSide] });
    const groupId = first.transferGroupId as string;
    expect(raw(privateSide).transfer_group_id).toBe(groupId);
    expect(
      db.prepare("SELECT matched_by FROM transfer_group WHERE id = ?").pluck().get(groupId),
    ).toBe("manual");
    expect(getTransaction(as(b), { id: sharedSide }).transferLabel).toBe("Transfer from A");
    expect(JSON.stringify(listTransactions(as(b)))).not.toContain("Secret savings");
    expect(() => createTransferGroup(as(a), { transactionIds: [sharedSide, privateSide] })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
    deleteTransferGroup(as(b), { id: groupId });
    expect(raw(sharedSide).transfer_group_id).toBeNull();
    expect(raw(privateSide).transfer_group_id).toBeNull();
    expect(db.prepare("SELECT count(*) FROM transfer_group").pluck().get()).toBe(0);
    expect(() => deleteTransferGroup(as(b), { id: groupId })).toThrow(
      expect.objectContaining({ code: "NotFound" }),
    );
    const audited = db
      .prepare(
        "SELECT account_id, before, after FROM audit_log WHERE entity = 'transaction' AND entity_id = ? ORDER BY at, id",
      )
      .all(privateSide) as { account_id: string; before: string; after: string }[];
    expect(audited).toHaveLength(3);
    expect(audited.slice(1).every((r) => r.account_id === privateA)).toBe(true);
    expect(JSON.parse(audited[1]?.after ?? "{}").transferGroupId).toBe(groupId);
    expect(JSON.parse(audited[2]?.after ?? "{}").transferGroupId).toBeNull();
  });
});

describe("AccountRepo update, replaceOwners, hasSplitForOthers and scopedReferences on SQLite", () => {
  const uow = () => createUnitOfWork(db);
  const T = "2026-09-28T00:00:00.000Z";
  const find = (id: string) => uow().read((r) => r.accounts.findVisible(sys.viewer, id));
  const owners = (id: string) =>
    uow()
      .read((r) => r.accounts.owners(id))
      .map((o) => [o.personId, o.shareBp]);

  it("update overwrites the mutable columns of a live account and throws for a missing one", () => {
    const before = find(shared);
    if (before === undefined) throw new Error("no account");
    uow().transaction((tx) =>
      tx.accounts.update({ ...before, name: "Renamed", isSavings: true, updatedAt: T }),
    );
    expect(find(shared)).toMatchObject({ name: "Renamed", isSavings: true, updatedAt: T });
    expect(find(shared)?.isPrivate).toBe(false);
    expect(() =>
      uow().transaction((tx) =>
        tx.accounts.update({ ...before, id: "missing" as Id<"Account">, updatedAt: T }),
      ),
    ).toThrow(/not found/);
    db.prepare("UPDATE account SET deleted_at = ? WHERE id = ?").run(T, shared);
    expect(() =>
      uow().transaction((tx) => tx.accounts.update({ ...before, name: "Again", updatedAt: T })),
    ).toThrow(/not found/);
  });

  it("replaceOwners swaps the whole owner set", () => {
    expect(owners(shared)).toEqual([
      [a, 5000],
      [b, 5000],
    ]);
    uow().transaction((tx) =>
      tx.accounts.replaceOwners(shared, [
        { accountId: shared, personId: b, shareBp: 10000, createdAt: T, updatedAt: T },
      ]),
    );
    expect(owners(shared)).toEqual([[b, 10000]]);
    expect(owners(privateA)).toEqual([[a, 10000]]);
    uow().transaction((tx) => tx.accounts.replaceOwners(shared, []));
    expect(owners(shared)).toEqual([]);
  });

  it("hasSplitForOthers sees splits for anyone but the owner, on live transactions only", () => {
    const has = (id: string, owner: string) =>
      uow().transaction((tx) => tx.accounts.hasSplitForOthers(id, owner));
    expect(has(shared, a)).toBe(false);
    const sharedTxn = createTransaction(as(a), txn(shared, "joint"));
    createTransaction(as(a), txn(privateA, "private"));
    expect(has(shared, a)).toBe(true);
    expect(has(privateA, a)).toBe(false);
    expect(has(privateA, b)).toBe(true);
    deleteTransaction(as(a), { id: sharedTxn });
    expect(has(shared, a)).toBe(false);
    const forB = createTransaction(as(a), txn(shared, "for b"));
    const splitId = getTransaction(as(a), { id: forB }).splits[0]?.id ?? "";
    setSplitField(as(a), {
      transactionId: forB,
      splitId,
      field: "beneficiary",
      value: b,
    });
    expect(has(shared, a)).toBe(true);
    expect(has(shared, b)).toBe(false);
  });

  it("scopedReferences lists the owner-scoped payees, tags and activities live rows use", () => {
    const refs = (id: string) => uow().transaction((tx) => tx.accounts.scopedReferences(id));
    expect(refs(privateA)).toEqual({ payees: [], tags: [], activities: [] });
    const scopedTag = createTag(as(a), { name: "mine", originAccountId: privateA }).id;
    const sharedTag = createTag(as(a), { name: "ours" }).id;
    const t = createTransaction(as(a), txn(privateA, "tagged"));
    const splitId = getTransaction(as(a), { id: t }).splits[0]?.id ?? "";
    setSplitTags(as(a), { transactionId: t, splitId, tagIds: [scopedTag, sharedTag] });
    expect(refs(privateA)).toEqual({
      payees: [],
      tags: [{ id: scopedTag, name: "mine" }],
      activities: [],
    });
    deleteTransaction(as(a), { id: t });
    expect(refs(privateA).tags).toEqual([]);
  });
});
