// The schema and repositories of story 2.2 on real SQLite, and the same scenario against the
// in-memory unit of work, which must agree with it (the parity test at the end).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AccountRow,
  personViewer,
  type SplitRow,
  type TransactionRow,
  type TxRepos,
  type UnitOfWork,
  type Viewer,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { memoryUnitOfWork } from "@pangolin/app/testing/memory-uow";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");
const T = "2026-09-27T00:00:00.000Z";
const TODAY = "2026-09-27";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-classify-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Sequential ULID-shaped IDs. */
function ids() {
  let n = 0;
  return <B extends string>() => `01J0000000000000000000${String(++n).padStart(4, "0")}` as Id<B>;
}

/** `ok`, or the kind of constraint that failed, so both adapters can be compared. */
function attempt(fn: () => unknown): unknown {
  try {
    return fn() ?? "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = /UNIQUE/.test(message)
      ? "UNIQUE"
      : /FOREIGN KEY/.test(message)
        ? "FOREIGN KEY"
        : /CHECK/.test(message)
          ? "CHECK"
          : message;
    return `error:${kind}`;
  }
}

function fingerprint(accountId: string, description: string) {
  return `fp:${accountId}:${description}`;
}

/**
 * The scenario: every row of the I/O matrix, run through the repositories of `uow`. Returns a
 * transcript of what each step answered, so two adapters can be compared step by step.
 */
