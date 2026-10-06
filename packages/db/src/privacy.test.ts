// The privacy core on real SQLite (AD-3, AD-4, AD-5): hidden names, the transfer label, scoped
// payees, deleted rows, the audit read and a missing viewer on every scoped table. The memory
// mirror is held to the same answers by `classification-repos.test.ts`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccount,
  createIdGenerator,
  createPayee,
  createPerson,
  createTag,
  createTransaction,
  createTransferGroup,
  deleteTransaction,
  getAccount,
  getTransaction,
  hideTransactionName,
  listAudit,
  listReviewItems,
  listTransactions,
  personViewer,
  rejoinAccount,
  setPrivacy,
  setSplitField,
  setSplits,
  setSplitTags,
  type UseCaseContext,
  unhideTransactionName,
  updateAccount,
  updateTransaction,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");

let dir: string;
let db: Db;
let sys: UseCaseContext;
let a: Id<"Person">;
let b: Id<"Person">;
let shared: Id<"Account">;
let privateA: Id<"Account">;
let privateB: Id<"Account">;
let base: Omit<UseCaseContext, "viewer">;

/** A context for `id` on the given day (default: the fixed "today", 2026-09-27). */
const as = (id: Id<"Person">, day = "2026-09-27"): UseCaseContext => ({
  ...base,
  clock: { now: () => now, today: () => Temporal.PlainDate.from(day) },
  viewer: personViewer(id, now),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-privacy-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  base = {
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
  sys = { ...base, viewer: systemViewer("cli:test") };
  a = createPerson(sys, { displayName: "Alex", colour: "#000000" });
  b = createPerson(sys, { displayName: "Bea", colour: "#ffffff" });
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

const txn = (accountId: string, description: string, amountCents = -1250) => ({
  accountId,
  postedOn: "2026-09-01",
  amountCents,
  description,
});

const hide = (id: string, until: string | null, by: string | null) =>
  db
    .prepare('UPDATE "transaction" SET name_hidden_until = ?, name_hidden_by = ? WHERE id = ?')
    .run(until, by, id);

const names = (ctx: UseCaseContext) =>
  listTransactions(ctx)
    .map((row) => row.descriptionRaw)
    .sort();

describe("hidden names", () => {
  it("shows the partner a placeholder until the date, the hider the real name, everyone on it", () => {
    const id = createTransaction(as(a), txn(shared, "Surprise gift"));
    hide(id, "2027-03-12", a);
    const seenByB = listTransactions(as(b))[0];
    expect(seenByB?.descriptionRaw).toBe("Hidden until 12 Mar 2027");
    expect(seenByB?.nameHidden).toBe(true);
    expect(listTransactions(as(a))[0]?.descriptionRaw).toBe("Surprise gift");
    expect(listTransactions(sys)[0]?.descriptionRaw).toBe("Surprise gift");
    expect(listTransactions(as(b, "2027-03-11"))[0]?.descriptionRaw).toBe(
      "Hidden until 12 Mar 2027",
    );
    expect(listTransactions(as(b, "2027-03-12"))[0]?.descriptionRaw).toBe("Surprise gift");
    expect(listTransactions(as(b, "2027-03-13"))[0]?.nameHidden).toBe(false);
  });

  it("keeps notes visible and never lets the real name into the response", () => {
    const id = createTransaction(as(a), txn(shared, "Surprise gift"));
    db.prepare('UPDATE "transaction" SET notes = ? WHERE id = ?').run("for May", id);
    hide(id, "2027-03-12", a);
    const row = listTransactions(as(b))[0];
    expect(row?.notes).toBe("for May");
    expect(JSON.stringify(row)).not.toContain("Surprise");
  });

  it("nulls the payee, its name and its logo in SQL", () => {
    const id = createTransaction(as(a), txn(shared, "x"));
    db.prepare(
      "INSERT INTO payee (id, name, logo_attachment_id, created_at, updated_at) VALUES ('P1','Shop','logo1','t','t')",
    ).run();
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run("P1", id);
    const raw = (viewerCtx: UseCaseContext) =>
      viewerCtx.uow.read((r) =>
        r.transactions
          .listVisible(viewerCtx.viewer, "2026-09-27")
          .map((t) => [t.descriptionRaw, t.payeeId, t.payeeName, t.logoAttachmentId]),
      );
    expect(raw(as(b))).toEqual([["x", "P1", "Shop", "logo1"]]);
    hide(id, "2027-03-12", a);
    expect(raw(as(b))).toEqual([[null, null, null, null]]);
    expect(raw(as(a))).toEqual([["x", "P1", "Shop", "logo1"]]);
  });

  it("keeps a private account's rows from the partner entirely; the hider sees their name", () => {
    const id = createTransaction(as(a), txn(privateA, "private"));
    hide(id, "2027-03-12", a);
    expect(names(as(b))).toEqual([]);
    expect(as(b).uow.read((r) => r.transactions.findVisible(as(b).viewer, id, "2026-09-27"))).toBe(
      undefined,
    );
    expect(listTransactions(as(a))[0]?.nameHidden).toBe(false);
  });

  it("keeps a partner's hiding after they leave and the account turns private (takeover)", () => {
    const id = createTransaction(as(b), txn(shared, "Gift for Alex"));
    hideTransactionName(as(b), { id, until: "2027-03-12" });
    const splitId = getTransaction(as(b), { id }).splits[0]?.id ?? "";
    setSplitField(as(b), { transactionId: id, splitId, field: "beneficiary", value: a });
    // Either person may take the other off a public account; the hiding stays with its hider.
    updateAccount(as(a), { id: shared, owners: [{ personId: a, shareBp: 10000 }] });
    setPrivacy(as(a), { id: shared, isPrivate: true });
    const row = listTransactions(as(a)).find((t) => t.id === id);
    expect(row?.descriptionRaw).toBe("Hidden until 12 Mar 2027");
    expect(row?.nameHidden).toBe(true);
    const audit = listAudit(as(a)).filter((r) => r.entityId === id);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((r) => r.hiddenUntil === "2027-03-12")).toBe(true);
    expect(JSON.stringify(listAudit(as(a)))).not.toContain("Gift for Alex");
    expect(listTransactions(as(a, "2027-03-12")).find((t) => t.id === id)?.descriptionRaw).toBe(
      "Gift for Alex",
    );
    expect(listTransactions(as(b)).length).toBe(0);
  });

  it("keeps a hiding after its hider is removed, and lets them unhide once they rejoin", () => {
    const id = createTransaction(as(b), txn(shared, "Gift for Alex"));
    hideTransactionName(as(b), { id, until: "2027-03-12" });
    updateAccount(as(a), { id: shared, owners: [{ personId: a, shareBp: 10000 }] });
    expect(listTransactions(as(a)).find((t) => t.id === id)?.nameHidden).toBe(true);
    expect(listTransactions(as(a)).find((t) => t.id === id)?.descriptionRaw).not.toBe(
      "Gift for Alex",
    );
    expect(getAccount(as(b), { id: shared }).removal?.by).toBe(a);
    rejoinAccount(as(b), { id: shared });
    expect(getAccount(as(b), { id: shared }).removal).toBeUndefined();
    unhideTransactionName(as(b), { id });
    const shown = listTransactions(as(a)).find((t) => t.id === id);
    expect(shown?.nameHidden).toBe(false);
    expect(shown?.descriptionRaw).toBe("Gift for Alex");
  });

  it("nulls a scoped payee's id for the other person", () => {
    const id = createTransaction(as(a), txn(shared, "x"));
    db.prepare(
      "INSERT INTO payee (id, name, scope_person_id, created_at, updated_at) VALUES ('P1','Mine',?,'t','t')",
    ).run(a);
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run("P1", id);
    expect(listTransactions(as(a))[0]?.payeeId).toBe("P1");
    const asB = listTransactions(as(b))[0];
    expect(asB?.payeeId).toBeNull();
    expect(asB?.payeeName).toBeNull();
  });
});

describe("deleted rows", () => {
  it("excludes a soft-deleted account and its transactions, and a soft-deleted transaction", () => {
    createTransaction(as(a), txn(shared, "kept"));
    const gone = createTransaction(as(a), txn(shared, "gone"));
    createTransaction(as(a), txn(privateA, "in-deleted-account"));
    db.prepare('UPDATE "transaction" SET deleted_at = ? WHERE id = ?').run("t", gone);
    db.prepare("UPDATE account SET deleted_at = ? WHERE id = ?").run("t", privateA);
    expect(names(as(a))).toEqual(["kept"]);
    expect(names(sys)).toEqual(["kept"]);
    expect(as(a).uow.read((r) => r.accounts.list(as(a).viewer).map((x) => x.id))).toEqual([shared]);
  });
});

describe("transfer label", () => {
  function transfer(visibleCents: number) {
    const mine = createTransaction(as(a), txn(shared, "transfer leg", visibleCents));
    const theirs = createTransaction(as(b), txn(privateB, "other leg", -visibleCents));
    db.prepare(
      "INSERT INTO transfer_group (id, matched_by, created_at, updated_at) VALUES ('G1','manual','t','t')",
    ).run();
    db.prepare("UPDATE \"transaction\" SET transfer_group_id = 'G1' WHERE id IN (?, ?)").run(
      mine,
      theirs,
    );
    return { mine, theirs };
  }

  it("says where an inflow came from and where an outflow went, and nothing else", () => {
    transfer(900);
    const inflow = listTransactions(as(a))[0];
    expect(inflow?.transferLabel).toBe("Transfer from Bea");
    db.prepare(
      "UPDATE \"transaction\" SET amount_cents = -900 WHERE description_raw = 'transfer leg'",
    ).run();
    expect(listTransactions(as(a))[0]?.transferLabel).toBe("Transfer to Bea");
    const json = JSON.stringify(listTransactions(as(a)));
    expect(json).not.toContain(privateB);
    expect(json).not.toContain("other leg");
  });

  it("leaves the owner's own view and a visible counterpart unlabelled", () => {
    const { theirs } = transfer(900);
    expect(listTransactions(as(b)).find((t) => t.id === theirs)?.transferLabel).toBeNull();
    expect(listTransactions(as(b)).find((t) => t.id !== theirs)?.transferLabel).toBeNull();
    expect(listTransactions(sys).every((t) => t.transferLabel === null)).toBe(true);
  });
});

describe("audit read", () => {
  it("scopes rows to visible accounts and redacts the partner's entries about a hidden name", () => {
    const id = createTransaction(as(a), txn(shared, "Surprise gift"));
    createTransaction(as(a), txn(privateA, "a-private"));
    hide(id, "2027-03-12", a);
    const forB = listAudit(as(b));
    expect(forB.some((row) => row.accountId === privateA)).toBe(false);
    const entry = forB.find((row) => row.entity === "transaction" && row.entityId === id);
    expect(entry?.hiddenUntil).toBe("2027-03-12");
    expect(JSON.parse(entry?.after ?? "{}").descriptionRaw).toBe("Hidden until 12 Mar 2027");
    expect(JSON.stringify(forB)).not.toContain("Surprise");
    const forA = listAudit(as(a));
    expect(JSON.parse(forA.find((row) => row.entityId === id)?.after ?? "{}").descriptionRaw).toBe(
      "Surprise gift",
    );
    expect(forA.some((row) => row.accountId === privateA)).toBe(true);
    expect(
      JSON.parse(listAudit(as(b, "2027-03-12")).find((r) => r.entityId === id)?.after ?? "{}")
        .descriptionRaw,
    ).toBe("Surprise gift");
  });

  it("after joint, private, public: the partner keeps joint-era rows and flips only", () => {
    const joint = createTransaction(as(a), txn(shared, "Joint era"));
    const splitId = getTransaction(as(a), { id: joint }).splits[0]?.id ?? "";
    setSplitField(as(a), { transactionId: joint, splitId, field: "beneficiary", value: a });
    updateAccount(as(b), { id: shared, owners: [{ personId: a, shareBp: 10000 }] });
    setPrivacy(as(a), { id: shared, isPrivate: true });
    const privateEra = createTransaction(as(a), txn(shared, "Private era"));
    setPrivacy(as(a), { id: shared, isPrivate: false });
    const scopes = db
      .prepare(
        "SELECT entity_id, action, person_id FROM audit_log WHERE account_id = ? ORDER BY at, id",
      )
      .all(shared) as { entity_id: string; action: string; person_id: string | null }[];
    expect(
      scopes.filter((r) => r.person_id !== null).map((r) => [r.entity_id, r.person_id]),
    ).toEqual([[privateEra, a]]);
    const forB = listAudit(as(b)).filter((r) => r.accountId === shared);
    expect(forB.some((r) => r.entityId === privateEra)).toBe(false);
    expect(forB.some((r) => r.entityId === joint)).toBe(true);
    expect(forB.filter((r) => r.action === "set_privacy")).toHaveLength(2);
    expect(JSON.stringify(forB)).not.toContain("Private era");
    const forA = listAudit(as(a)).filter((r) => r.accountId === shared);
    expect(forA).toHaveLength(forB.length + 1);
  });

  it("redacts from an audit row's own before/after state once the live hide is gone", () => {
    const id = createTransaction(as(a), txn(shared, "Real name"));
    const after = JSON.stringify({
      id,
      descriptionRaw: "Secret name",
      payeeId: "P9",
      nameHiddenBy: a,
      nameHiddenUntil: "2027-03-12",
    });
    db.prepare(
      "INSERT INTO audit_log (id, at, actor, entity, entity_id, account_id, action, after) VALUES ('AU9','2026-09-28T00:00:00.000Z','x','transaction',?,?,'update',?)",
    ).run(id, shared, after);
    const entryFor = (ctx: UseCaseContext) => listAudit(ctx).find((r) => r.id === "AU9");
    for (const clearLive of [false, true]) {
      if (clearLive) hide(id, null, null);
      const seen = entryFor(as(b));
      expect(seen?.hiddenUntil).toBe("2027-03-12");
      const json = JSON.parse(seen?.after ?? "{}");
      expect(json.descriptionRaw).toBe("Hidden until 12 Mar 2027");
      // The key is kept (nulled in SQL) and labelled; a key the row lacked is never added.
      expect(json.payeeId).toBe("Hidden until 12 Mar 2027");
      expect(json.fingerprint).toBeUndefined();
      expect(JSON.stringify(seen)).not.toContain("Secret name");
    }
    const own = entryFor(as(a));
    expect(own?.hiddenUntil).toBeNull();
    expect(JSON.parse(own?.after ?? "{}").descriptionRaw).toBe("Secret name");
  });

  it("stores the true name when the partner writes on a hidden row; B reads the placeholder", () => {
    const payee = createPayee(as(a), { name: "Florist" });
    const id = createTransaction(as(a), { ...txn(shared, "Surprise gift"), payeeId: payee.id });
    hideTransactionName(as(a), { id, until: "2027-03-12" });
    updateTransaction(as(b), { id, notes: "for May" });
    const [first] = setSplits(as(b), {
      transactionId: id,
      splits: [{ amountCents: -1000 }, { amountCents: -250 }],
    }).splits;
    if (first === undefined) throw new Error("missing split");
    setSplitField(as(b), {
      transactionId: id,
      splitId: first.id,
      field: "deductible_bp",
      value: 1,
    });
    const tag = createTag(as(b), { name: "gift" });
    setSplitTags(as(b), { transactionId: id, splitId: first.id, tagIds: [tag.id] });
    // A transfer group needs two accounts: link to the other side through a second shared one.
    const joint2 = createAccount(sys, {
      name: "Joint 2",
      type: "transaction",
      currency: "AUD",
      isPrivate: false,
      owners: [
        { personId: a, shareBp: 5000 },
        { personId: b, shareBp: 5000 },
      ],
    });
    const across = createTransaction(as(b), txn(joint2, "Across", 1250));
    createTransferGroup(as(b), { transactionIds: [id, across] });
    deleteTransaction(as(b), { id });

    const byB = db
      .prepare(
        "SELECT action, before, after FROM audit_log WHERE entity = 'transaction' AND entity_id = ? AND actor = ? ORDER BY rowid",
      )
      .all(id, `person:${b}`) as { action: string; before: string; after: string }[];
    expect(byB.map((r) => r.action)).toEqual([
      "update",
      "update",
      "update",
      "update",
      "update",
      "delete",
    ]);
    for (const row of byB) {
      for (const json of [row.before, row.after]) {
        expect(JSON.parse(json)).toMatchObject({
          descriptionRaw: "Surprise gift",
          payeeId: payee.id,
        });
      }
    }

    const LABEL = "Hidden until 12 Mar 2027";
    const forB = listAudit(as(b)).filter((r) => r.entityId === id && r.actor === `person:${b}`);
    expect(forB).toHaveLength(6);
    for (const row of forB) {
      for (const json of [row.before, row.after]) {
        expect(JSON.parse(json ?? "{}")).toMatchObject({
          descriptionRaw: LABEL,
          payeeId: LABEL,
          fingerprint: null,
          externalId: null,
        });
      }
    }
    expect(JSON.stringify(forB)).not.toContain("Surprise");
    expect(JSON.stringify(forB)).not.toContain(payee.id);
    const forA = listAudit(as(a)).filter((r) => r.entityId === id && r.actor === `person:${b}`);
    expect(forA).toHaveLength(6);
    for (const row of forA) {
      for (const json of [row.before, row.after]) {
        expect(JSON.parse(json ?? "{}")).toMatchObject({
          descriptionRaw: "Surprise gift",
          payeeId: payee.id,
        });
      }
    }
  });

  it("nulls another person's scoped payee in the partner's audit of a row that is not hidden", () => {
    const mine = createPayee(as(a), { name: "My florist", originAccountId: privateA });
    const id = createTransaction(as(a), txn(shared, "Flowers"));
    // The use cases refuse a scoped payee on a shared account; the row is set directly.
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run(mine.id, id);
    updateTransaction(as(b), { id, notes: "seen" });
    const byB = (ctx: UseCaseContext) =>
      listAudit(ctx).filter((r) => r.entityId === id && r.actor === `person:${b}`);
    expect(byB(as(b))).toHaveLength(1);
    const [forB] = byB(as(b));
    for (const json of [forB?.before, forB?.after]) {
      expect(JSON.parse(json ?? "{}")).toMatchObject({ payeeId: null, descriptionRaw: "Flowers" });
    }
    expect(JSON.stringify(byB(as(b)))).not.toContain(mine.id);
    const [forA] = byB(as(a));
    for (const json of [forA?.before, forA?.after]) {
      expect(JSON.parse(json ?? "{}")).toMatchObject({ payeeId: mine.id });
    }
  });

  it("gives the partner the placeholder for a hidden row's audit JSON that is not an object", () => {
    const id = createTransaction(as(a), txn(shared, "Surprise gift"));
    hide(id, "2027-03-12", a);
    db.prepare(
      "INSERT INTO audit_log (id, at, actor, entity, entity_id, account_id, action, before, after) VALUES ('AU7','2026-09-28T00:00:00.000Z','x','transaction',?,?,'update',?,?)",
    ).run(id, shared, '"Surprise gift"', '["Surprise gift"]');
    const seen = listAudit(as(b)).find((r) => r.id === "AU7");
    expect(seen).toMatchObject({
      before: "Hidden until 12 Mar 2027",
      after: "Hidden until 12 Mar 2027",
    });
    expect(JSON.stringify(seen)).not.toContain("Surprise");
  });

  it("hides a v1 row's fingerprint and external ID from the partner, and keeps its line fixed", () => {
    const id = createTransaction(as(a), txn(shared, "Surprise gift"));
    db.prepare(
      'UPDATE "transaction" SET external_id = ?, fingerprint = ?, fingerprint_version = 1 WHERE id = ?',
    ).run("BANK-123", "v1-hash-of-surprise", id);
    hide(id, "2027-03-12", a);
    expect(getTransaction(as(b), { id })).toMatchObject({ fingerprint: null, externalId: null });
    expect(listTransactions(as(b)).find((t) => t.id === id)).toMatchObject({
      fingerprint: null,
      externalId: null,
    });
    expect(getTransaction(as(a), { id })).toMatchObject({
      fingerprint: "v1-hash-of-surprise",
      externalId: "BANK-123",
    });
    expect(getTransaction(as(b, "2027-03-12"), { id }).externalId).toBe("BANK-123");
    expect(() => updateTransaction(as(b), { id, amountCents: -1 })).toThrow(
      expect.objectContaining({ code: "Conflict" }),
    );
    const row = db
      .prepare('SELECT amount_cents AS amount FROM "transaction" WHERE id = ?')
      .get(id) as { amount: number };
    expect(row.amount).toBe(-1250);
  });

  it("hides audit rows of a person scope from the other person", () => {
    db.prepare(
      "INSERT INTO audit_log (id, at, actor, entity, entity_id, person_id, action) VALUES ('AU1','2026-09-27T00:00:00.000Z','x','goal','g',?,'create')",
    ).run(a);
    expect(listAudit(as(a)).some((r) => r.id === "AU1")).toBe(true);
    expect(listAudit(as(b)).some((r) => r.id === "AU1")).toBe(false);
  });
});

describe("review items on accounts", () => {
  it("does not list an item on a private account to the partner", () => {
    db.prepare(
      "INSERT INTO review_item (id, kind, account_id, entity_ref, dedupe_key, created_at) VALUES ('R1','k',?,'e','d','t')",
    ).run(privateA);
    expect(listReviewItems(as(a)).map((i) => i.entityRef)).toEqual(["e"]);
    expect(listReviewItems(as(b))).toEqual([]);
  });
});

describe("a missing viewer throws on every scoped table", () => {
  const none = undefined as never;
  const cases: [string, () => unknown][] = [
    ["account", () => sys.uow.read((r) => r.accounts.list(none))],
    ["account (by id)", () => sys.uow.read((r) => r.accounts.findVisible(none, "x"))],
    ["transaction", () => sys.uow.read((r) => r.transactions.listVisible(none, "2026-09-27"))],
    [
      "transaction (by id)",
      () => sys.uow.read((r) => r.transactions.findVisible(none, "x", "2026-09-27")),
    ],
    [
      "transaction (delete)",
      () => sys.uow.transaction((r) => r.transactions.softDelete(none, "x", "t")),
    ],
    ["split (tags)", () => sys.uow.read((r) => r.tags.listForSplit(none, "x"))],
    ["balance_snapshot", () => sys.uow.read((r) => r.balanceSnapshots.listVisible(none, "x"))],
    ["transfer_group", () => sys.uow.read((r) => r.transferGroups.find(none, "x"))],
    ["review_item", () => sys.uow.read((r) => r.reviewItems.listOpenFor(none))],
    ["audit_log", () => sys.uow.read((r) => r.audit.listVisible(none, "2026-09-27"))],
  ];
  it.each(cases)("%s", (_name, run) => {
    expect(run).toThrow(TypeError);
  });
});
