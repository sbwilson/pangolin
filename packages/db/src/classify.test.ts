// The classify use cases on real SQLite (the app package may not import an adapter): scope from
// an origin account (AD-18), viewer-first writes, defaults and audit scope.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  createAccount,
  createActivity,
  createCategory,
  createCategoryGroup,
  createIdGenerator,
  createPayee,
  createPayeeAlias,
  createPerson,
  createTag,
  createTaxCategory,
  createTransaction,
  DEFAULT_CATEGORIES,
  deleteActivity,
  deleteCategory,
  deletePayee,
  deletePayeeAlias,
  deleteTag,
  getActivity,
  getPayee,
  getPayeeAlias,
  getTag,
  listActivities,
  listAudit,
  listCategories,
  listCategoryGroups,
  listPayeeAliases,
  listPayees,
  listTags,
  listTaxCategories,
  listTransactions,
  personViewer,
  seedDefaults,
  type UseCaseContext,
  updateActivity,
  updateCategory,
  updateCategoryGroup,
  updatePayee,
  updatePayeeAlias,
  updateTag,
  updateTaxCategory,
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
let asA: UseCaseContext;
let asB: UseCaseContext;
let a: Id<"Person">;
let b: Id<"Person">;
let sharedAcct: Id<"Account">;
let privA: Id<"Account">;
let privB: Id<"Account">;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-classify-uc-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  const base = {
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
  sys = { ...base, viewer: systemViewer("cli:test") };
  a = createPerson(sys, { displayName: "A", colour: "#000000" });
  b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  asA = { ...base, viewer: personViewer(a, now) };
  asB = { ...base, viewer: personViewer(b, now) };
  const account = (isPrivate: boolean, owners: { personId: Id<"Person">; shareBp: number }[]) =>
    createAccount(sys, { name: "Acct", type: "transaction", currency: "AUD", isPrivate, owners });
  sharedAcct = account(false, [
    { personId: a, shareBp: 5000 },
    { personId: b, shareBp: 5000 },
  ]);
  privA = account(true, [{ personId: a, shareBp: 10000 }]);
  privB = account(true, [{ personId: b, shareBp: 10000 }]);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function fails(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

interface AuditRow {
  entity: string;
  entity_id: string;
  action: string;
  person_id: string | null;
  account_id: string | null;
  before: string | null;
  after: string | null;
}
const auditOf = (entity: string, action?: string): AuditRow[] =>
  (
    db
      .prepare(
        "SELECT entity, entity_id, action, person_id, account_id, before, after FROM audit_log WHERE entity = ? ORDER BY id",
      )
      .all(entity) as AuditRow[]
  ).filter((row) => action === undefined || row.action === action);

describe("defaults", () => {
  it("seeds the 13 groups, their categories and the ATO labels exactly once", () => {
    expect(seedDefaults(sys)).toBe(true);
    const groups = listCategoryGroups(sys);
    expect(groups.map((g) => g.name)).toEqual(DEFAULT_CATEGORIES.map((g) => g.name));
    expect(groups.map((g) => g.kind)).toEqual(["income", ...Array(11).fill("expense"), "transfer"]);
    const categories = listCategories(sys);
    expect(categories).toHaveLength(
      DEFAULT_CATEGORIES.reduce((n, g) => n + g.categories.length, 0),
    );
    const fixed = categories.filter((c) => c.isFixedCost).map((c) => c.name);
    expect(fixed.sort()).toEqual(
      [
        "Rent",
        "Mortgage repayments",
        "Rates and strata",
        "Home and contents insurance",
        "Electricity",
        "Gas",
        "Water",
        "Internet",
        "Mobile",
        "Registration and CTP",
        "Car insurance",
        "Private health insurance",
        "Subscriptions",
        "Life and income protection insurance",
        "Loan repayments",
        "Council rates",
      ].sort(),
    );
    const tax = listTaxCategories(sys);
    expect(tax.map((t) => t.code)).toEqual(["D1", "D10", "D15", "D2", "D4", "D5", "D9", "RENTAL"]);
    expect(tax.every((t) => t.defaultDeductibleBp === 0)).toBe(true);

    expect(seedDefaults(sys)).toBe(false);
    expect(listCategoryGroups(sys)).toHaveLength(13);
    expect(listCategories(sys)).toHaveLength(categories.length);
    expect(listTaxCategories(sys)).toHaveLength(tax.length);
  });

  it("does not seed over an existing tree", () => {
    createCategoryGroup(sys, { name: "Mine", kind: "expense" });
    expect(seedDefaults(sys)).toBe(false);
    expect(listCategoryGroups(sys)).toHaveLength(1);
  });
});

describe("household-wide classification", () => {
  it("lets any viewer edit groups, categories and tax categories, with no audit scope", () => {
    const group = createCategoryGroup(asB, { name: "Pets", kind: "expense" });
    expect(group.sort).toBe(1);
    expect(fails(() => createCategoryGroup(asA, { name: "Pets", kind: "expense" })).code).toBe(
      "Conflict",
    );
    const renamed = updateCategoryGroup(asA, {
      id: group.id,
      name: "Animals",
      kind: "transfer",
      sort: 7,
    });
    expect(renamed).toMatchObject({ name: "Animals", kind: "transfer", sort: 7 });
    expect(fails(() => updateCategoryGroup(asA, { id: "nope", name: "X" })).code).toBe("NotFound");
    expect(
      fails(() => updateCategoryGroup(asA, { id: group.id, kind: "bogus" as never })).code,
    ).toBe("Validation");

    const food = createCategory(asA, { groupId: group.id, name: "Food" });
    expect(fails(() => createCategory(asB, { groupId: group.id, name: "Food" })).code).toBe(
      "Conflict",
    );
    expect(fails(() => createCategory(asB, { groupId: "nope", name: "X" })).code).toBe(
      "Validation",
    );
    const other = createCategoryGroup(asA, { name: "Vet", kind: "expense" });
    const moved = updateCategory(asB, { id: food.id, groupId: other.id, isFixedCost: true });
    expect(moved).toMatchObject({ groupId: other.id, isFixedCost: true });

    const tc = createTaxCategory(asA, { code: "X1", label: "Thing" });
    expect(tc.defaultDeductibleBp).toBe(0);
    expect(fails(() => createTaxCategory(asB, { code: "X1", label: "Again" })).code).toBe(
      "Conflict",
    );
    expect(
      updateTaxCategory(asB, { id: tc.id, defaultDeductibleBp: 5000 }).defaultDeductibleBp,
    ).toBe(5000);
    expect(
      fails(() => updateTaxCategory(asB, { id: tc.id, defaultDeductibleBp: 10001 })).code,
    ).toBe("Validation");
    expect(listTaxCategories(asB)).toHaveLength(1);

    for (const entity of ["category_group", "category", "tax_category"]) {
      for (const row of auditOf(entity)) {
        expect(row.person_id).toBeNull();
        expect(row.account_id).toBeNull();
      }
    }
  });

  it("soft-deletes a category, leaving splits and clearing payee defaults", () => {
    const group = createCategoryGroup(sys, { name: "G", kind: "expense" });
    const cat = createCategory(sys, { groupId: group.id, name: "C" });
    const txnId = createTransaction(asA, {
      accountId: sharedAcct,
      postedOn: "2026-09-01",
      amountCents: -100,
      description: "x",
    });
    db.prepare("UPDATE split SET category_id = ? WHERE transaction_id = ?").run(cat.id, txnId);
    const shared = createPayee(asA, { name: "Shared", defaultCategoryId: cat.id });
    const scoped = createPayee(asA, {
      name: "Scoped",
      defaultCategoryId: cat.id,
      originAccountId: privA,
    });

    deleteCategory(asB, { id: cat.id });

    expect(listCategories(asA).map((c) => c.id)).not.toContain(cat.id);
    expect(db.prepare("SELECT category_id FROM split").pluck().get()).toBe(cat.id);
    expect(getPayee(asA, { id: shared.id }).defaultCategoryId).toBeNull();
    // The cascade reaches a payee the deleting viewer cannot see, and audits it with its scope.
    expect(getPayee(asA, { id: scoped.id }).defaultCategoryId).toBeNull();
    const cleared = auditOf("payee", "update").find((row) => row.entity_id === scoped.id);
    expect(cleared?.person_id).toBe(a);
    expect(cleared?.account_id).toBe(privA);
    expect(
      auditOf("payee", "update").find((row) => row.entity_id === shared.id)?.person_id,
    ).toBeNull();
    expect(fails(() => deleteCategory(asA, { id: cat.id })).code).toBe("NotFound");
    // The name is free again.
    expect(createCategory(asA, { groupId: group.id, name: "C" }).id).not.toBe(cat.id);
  });
});

describe("scoped payees (AD-18)", () => {
  it("scopes a private-origin payee to its owner and never returns the origin", () => {
    const row = createPayee(asA, { name: "Secret Shop", originAccountId: privA });
    expect(row.scopePersonId).toBe(a);
    expect(Object.keys(row)).not.toContain("originAccountId");
    expect(JSON.stringify(row)).not.toContain(privA);
    expect(db.prepare("SELECT origin_account_id FROM payee WHERE id = ?").pluck().get(row.id)).toBe(
      privA,
    );

    expect(listPayees(asA).map((p) => p.id)).toContain(row.id);
    expect(listPayees(asB).map((p) => p.id)).not.toContain(row.id);
    expect(fails(() => getPayee(asB, { id: row.id })).code).toBe("NotFound");
    expect(fails(() => updatePayee(asB, { id: row.id, name: "Hijack" })).code).toBe("NotFound");
    expect(fails(() => deletePayee(asB, { id: row.id })).code).toBe("NotFound");
    expect(getPayee(asA, { id: row.id }).name).toBe("Secret Shop");
    expect(listPayees(sys).map((p) => p.id)).toContain(row.id);
  });

  it("makes no origin or a public origin a shared row", () => {
    const none = createPayee(asA, { name: "One" });
    const pub = createPayee(asA, { name: "Two", originAccountId: sharedAcct });
    for (const row of [none, pub]) {
      expect(row.scopePersonId).toBeNull();
      expect(listPayees(asB).map((p) => p.id)).toContain(row.id);
    }
    expect(
      db.prepare("SELECT count(*) FROM payee WHERE origin_account_id IS NOT NULL").pluck().get(),
    ).toBe(0);
  });

  it("answers NotFound when a partner passes the owner's private account as origin", () => {
    for (const make of [
      () => createPayee(asB, { name: "P", originAccountId: privA }),
      () => createTag(asB, { name: "T", originAccountId: privA }),
      () => createActivity(asB, { name: "A", originAccountId: privA }),
      () =>
        createPayeeAlias(asB, {
          payeeId: "x",
          pattern: "p",
          matchKind: "exact",
          originAccountId: privA,
        }),
    ]) {
      expect(fails(make).code).toBe("NotFound");
    }
    expect(fails(() => createPayee(asB, { name: "P", originAccountId: "nope" })).code).toBe(
      "NotFound",
    );
  });

  it("allows the same name in another scope and refuses it in the same scope without naming scope", () => {
    const hidden = createPayee(asA, { name: "Woolworths", originAccountId: privA });
    // The partner's shared payee takes the owner's hidden name.
    const shared = createPayee(asB, { name: "Woolworths" });
    expect(shared.scopePersonId).toBeNull();
    // The owner may then add the same name in their own scope too (it already has one).
    const dup = fails(() => createPayee(asA, { name: "Woolworths", originAccountId: privA }));
    expect(dup.code).toBe("Conflict");
    expect(dup.message).not.toMatch(/scope|private|owner/i);
    expect(fails(() => createPayee(asB, { name: "Woolworths" })).code).toBe("Conflict");
    // A different scope for the same name is fine: a scoped name equal to a visible shared name.
    const mine = createPayee(asB, { name: "Woolworths", originAccountId: privB });
    expect(mine.scopePersonId).toBe(b);
    expect(new Set([hidden.id, shared.id, mine.id]).size).toBe(3);
    // Renaming into a taken name in the same scope conflicts; a hidden one does not.
    const other = createPayee(asB, { name: "Other" });
    expect(fails(() => updatePayee(asB, { id: other.id, name: "Woolworths" })).code).toBe(
      "Conflict",
    );
  });

  it("keeps scope fixed on update and refuses a client-supplied scope", () => {
    const row = createPayee(asA, { name: "Fixed", originAccountId: privA });
    expect(fails(() => updatePayee(asA, { id: row.id, scopePersonId: null } as never)).code).toBe(
      "Validation",
    );
    expect(
      fails(() => updatePayee(asA, { id: row.id, originAccountId: sharedAcct } as never)).code,
    ).toBe("Validation");
    expect(fails(() => createPayee(asA, { name: "N", scopePersonId: a } as never)).code).toBe(
      "Validation",
    );
    expect(updatePayee(asA, { id: row.id, name: "Renamed" }).scopePersonId).toBe(a);
  });

  it("validates default categories and website", () => {
    expect(fails(() => createPayee(asA, { name: "P", defaultCategoryId: "nope" })).code).toBe(
      "Validation",
    );
    expect(fails(() => createPayee(asA, { name: "P", websiteUrl: "ftp://x" })).code).toBe(
      "Validation",
    );
    const group = createCategoryGroup(asA, { name: "G", kind: "expense" });
    const cat = createCategory(asA, { groupId: group.id, name: "C" });
    const row = createPayee(asA, {
      name: "P",
      defaultCategoryId: cat.id,
      websiteUrl: "https://p.example",
    });
    expect(
      updatePayee(asA, { id: row.id, defaultCategoryId: null, websiteUrl: null }),
    ).toMatchObject({
      defaultCategoryId: null,
      websiteUrl: null,
    });
  });

  it("always soft-deletes a payee; transactions keep it, and the aliases cascade", () => {
    const used = createPayee(asA, { name: "Used" });
    const txnId = createTransaction(asA, {
      accountId: sharedAcct,
      postedOn: "2026-09-01",
      amountCents: -100,
      description: "x",
    });
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run(used.id, txnId);
    deletePayee(asA, { id: used.id });
    expect(fails(() => getPayee(asA, { id: used.id })).code).toBe("NotFound");
    expect(listTransactions(asA).transactions.find((t) => t.id === txnId)).toMatchObject({
      payeeId: used.id,
      payeeName: "Used",
    });

    // The partner deletes a shared payee used only by the owner's private transaction: no error,
    // and the owner still sees the payee name on it.
    const shared = createPayee(asA, { name: "Hidden use" });
    const privTxn = createTransaction(asA, {
      accountId: privA,
      postedOn: "2026-09-02",
      amountCents: -200,
      description: "y",
    });
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run(shared.id, privTxn);
    expect(() => deletePayee(asB, { id: shared.id })).not.toThrow();
    expect(listTransactions(asA).transactions.find((t) => t.id === privTxn)).toMatchObject({
      payeeId: shared.id,
      payeeName: "Hidden use",
    });

    const free = createPayee(asA, { name: "Free" });
    const alias = createPayeeAlias(asA, {
      payeeId: free.id,
      pattern: "FREE",
      matchKind: "contains",
    });
    const partnerAlias = createPayeeAlias(asB, {
      payeeId: free.id,
      pattern: "FREE B",
      matchKind: "contains",
      originAccountId: privB,
    });
    deletePayee(asA, { id: free.id });
    expect(fails(() => getPayee(asA, { id: free.id })).code).toBe("NotFound");
    expect(listPayeeAliases(asA).map((x) => x.id)).not.toContain(alias.id);
    expect(listPayeeAliases(asB).map((x) => x.id)).not.toContain(partnerAlias.id);
    const cascaded = auditOf("payee_alias", "delete");
    expect(cascaded.find((row) => row.entity_id === partnerAlias.id)).toMatchObject({
      person_id: b,
      account_id: privB,
    });
    expect(cascaded.find((row) => row.entity_id === alias.id)).toMatchObject({
      person_id: null,
      account_id: null,
    });
  });
});

describe("payee aliases", () => {
  it("takes the scope of its payee", () => {
    const shared = createPayee(asA, { name: "Shared" });
    const scoped = createPayee(asA, { name: "Scoped", originAccountId: privA });
    // Shared alias on a scoped payee is refused.
    expect(
      fails(() => createPayeeAlias(asA, { payeeId: scoped.id, pattern: "S", matchKind: "exact" }))
        .code,
    ).toBe("Validation");
    // A scoped alias on a shared payee, and on its own scoped payee.
    const onShared = createPayeeAlias(asA, {
      payeeId: shared.id,
      pattern: "S1",
      matchKind: "exact",
      originAccountId: privA,
    });
    const onScoped = createPayeeAlias(asA, {
      payeeId: scoped.id,
      pattern: "S2",
      matchKind: "exact",
      originAccountId: privA,
    });
    expect(onShared.scopePersonId).toBe(a);
    expect(onScoped.scopePersonId).toBe(a);
    // The partner sees neither and cannot reach the owner's payee.
    expect(listPayeeAliases(asB)).toEqual([]);
    expect(fails(() => getPayeeAlias(asB, { id: onShared.id })).code).toBe("NotFound");
    expect(
      fails(() => createPayeeAlias(asB, { payeeId: scoped.id, pattern: "x", matchKind: "exact" }))
        .code,
    ).toBe("NotFound");
    // A public origin gives a shared alias, which may point at a shared payee.
    const pub = createPayeeAlias(asA, {
      payeeId: shared.id,
      pattern: "S3",
      matchKind: "exact",
      originAccountId: sharedAcct,
    });
    expect(pub.scopePersonId).toBeNull();
    expect(listPayeeAliases(asB).map((x) => x.id)).toEqual([pub.id]);
    // Another person's scope on a scoped payee is refused.
    expect(
      fails(() =>
        createPayeeAlias(sys, {
          payeeId: scoped.id,
          pattern: "zz",
          matchKind: "exact",
          originAccountId: privB,
        }),
      ).code,
    ).toBe("Validation");
  });

  it("validates regexes, length and uniqueness", () => {
    const payee = createPayee(asA, { name: "P" });
    const make = (pattern: string, matchKind: "exact" | "contains" | "prefix" | "regex") =>
      createPayeeAlias(asA, { payeeId: payee.id, pattern, matchKind });
    expect(fails(() => make("(unclosed", "regex")).code).toBe("Validation");
    expect(make("(unclosed", "contains").pattern).toBe("(unclosed");
    expect(make("^WOOL.*S$", "regex").matchKind).toBe("regex");
    expect(fails(() => make("x".repeat(201), "contains")).code).toBe("Validation");
    expect(make("x".repeat(200), "contains").pattern).toHaveLength(200);
    expect(fails(() => make("   ", "contains")).code).toBe("Validation");
    expect(fails(() => make("^WOOL.*S$", "regex")).code).toBe("Conflict");
    expect(make("^WOOL.*S$", "exact").matchKind).toBe("exact");
    expect(fails(() => make("p", "fuzzy" as never)).code).toBe("Validation");
  });

  it("updates and deletes viewer-first", () => {
    const payee = createPayee(asA, { name: "P" });
    const alias = createPayeeAlias(asA, {
      payeeId: payee.id,
      pattern: "mine",
      matchKind: "exact",
      originAccountId: privA,
    });
    expect(fails(() => updatePayeeAlias(asB, { id: alias.id, pattern: "x" })).code).toBe(
      "NotFound",
    );
    expect(fails(() => deletePayeeAlias(asB, { id: alias.id })).code).toBe("NotFound");
    expect(
      fails(() => updatePayeeAlias(asA, { id: alias.id, matchKind: "regex", pattern: "(" })).code,
    ).toBe("Validation");
    expect(updatePayeeAlias(asA, { id: alias.id, matchKind: "prefix" })).toMatchObject({
      matchKind: "prefix",
      scopePersonId: a,
    });
    deletePayeeAlias(asA, { id: alias.id });
    expect(listPayeeAliases(asA)).toEqual([]);
  });
});

describe("scoped tags and activities", () => {
  it("scopes, hides and edits tags viewer-first", () => {
    const mine = createTag(asA, { name: "private", originAccountId: privA });
    const shared = createTag(asB, { name: "private" });
    expect(mine.scopePersonId).toBe(a);
    expect(shared.scopePersonId).toBeNull();
    expect(listTags(asB).map((t) => t.id)).toEqual([shared.id]);
    expect(
      listTags(asA)
        .map((t) => t.id)
        .sort(),
    ).toEqual([mine.id, shared.id].sort());
    expect(fails(() => getTag(asB, { id: mine.id })).code).toBe("NotFound");
    expect(fails(() => updateTag(asB, { id: mine.id, name: "x" })).code).toBe("NotFound");
    expect(fails(() => deleteTag(asB, { id: mine.id })).code).toBe("NotFound");
    const dup = fails(() => createTag(asA, { name: "private", originAccountId: privA }));
    expect(dup.code).toBe("Conflict");
    expect(dup.message).not.toMatch(/scope|private|owner/i);
    expect(updateTag(asA, { id: mine.id, name: "renamed" }).name).toBe("renamed");
    deleteTag(asA, { id: mine.id });
    expect(listTags(asA).map((t) => t.id)).toEqual([shared.id]);
    expect(createTag(asA, { name: "renamed", originAccountId: privA }).id).not.toBe(mine.id);
  });

  it("scopes activities and validates dates and budget", () => {
    const row = createActivity(asA, {
      name: "Japan",
      startsOn: "2026-10-01",
      endsOn: "2026-10-10",
      budgetCents: 500000,
      originAccountId: privA,
    });
    expect(row.scopePersonId).toBe(a);
    expect(listActivities(asB)).toEqual([]);
    expect(fails(() => getActivity(asB, { id: row.id })).code).toBe("NotFound");
    expect(fails(() => updateActivity(asB, { id: row.id, name: "x" })).code).toBe("NotFound");
    expect(fails(() => deleteActivity(asB, { id: row.id })).code).toBe("NotFound");
    expect(
      fails(() =>
        createActivity(asA, { name: "Bad", startsOn: "2026-10-10", endsOn: "2026-10-01" }),
      ).code,
    ).toBe("Validation");
    expect(fails(() => createActivity(asA, { name: "Bad", budgetCents: -1 })).code).toBe(
      "Validation",
    );
    expect(fails(() => createActivity(asA, { name: "Bad", startsOn: "2026-02-30" })).code).toBe(
      "Validation",
    );
    expect(fails(() => updateActivity(asA, { id: row.id, endsOn: "2026-09-01" })).code).toBe(
      "Validation",
    );
    expect(updateActivity(asA, { id: row.id, endsOn: null, budgetCents: null })).toMatchObject({
      endsOn: null,
      budgetCents: null,
      scopePersonId: a,
    });
    deleteActivity(asA, { id: row.id });
    expect(listActivities(asA)).toEqual([]);
  });
});

describe("audit scope of classify writes", () => {
  it("carries personId (and accountId when private) for scoped rows, neither for shared ones", () => {
    const priv = createPayee(asA, { name: "Priv", originAccountId: privA });
    updatePayee(asA, { id: priv.id, name: "Priv2" });
    const alias = createPayeeAlias(asA, {
      payeeId: priv.id,
      pattern: "p",
      matchKind: "exact",
      originAccountId: privA,
    });
    updatePayeeAlias(asA, { id: alias.id, pattern: "p2" });
    const tag = createTag(asA, { name: "t", originAccountId: privA });
    updateTag(asA, { id: tag.id, name: "t2" });
    const act = createActivity(asA, { name: "act", originAccountId: privA });
    updateActivity(asA, { id: act.id, name: "act2" });
    deleteTag(asA, { id: tag.id });
    deleteActivity(asA, { id: act.id });
    deletePayeeAlias(asA, { id: alias.id });
    deletePayee(asA, { id: priv.id });

    const shared = createPayee(asA, { name: "Sh" });
    updatePayee(asA, { id: shared.id, name: "Sh2" });
    const sharedAlias = createPayeeAlias(asA, {
      payeeId: shared.id,
      pattern: "sh",
      matchKind: "exact",
    });
    updatePayeeAlias(asA, { id: sharedAlias.id, pattern: "sh2" });
    const pubOrigin = createTag(asA, { name: "pub", originAccountId: sharedAcct });
    updateTag(asA, { id: pubOrigin.id, name: "pub2" });
    const sharedAct = createActivity(asA, { name: "sact" });
    updateActivity(asA, { id: sharedAct.id, name: "sact2" });
    deleteTag(asA, { id: pubOrigin.id });

    const sharedIds = [shared.id, sharedAlias.id, pubOrigin.id, sharedAct.id];
    for (const entity of ["payee", "payee_alias", "tag", "activity"]) {
      const rows = auditOf(entity);
      expect(rows.filter((r) => r.action === "update").length, entity).toBe(2);
      for (const row of rows) {
        const isShared = sharedIds.includes(row.entity_id as never);
        expect(row.person_id, `${entity} ${row.action}`).toBe(isShared ? null : a);
        expect(row.account_id, `${entity} ${row.action}`).toBe(isShared ? null : privA);
        // The origin account is never part of a payload.
        expect(`${row.before}${row.after}`).not.toContain(privA);
        expect(`${row.before}${row.after}`).not.toContain("originAccountId");
      }
    }

    // The partner's real audit read shows the shared rows and none of the owner's scoped ones.
    const seen = (ctx: UseCaseContext) =>
      listAudit(ctx)
        .filter((r) => ["payee", "payee_alias", "tag", "activity"].includes(r.entity))
        .map((r) => r.entityId);
    const partner = seen(asB);
    expect(partner.length).toBeGreaterThan(0);
    expect(new Set(partner)).toEqual(new Set(sharedIds));
    expect(seen(asA).length).toBeGreaterThan(partner.length);
  });
});

describe("transactions referencing scoped payees", () => {
  it("shows the partner no payeeId or payeeName on a shared transaction", () => {
    const scoped = createPayee(asA, { name: "Secret Shop", originAccountId: privA });
    const txnId = createTransaction(asA, {
      accountId: sharedAcct,
      postedOn: "2026-09-01",
      amountCents: -4200,
      description: "card purchase",
    });
    db.prepare('UPDATE "transaction" SET payee_id = ? WHERE id = ?').run(scoped.id, txnId);

    const mine = listTransactions(asA).transactions.find((t) => t.id === txnId);
    expect(mine).toMatchObject({ payeeId: scoped.id, payeeName: "Secret Shop" });
    const theirs = listTransactions(asB).transactions.find((t) => t.id === txnId);
    expect(theirs).toBeDefined();
    expect(theirs?.payeeId).toBeNull();
    expect(theirs?.payeeName).toBeNull();
    expect(theirs?.logoAttachmentId).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain(scoped.id);
    expect(JSON.stringify(theirs)).not.toContain("Secret Shop");
  });
});