function scenario(uow: UnitOfWork): Record<string, unknown> {
  const newId = ids();
  const out: Record<string, unknown> = {};
  const system: Viewer = systemViewer("cli:test");
  const a = newId<"Person">();
  const b = newId<"Person">();
  const asA = personViewer(a, now);
  const asB = personViewer(b, now);
  const shared = newId<"Account">();
  const privA = newId<"Account">();
  const privB = newId<"Account">();

  const account = (id: Id<"Account">, isPrivate: boolean): AccountRow => ({
    id,
    name: id,
    type: "transaction",
    currency: "AUD",
    isPrivate,
    institutionId: null,
    openedOn: null,
    closedOn: null,
    isSavings: false,
    createdAt: T,
    updatedAt: T,
  });
  const txn = (
    accountId: Id<"Account">,
    description: string,
    over: Partial<TransactionRow> = {},
  ): TransactionRow => ({
    id: newId<"Transaction">(),
    accountId,
    postedOn: "2026-09-01",
    amountCents: -1250,
    descriptionRaw: description,
    payeeId: null,
    status: "posted",
    externalId: null,
    fingerprint: fingerprint(accountId, description),
    fingerprintVersion: 1,
    importId: null,
    performedBy: null,
    transferGroupId: null,
    needsReview: false,
    isHidden: false,
    nameHiddenBy: null,
    nameHiddenUntil: null,
    notes: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  });
  const split = (transactionId: Id<"Transaction">, over: Partial<SplitRow> = {}): SplitRow => ({
    id: newId<"Split">(),
    transactionId,
    amountCents: -1250,
    categoryId: null,
    activityId: null,
    beneficiary: "shared",
    propertyId: null,
    taxCategoryId: null,
    deductibleBp: null,
    memo: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  });
  const tx = <R>(fn: (r: TxRepos) => R): R => uow.transaction(fn);
  const step = (name: string, fn: (r: TxRepos) => unknown) => {
    out[name] = attempt(() => tx(fn));
  };
  const person = (id: Id<"Person">, name: string) => ({
    id,
    userId: null,
    displayName: name,
    colour: "#000000",
    createdAt: T,
    updatedAt: T,
    deletedAt: null,
  });

  tx((r) => {
    r.person.insert(person(a, "A"));
    r.person.insert(person(b, "B"));
    r.accounts.insert(account(shared, false), [
      { accountId: shared, personId: a, shareBp: 5000, createdAt: T, updatedAt: T },
      { accountId: shared, personId: b, shareBp: 5000, createdAt: T, updatedAt: T },
    ]);
    r.accounts.insert(account(privA, true), [
      { accountId: privA, personId: a, shareBp: 10000, createdAt: T, updatedAt: T },
    ]);
    r.accounts.insert(account(privB, true), [
      { accountId: privB, personId: b, shareBp: 10000, createdAt: T, updatedAt: T },
    ]);
  });

  // Institutions and the account foreign key.
  const bank = newId<"Institution">();
  step("institution.insert", (r) =>
    r.institutions.insert({
      id: bank,
      name: "Bank",
      kind: "bank",
      websiteUrl: null,
      createdAt: T,
      updatedAt: T,
    }),
  );
  step("account.unknownInstitution", (r) =>
    r.accounts.insert({ ...account(newId<"Account">(), false), institutionId: newId() }, []),
  );
  step("institution.softDelete", (r) => r.institutions.softDelete(bank, T));
  out["institution.afterDelete"] = tx((r) => [
    r.institutions.find(system, bank),
    r.institutions.list(system),
    r.institutions.softDelete(bank, T),
  ]);

  // Transactions: unique keys, visibility, soft delete kept for dedupe.
  const t1 = txn(shared, "joint", { externalId: "ext-1" });
  step("txn.insert", (r) => r.transactions.insert(t1, [split(t1.id)]));
  step("txn.duplicateFingerprint", (r) => r.transactions.insert(txn(shared, "joint"), []));
  step("txn.duplicateExternalId", (r) =>
    r.transactions.insert(txn(shared, "other", { externalId: "ext-1" }), []),
  );
  step("txn.sameExternalIdOtherAccount", (r) =>
    r.transactions.insert(txn(privA, "other", { externalId: "ext-1" }), []),
  );
  step("txn.twoNullExternalIds", (r) => {
    r.transactions.insert(txn(shared, "n1"), []);
    r.transactions.insert(txn(shared, "n2"), []);
  });
  step("txn.unknownPayee", (r) =>
    r.transactions.insert(txn(shared, "p", { payeeId: newId() }), []),
  );
  const tA = txn(privA, "a-only");
  const tB = txn(privB, "b-only");
  tx((r) => {
    r.transactions.insert(tA, [split(tA.id, { beneficiary: a })]);
    r.transactions.insert(tB, [split(tB.id, { beneficiary: b })]);
  });
  const names = (v: Viewer) => (r: TxRepos) =>
    r.transactions.listVisible(v, TODAY).map((row) => row.descriptionRaw);
  out["txn.listA"] = tx(names(asA));
  out["txn.listB"] = tx(names(asB));
  out["txn.listSystem"] = tx(names(system));
  out["txn.findPrivateAsOther"] = tx((r) => r.transactions.findVisible(asB, tA.id, TODAY));
  out["txn.findAsOwner"] = tx((r) => r.transactions.findVisible(asA, tA.id, TODAY)?.splits.length);
  out["txn.softDeleteAsOther"] = tx((r) => r.transactions.softDelete(asB, tA.id, T));
  out["txn.softDeleteAsOwner"] = tx((r) => r.transactions.softDelete(asA, tA.id, T));
  out["txn.afterDeleteA"] = tx(names(asA));
  out["txn.afterDeleteFind"] = tx((r) => r.transactions.findVisible(system, tA.id, TODAY));
  step("txn.reinsertDeleted", (r) => r.transactions.insert(txn(privA, "a-only"), []));

  // Transfer groups: visible through a visible transaction.
  const g1 = newId<"TransferGroup">();
  const g2 = newId<"TransferGroup">();
  tx((r) => {
    r.transferGroups.insert({ id: g1, matchedBy: "manual", createdAt: T, updatedAt: T });
    r.transferGroups.insert({ id: g2, matchedBy: "auto", createdAt: T, updatedAt: T });
    r.transactions.insert(txn(shared, "out", { transferGroupId: g1 }), []);
    r.transactions.insert(txn(privB, "in", { transferGroupId: g2 }), []);
  });
  out["group.visible"] = tx((r) => [
    r.transferGroups.find(asA, g1)?.id === g1,
    r.transferGroups.find(asA, g2),
    r.transferGroups.find(asB, g2)?.id === g2,
    r.transferGroups.find(system, g2)?.id === g2,
  ]);
  step("txn.unknownGroup", (r) =>
    r.transactions.insert(txn(shared, "g", { transferGroupId: newId() }), []),
  );

  // Balance snapshots follow account visibility.
  step("snapshot.insert", (r) =>
    r.balanceSnapshots.insert({
      id: newId<"BalanceSnapshot">(),
      accountId: privA,
      asOf: "2026-09-01",
      balanceCents: 100,
      source: "manual",
      createdAt: T,
      updatedAt: T,
    }),
  );
  out["snapshot.list"] = tx((r) => [
    r.balanceSnapshots.listVisible(asA, privA).length,
    r.balanceSnapshots.listVisible(asB, privA).length,
    r.balanceSnapshots.listVisible(system, privA).length,
  ]);

  // Categories and tax categories.
  const grp = newId<"CategoryGroup">();
  const cat = newId<"Category">();
  step("categoryGroup.insert", (r) =>
    r.categoryGroups.insert({
      id: grp,
      name: "Food",
      kind: "expense",
      sort: 1,
      createdAt: T,
      updatedAt: T,
    }),
  );
  step("categoryGroup.duplicateName", (r) =>
    r.categoryGroups.insert({
      id: newId<"CategoryGroup">(),
      name: "Food",
      kind: "expense",
      sort: 2,
      createdAt: T,
      updatedAt: T,
    }),
  );
  const category = (id: Id<"Category">, name: string) => ({
    id,
    groupId: grp,
    name,
    isFixedCost: false,
    createdAt: T,
    updatedAt: T,
  });
  step("category.insert", (r) => r.categories.insert(category(cat, "Groceries")));
  step("category.duplicateName", (r) => r.categories.insert(category(newId(), "Groceries")));
  step("category.unknownGroup", (r) =>
    r.categories.insert({ ...category(newId(), "X"), groupId: newId() }),
  );
  out["category.softDelete"] = tx((r) => r.categories.softDelete(cat, T));
  out["category.afterDelete"] = tx((r) => [
    r.categories.find(system, cat),
    r.categories.list(system),
  ]);
  step("category.reuseDeletedName", (r) => r.categories.insert(category(newId(), "Groceries")));
  step("taxCategory.insert", (r) =>
    r.taxCategories.insert({
      id: newId<"TaxCategory">(),
      code: "D1",
      label: "Car",
      defaultDeductibleBp: 10000,
      createdAt: T,
      updatedAt: T,
    }),
  );
  step("taxCategory.duplicateCode", (r) =>
    r.taxCategories.insert({
      id: newId<"TaxCategory">(),
      code: "D1",
      label: "Again",
      defaultDeductibleBp: 0,
      createdAt: T,
      updatedAt: T,
    }),
  );
  step("taxCategory.badBp", (r) =>
    r.taxCategories.insert({
      id: newId<"TaxCategory">(),
      code: "D2",
      label: "Bad",
      defaultDeductibleBp: 10001,
      createdAt: T,
      updatedAt: T,
    }),
  );
  const liveCat = tx((r) => r.categories.list(system)[0]?.id) as Id<"Category">;
  const tcat = tx((r) => r.taxCategories.list(system)[0]?.id) as Id<"TaxCategory">;
  const t2 = txn(shared, "classified");
  step("split.classified", (r) =>
    r.transactions.insert(t2, [
      split(t2.id, { categoryId: liveCat, taxCategoryId: tcat, deductibleBp: 5000 }),
    ]),
  );
  step("split.badDeductible", (r) => {
    const t = txn(shared, "bad");
    r.transactions.insert(t, [split(t.id, { deductibleBp: 10001 })]);
  });
  step("split.unknownCategory", (r) => {
    const t = txn(shared, "bad2");
    r.transactions.insert(t, [split(t.id, { categoryId: newId() })]);
  });

  // Scoped rows (AD-18): same name in shared and an owner's scope, not twice in one scope.
  const payeeRow = (id: Id<"Payee">, name: string, scopePersonId: Id<"Person"> | null) => ({
    id,
    name,
    websiteUrl: null,
    logoAttachmentId: null,
    defaultCategoryId: null,
    scopePersonId,
    createdAt: T,
    updatedAt: T,
  });
  const pShared = newId<"Payee">();
  const pA = newId<"Payee">();
  step("payee.shared", (r) => r.payees.insert(payeeRow(pShared, "Woolworths", null), null));
  step("payee.sameNameInOwnerScope", (r) => r.payees.insert(payeeRow(pA, "Woolworths", a), privA));
  step("payee.sameNameTwiceShared", (r) =>
    r.payees.insert(payeeRow(newId(), "Woolworths", null), null),
  );
  step("payee.sameNameTwiceOwner", (r) =>
    r.payees.insert(payeeRow(newId(), "Woolworths", a), privA),
  );
  step("payee.sameNameOtherOwner", (r) =>
    r.payees.insert(payeeRow(newId(), "Woolworths", b), privB),
  );
  step("payee.unknownOrigin", (r) =>
    r.payees.insert(payeeRow(newId(), "Nowhere", a), newId<"Account">()),
  );
  const payeeIds = (v: Viewer) => (r: TxRepos) => r.payees.list(v).map((p) => p.id);
  out["payee.listA"] = tx(payeeIds(asA));
  out["payee.listB"] = tx(payeeIds(asB));
  out["payee.listSystem"] = tx(payeeIds(system));
  out["payee.findOthersScope"] = tx((r) => r.payees.find(asB, pA));
  out["payee.softDeleteAsOther"] = tx((r) => r.payees.softDelete(asB, pA, T));
  out["payee.softDelete"] = tx((r) => r.payees.softDelete(asA, pA, T));
  out["payee.afterDelete"] = tx((r) => [r.payees.find(system, pA), r.payees.list(asA).length]);
  step("payee.reuseDeletedName", (r) => r.payees.insert(payeeRow(newId(), "Woolworths", a), privA));

  const aliasRow = (pattern: string, scopePersonId: Id<"Person"> | null) => ({
    id: newId<"PayeeAlias">(),
    pattern,
    matchKind: "contains" as const,
    payeeId: pShared,
    scopePersonId,
    createdAt: T,
    updatedAt: T,
  });
  step("alias.shared", (r) => r.payeeAliases.insert(aliasRow("WOOLIES", null), null));
  step("alias.duplicateShared", (r) => r.payeeAliases.insert(aliasRow("WOOLIES", null), null));
  step("alias.ownerScope", (r) => r.payeeAliases.insert(aliasRow("WOOLIES", a), privA));
  out["alias.list"] = tx((r) => [
    r.payeeAliases.list(asA).length,
    r.payeeAliases.list(asB).length,
    r.payeeAliases.list(system).length,
  ]);

  const tagRow = (name: string, scopePersonId: Id<"Person"> | null) => ({
    id: newId<"Tag">(),
    name,
    scopePersonId,
    createdAt: T,
    updatedAt: T,
  });
  const sharedTag = tagRow("holiday", null);
  const ownerTag = tagRow("holiday", a);
  step("tag.shared", (r) => r.tags.insert(sharedTag, null));
  step("tag.owner", (r) => r.tags.insert(ownerTag, privA));
  step("tag.duplicateOwner", (r) => r.tags.insert(tagRow("holiday", a), privA));
  const sp = tx(
    (r) => r.transactions.findVisible(system, t1.id, TODAY)?.splits[0]?.id,
  ) as Id<"Split">;
  step("tag.attach", (r) => {
    r.tags.attach({ splitId: sp, tagId: sharedTag.id, createdAt: T, updatedAt: T });
    r.tags.attach({ splitId: sp, tagId: ownerTag.id, createdAt: T, updatedAt: T });
  });
  step("tag.attachTwice", (r) =>
    r.tags.attach({ splitId: sp, tagId: sharedTag.id, createdAt: T, updatedAt: T }),
  );
  out["tag.forSplit"] = tx((r) => [
    r.tags.listForSplit(asA, sp).length,
    r.tags.listForSplit(asB, sp).length,
    r.tags.listForSplit(system, sp).length,
  ]);
  const tPriv = txn(privA, "tagged-private");
  const privSplit = split(tPriv.id, { beneficiary: a });
  tx((r) => {
    r.transactions.insert(tPriv, [privSplit]);
    r.tags.attach({ splitId: privSplit.id, tagId: sharedTag.id, createdAt: T, updatedAt: T });
  });
  out["tag.forPrivateSplit"] = tx((r) => [
    r.tags.listForSplit(asA, privSplit.id).length,
    r.tags.listForSplit(asB, privSplit.id).length,
    r.tags.listForSplit(system, privSplit.id).length,
  ]);
  out["tag.softDelete"] = tx((r) => [
    r.tags.softDelete(asA, sharedTag.id, T),
    r.tags.list(asA).length,
  ]);

  const act = (name: string, scopePersonId: Id<"Person"> | null, budgetCents: number | null) => ({
    id: newId<"Activity">(),
    name,
    startsOn: "2026-10-01",
    endsOn: null,
    budgetCents,
    scopePersonId,
    createdAt: T,
    updatedAt: T,
  });
  step("activity.shared", (r) => r.activities.insert(act("Japan", null, 5000), null));
  step("activity.duplicate", (r) => r.activities.insert(act("Japan", null, 5000), null));
  step("activity.owner", (r) => r.activities.insert(act("Japan", b, null), privB));
  step("activity.negativeBudget", (r) => r.activities.insert(act("Neg", null, -1), null));
  out["activity.list"] = tx((r) => [
    r.activities.list(asA).length,
    r.activities.list(asB).length,
    r.activities.list(system).length,
  ]);

  // Hidden names, scoped payees and transfer labels (AD-4).
  const pOwn = newId<"Payee">();
  step("priv.payee", (r) => {
    r.payees.insert({ ...payeeRow(pOwn, "A scoped", a), logoAttachmentId: "logo-a" }, privA);
  });
  const hide = (until: string | null, by: Id<"Person"> | null) => ({
    nameHiddenUntil: until,
    nameHiddenBy: by,
  });
  const tHide = txn(shared, "secret", { payeeId: pOwn, ...hide("2027-03-12", a) });
  const tLift = txn(shared, "lifts", hide(TODAY, a));
  const tPrivHide = txn(privA, "priv-hidden", hide("2027-03-12", a));
  const tScoped = txn(shared, "scoped-payee", { payeeId: pOwn });
  const g3 = newId<"TransferGroup">();
  tx((r) => r.transferGroups.insert({ id: g3, matchedBy: "manual", createdAt: T, updatedAt: T }));
  const tOut = txn(shared, "xfer-out", { transferGroupId: g3, amountCents: -500 });
  const tCounter = txn(privB, "xfer-counter", { transferGroupId: g3, amountCents: 500 });
  const tIn = txn(shared, "xfer-in", { transferGroupId: g2, amountCents: 500 });
  tx((r) => {
    for (const t of [tHide, tLift, tPrivHide, tScoped, tOut, tIn, tCounter]) {
      r.transactions.insert(t, []);
    }
  });
  const mine = new Set<string>([tHide, tLift, tPrivHide, tScoped, tOut, tIn].map((t) => t.id));
  const projected = (v: Viewer) => (r: TxRepos) =>
    r.transactions
      .listVisible(v, TODAY)
      .filter((row) => mine.has(row.id))
      .map((row) => [
        row.id,
        row.descriptionRaw,
        row.payeeId,
        row.payeeName,
        row.logoAttachmentId,
        row.nameHidden,
        row.transferLabel,
      ]);
  out["priv.asA"] = tx(projected(asA));
  out["priv.asB"] = tx(projected(asB));
  out["priv.asSystem"] = tx(projected(system));
  out["priv.findHiddenAsB"] = tx((r) => r.transactions.findVisible(asB, tHide.id, TODAY));
  out["priv.findHiddenAsA"] = tx((r) => r.transactions.findVisible(asA, tHide.id, TODAY));
  out["priv.findLiftedAsB"] = tx(
    (r) => r.transactions.findVisible(asB, tHide.id, "2027-03-12")?.descriptionRaw,
  );
  out["priv.privHiddenAsB"] = tx((r) => r.transactions.findVisible(asB, tPrivHide.id, TODAY));
  step("priv.missingViewer", (r) => {
    try {
      r.transactions.listVisible(undefined as never, TODAY);
      return "no throw";
    } catch (error) {
      return error instanceof TypeError ? "TypeError" : "other";
    }
  });
  step("priv.badToday", (r) => r.transactions.listVisible(asA, "soon"));

  // Updates, viewer-first deletes, stored origins and cascades (story 2.5).
  const T2 = "2026-09-28T00:00:00.000Z";
  const grpX = newId<"CategoryGroup">();
  const catX = newId<"Category">();
  const catY = newId<"Category">();
  tx((r) => {
    r.categoryGroups.insert({
      id: grpX,
      name: "Other",
      kind: "income",
      sort: 9,
      createdAt: T,
      updatedAt: T,
    });
    r.categories.insert({ ...category(catX, "X"), groupId: grpX });
    r.categories.insert({ ...category(catY, "Y"), groupId: grpX });
  });
  const groupRow = tx((r) => r.categoryGroups.find(system, grpX));
  const catRow = tx((r) => r.categories.find(system, catX));
  const catYRow = tx((r) => r.categories.find(system, catY));
  const taxRow = tx((r) => r.taxCategories.list(system)[0]);
  if (!groupRow || !catRow || !catYRow || !taxRow) throw new Error("fixtures");
  step("categoryGroup.update", (r) =>
    r.categoryGroups.update({
      ...groupRow,
      name: "Renamed",
      kind: "transfer",
      sort: 3,
      updatedAt: T2,
    }),
  );
  step("categoryGroup.updateDuplicate", (r) =>
    r.categoryGroups.update({ ...groupRow, name: "Food", updatedAt: T2 }),
  );
  step("categoryGroup.updateBadKind", (r) =>
    r.categoryGroups.update({ ...groupRow, kind: "nope" as never, updatedAt: T2 }),
  );
  step("categoryGroup.insertBadKind", (r) =>
    r.categoryGroups.insert({ ...groupRow, id: newId(), name: "Bad", kind: "nope" as never }),
  );
  step("categoryGroup.updateMissing", (r) =>
    r.categoryGroups.update({ ...groupRow, id: newId(), updatedAt: T2 }),
  );
  out["categoryGroup.afterUpdate"] = tx((r) => r.categoryGroups.find(system, grpX));
  step("category.update", (r) =>
    r.categories.update({ ...catRow, name: "X2", isFixedCost: true, groupId: grp, updatedAt: T2 }),
  );
  step("category.updateDuplicate", (r) =>
    r.categories.update({ ...catYRow, name: "X2", groupId: grp, updatedAt: T2 }),
  );
  step("category.updateUnknownGroup", (r) =>
    r.categories.update({ ...catYRow, groupId: newId(), updatedAt: T2 }),
  );
  out["category.afterUpdate"] = tx((r) => r.categories.find(system, catX));
  step("taxCategory.update", (r) =>
    r.taxCategories.update({
      ...taxRow,
      label: "Relabelled",
      defaultDeductibleBp: 2500,
      updatedAt: T2,
    }),
  );
  step("taxCategory.updateBadBp", (r) =>
    r.taxCategories.update({ ...taxRow, defaultDeductibleBp: 10001, updatedAt: T2 }),
  );
  out["taxCategory.afterUpdate"] = tx((r) => r.taxCategories.find(system, taxRow.id));

  const pw = newId<"Payee">();
  const pwRow = { ...payeeRow(pw, "Updatable", a), defaultCategoryId: catX };
  step("w.insert", (r) => r.payees.insert(pwRow, privA));
  out["w.originAsA"] = tx((r) => r.payees.originOf(asA, pw));
  out["w.originAsB"] = tx((r) => r.payees.originOf(asB, pw));
  out["w.originAsSystem"] = tx((r) => r.payees.originOf(system, pw));
  out["w.originSharedRow"] = tx((r) => r.payees.originOf(asB, pShared));
  out["w.updateAsOther"] = tx((r) =>
    r.payees.update(asB, { ...pwRow, name: "Hijack", updatedAt: T2 }),
  );
  out["w.deleteAsOther"] = tx((r) => r.payees.softDelete(asB, pw, T2));
  out["w.update"] = tx((r) =>
    r.payees.update(asA, {
      ...pwRow,
      name: "Renamed",
      websiteUrl: "https://w.example",
      updatedAt: T2,
    }),
  );
  out["w.afterUpdate"] = tx((r) => r.payees.find(asA, pw));
  step("w.updateToSharedName", (r) =>
    r.payees.update(asA, { ...pwRow, name: "Woolworths", updatedAt: T2 }),
  );
  step("w.updateDuplicateInScope", (r) => {
    const other = newId<"Payee">();
    r.payees.insert(payeeRow(other, "Taken", a), privA);
    return r.payees.update(asA, { ...pwRow, name: "Taken", updatedAt: T2 });
  });
  step("w.updateUnknownCategory", (r) =>
    r.payees.update(asA, { ...pwRow, name: "Renamed", defaultCategoryId: newId(), updatedAt: T2 }),
  );
  const alw = { ...aliasRow("WOOLIES2", a), payeeId: pw };
  step("w.alias", (r) => r.payeeAliases.insert(alw, privA));
  step("w.aliasShared", (r) =>
    r.payeeAliases.insert({ ...aliasRow("SHARED2", null), payeeId: pShared }, null),
  );
  step("w.aliasBadKind", (r) =>
    r.payeeAliases.insert({ ...alw, id: newId(), pattern: "Q", matchKind: "nope" as never }, privA),
  );
  out["w.aliasUpdateAsOther"] = tx((r) =>
    r.payeeAliases.update(asB, { ...alw, pattern: "X", updatedAt: T2 }),
  );
  out["w.aliasUpdate"] = tx((r) =>
    r.payeeAliases.update(asA, { ...alw, pattern: "WOOLIES3", matchKind: "prefix", updatedAt: T2 }),
  );
  step("w.aliasUpdateBadKind", (r) =>
    r.payeeAliases.update(asA, { ...alw, matchKind: "nope" as never, updatedAt: T2 }),
  );
  step("w.aliasUpdateDuplicate", (r) =>
    r.payeeAliases.update(asA, {
      ...alw,
      pattern: "WOOLIES",
      matchKind: "contains",
      updatedAt: T2,
    }),
  );
  out["w.aliasAfterUpdate"] = tx((r) => r.payeeAliases.find(asA, alw.id));
  out["w.aliasOrigin"] = tx((r) => [
    r.payeeAliases.originOf(asA, alw.id),
    r.payeeAliases.originOf(asB, alw.id),
  ]);
  out["w.cascadeClearDefault"] = tx((r) => r.payees.clearDefaultCategory(catX, T2));
  out["w.afterClear"] = tx((r) => r.payees.find(asA, pw)?.defaultCategoryId);
  out["w.cascadeAliases"] = tx((r) => r.payeeAliases.softDeleteForPayee(pw, T2));
  out["w.afterCascade"] = tx((r) => [
    r.payeeAliases.find(asA, alw.id),
    r.payeeAliases.list(asA).length,
  ]);
  out["w.delete"] = tx((r) => [r.payees.softDelete(asA, pw, T2), r.payees.softDelete(asA, pw, T2)]);
  out["w.afterDelete"] = tx((r) => [r.payees.find(system, pw), r.payees.originOf(system, pw)]);

  const tg = tagRow("renamable", a);
  step("w.tag", (r) => r.tags.insert(tg, privA));
  out["w.tagUpdateAsOther"] = tx((r) => r.tags.update(asB, { ...tg, name: "no", updatedAt: T2 }));
  out["w.tagUpdate"] = tx((r) => r.tags.update(asA, { ...tg, name: "renamed", updatedAt: T2 }));
  step("w.tagUpdateDuplicate", (r) =>
    r.tags.update(asA, { ...tg, name: "holiday", updatedAt: T2 }),
  );
  out["w.tagDeleteAsOther"] = tx((r) => r.tags.softDelete(asB, tg.id, T2));
  out["w.tagDelete"] = tx((r) => [r.tags.softDelete(asA, tg.id, T2), r.tags.originOf(asA, tg.id)]);
  const ac = act("Updatable", b, null);
  step("w.activity", (r) => r.activities.insert(ac, privB));
  out["w.activityUpdateAsOther"] = tx((r) =>
    r.activities.update(asA, { ...ac, name: "no", updatedAt: T2 }),
  );
  out["w.activityUpdate"] = tx((r) =>
    r.activities.update(asB, {
      ...ac,
      name: "Trip",
      endsOn: "2026-11-01",
      budgetCents: 100,
      updatedAt: T2,
    }),
  );
  step("w.activityUpdateNegative", (r) =>
    r.activities.update(asB, { ...ac, name: "Trip", budgetCents: -5, updatedAt: T2 }),
  );
  out["w.activityAfterUpdate"] = tx((r) => r.activities.find(asB, ac.id));
  out["w.activityDeleteAsOther"] = tx((r) => r.activities.softDelete(asA, ac.id, T2));
  out["w.activityDelete"] = tx((r) => r.activities.softDelete(asB, ac.id, T2));
  const throws = (fn: () => unknown) => {
    try {
      fn();
      return "no throw";
    } catch (error) {
      return error instanceof TypeError ? "TypeError" : "other";
    }
  };
  out["w.missingViewer"] = tx((r) => [
    throws(() => r.payees.softDelete(undefined as never, pw, T2)),
    throws(() => r.tags.update(undefined as never, tg)),
    throws(() => r.activities.originOf(undefined as never, ac.id)),
    throws(() => r.payeeAliases.update(undefined as never, alw)),
  ]);

  // Review item foreign key.
  const reviewItem = (accountId: string | null) => ({
    id: newId<"ReviewItem">(),
    kind: "test.x",
    accountId,
    personId: null,
    entityRef: "e",
    dedupeKey: `k-${accountId}`,
    createdAt: T,
    resolvedAt: null,
    resolution: null,
  });
  step("reviewItem.unknownAccount", (r) => r.reviewItems.raise(reviewItem("nobody")).inserted);
  step("reviewItem.knownAccount", (r) => r.reviewItems.raise(reviewItem(shared)).inserted);
  return out;
}

describe("ledger and classification schema on SQLite", () => {
  it("answers the I/O matrix", () => {
    const out = scenario(createUnitOfWork(db));
    expect(out["txn.duplicateFingerprint"]).toBe("error:UNIQUE");
    expect(out["txn.duplicateExternalId"]).toBe("error:UNIQUE");
    expect(out["txn.sameExternalIdOtherAccount"]).toBe("ok");
    expect(out["txn.twoNullExternalIds"]).toBe("ok");
    expect(out["txn.reinsertDeleted"]).toBe("error:UNIQUE");
    expect(out["reviewItem.unknownAccount"]).toBe("error:FOREIGN KEY");
    expect(out["reviewItem.knownAccount"]).toBe(true);
    expect(out["payee.sameNameInOwnerScope"]).toBe("ok");
    expect(out["payee.sameNameTwiceShared"]).toBe("error:UNIQUE");
    expect(out["payee.sameNameTwiceOwner"]).toBe("error:UNIQUE");
    expect(out["payee.sameNameOtherOwner"]).toBe("ok");
    expect(out["category.afterDelete"]).toEqual([undefined, []]);
    expect(out["institution.afterDelete"]).toEqual([undefined, [], false]);
    expect(out["txn.listA"]).toContain("joint");
    expect(out["txn.listA"]).not.toContain("b-only");
    expect(out["txn.findPrivateAsOther"]).toBeUndefined();
    expect(out["tag.forSplit"]).toEqual([2, 1, 2]);
    expect(out["tag.forPrivateSplit"]).toEqual([1, 0, 1]);
    expect(out["w.updateAsOther"]).toBe(false);
    expect(out["w.deleteAsOther"]).toBe(false);
    expect(out["w.originAsB"]).toBeUndefined();
    expect(out["w.originSharedRow"]).toBeNull();
    expect(out["w.update"]).toBe(true);
    expect(out["w.updateToSharedName"]).toBe("error:UNIQUE");
    expect(out["w.updateDuplicateInScope"]).toBe("error:UNIQUE");
    expect(out["w.updateUnknownCategory"]).toBe("error:FOREIGN KEY");
    expect(out["categoryGroup.insertBadKind"]).toBe("error:CHECK");
    expect(out["categoryGroup.updateBadKind"]).toBe("error:CHECK");
    expect(out["w.aliasBadKind"]).toBe("error:CHECK");
    expect(out["w.aliasUpdateBadKind"]).toBe("error:CHECK");
    expect(out["taxCategory.updateBadBp"]).toBe("error:CHECK");
    expect(out["w.delete"]).toEqual([true, false]);
    expect(out["w.missingViewer"]).toEqual(["TypeError", "TypeError", "TypeError", "TypeError"]);
  });

  it("keeps the scoped origin account in the database, never in a row", () => {
    scenario(createUnitOfWork(db));
    expect(
      db.prepare("SELECT count(*) FROM payee WHERE origin_account_id IS NOT NULL").pluck().get(),
    ).toBe(5);
    const row = createUnitOfWork(db).read((r) => r.payees.list(systemViewer("cli:test"))[0]);
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {})).not.toContain("originAccountId");
  });

  it("makes every new table STRICT", () => {
    const names = [
      "institution",
      "balance_snapshot",
      "transfer_group",
      "category_group",
      "category",
      "tag",
      "split_tag",
      "activity",
      "payee",
      "payee_alias",
      "tax_category",
    ];
    const strict = db
      .prepare(
        "SELECT name FROM pragma_table_list WHERE strict = 1 AND name IN (SELECT value FROM json_each(?)) ORDER BY name",
      )
      .pluck()
      .all(JSON.stringify(names));
    expect(strict).toEqual([...names].sort());
  });

  it("has real foreign keys where the plan says, and none on logo and property", () => {
    const fks = (table: string) =>
      db
        .prepare(`SELECT "from" FROM pragma_foreign_key_list('${table}') ORDER BY "from"`)
        .pluck()
        .all();
    expect(fks("transaction")).toEqual(
      ["account_id", "name_hidden_by", "payee_id", "performed_by", "transfer_group_id"].sort(),
    );
    expect(fks("split")).toEqual(
      ["activity_id", "category_id", "tax_category_id", "transaction_id"].sort(),
    );
    expect(fks("review_item")).toEqual(["account_id", "person_id"]);
    expect(fks("payee")).toEqual(["default_category_id", "origin_account_id", "scope_person_id"]);
  });

  it("keeps rows when 0008 upgrades to 0009", () => {
    const old = openDatabase(join(dir, "old.sqlite"));
    const migrations = loadMigrations(packageMigrationsDir);
    migrate(old, migrations.slice(0, 9));
    old.exec(`
      INSERT INTO person (id, display_name, colour, created_at, updated_at) VALUES ('P1','A','#000000','t','t');
      INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('A1','Joint','transaction','AUD',0,'t','t');
      INSERT INTO "transaction" (id, account_id, posted_on, amount_cents, description_raw, status, created_at, updated_at) VALUES ('T1','A1','2026-09-01',-100,'same','posted','t','t'), ('T2','A1','2026-09-01',-100,'same','posted','t','t');
      INSERT INTO split (id, transaction_id, amount_cents, beneficiary, created_at, updated_at) VALUES ('S1','T1',-100,'shared','t','t');
      INSERT INTO review_item (id, kind, account_id, entity_ref, dedupe_key, created_at) VALUES ('R1','k','A1','e','d','t');
    `);
    expect(migrate(old, migrations).applied).toEqual(["0009_ledger_classification_schema"]);
    expect(old.pragma("foreign_key_check")).toEqual([]);
    expect(
      old
        .prepare(
          'SELECT id, fingerprint, fingerprint_version, needs_review, is_hidden FROM "transaction" ORDER BY id',
        )
        .all(),
    ).toEqual([
      { id: "T1", fingerprint: "T1", fingerprint_version: 0, needs_review: 0, is_hidden: 0 },
      { id: "T2", fingerprint: "T2", fingerprint_version: 0, needs_review: 0, is_hidden: 0 },
    ]);
    expect(old.prepare("SELECT id, account_id FROM review_item").all()).toEqual([
      { id: "R1", account_id: "A1" },
    ]);
    expect(old.prepare("SELECT count(*) FROM split").pluck().get()).toBe(1);
    expect(old.prepare("SELECT is_savings FROM account").pluck().get()).toBe(0);
    expect(
      old
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'review_item_dedupe_key_open_idx'",
        )
        .pluck()
        .get(),
    ).toBe("review_item_dedupe_key_open_idx");
    expect(() =>
      old.exec(
        "INSERT INTO review_item (id, kind, account_id, person_id, entity_ref, dedupe_key, created_at) VALUES ('R2','k','A1','P1','e','d2','t')",
      ),
    ).toThrow(/review_item_scope/);
    old.close();
  });
});

describe("memory and SQLite repositories agree", () => {
  it("gives the same answers to the same sequence", () => {
    const sqlite = scenario(createUnitOfWork(db));
    const memory = scenario(memoryUnitOfWork());
    expect(memory).toEqual(sqlite);
  });
});
