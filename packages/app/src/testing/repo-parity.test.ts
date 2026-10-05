// The repositories of story 2.2 on real SQLite, and the same scenario against the in-memory unit
// of work, which must agree with it (the parity test at the end). It sits beside the memory unit
// of work, which is not exported from the package: a test file here may import the adapter.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../errors.ts";
import { fixedClockAt, personViewer, setPrivacy, type Viewer } from "../index.ts";
import type {
  AccountRow,
  SplitRow,
  TransactionRow,
  TxRepos,
  UnitOfWork,
} from "../ports/unit-of-work.ts";
import { systemViewer } from "../system-viewer.ts";
import { memoryUnitOfWork } from "./memory-uow.ts";

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

const softDeleteInSqlite = (id: string) =>
  db.prepare("UPDATE account SET deleted_at = ? WHERE id = ?").run(T, id);

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
function scenario(
  uow: UnitOfWork,
  softDeleteAccount: (id: Id<"Account">) => void,
): Record<string, unknown> {
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
    categorySource: null,
    activitySource: null,
    taxCategorySource: null,
    beneficiarySource: null,
    deductibleBpSource: null,
    createdAt: T,
    updatedAt: T,
    ...over,
  });
  const T2 = "2026-09-28T00:00:00.000Z";
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
  // Members of a group: live only, split into what the viewer sees and the count it does not.
  const g4 = newId<"TransferGroup">();
  const m1 = txn(shared, "m-shared", { transferGroupId: g4 });
  const m2 = txn(privB, "m-privB", { transferGroupId: g4 });
  const m3 = txn(shared, "m-deleted", { transferGroupId: g4 });
  tx((r) => {
    r.transferGroups.insert({ id: g4, matchedBy: "manual", createdAt: T, updatedAt: T });
    for (const row of [m1, m2, m3]) r.transactions.insert(row, []);
  });
  const membersOf = (v: Viewer) => (r: TxRepos) => {
    const { rows, hidden } = r.transferGroups.members(v, g4);
    return { rows: rows.map((row) => row.descriptionRaw), hidden };
  };
  out["group.members.beforeDelete"] = tx((r) => [
    membersOf(asA)(r),
    membersOf(asB)(r),
    membersOf(system)(r),
    r.transferGroups.upkeepMembers(g4).map((row) => row.descriptionRaw),
  ]);
  out["group.members.softDelete"] = tx((r) => r.transactions.softDelete(system, m3.id, T));
  out["group.members.afterDelete"] = tx((r) => [
    membersOf(asA)(r),
    membersOf(asB)(r),
    membersOf(system)(r),
    r.transferGroups.upkeepMembers(g4).map((row) => row.descriptionRaw),
    r.transferGroups.members(asA, newId<"TransferGroup">()),
    r.transferGroups.upkeepMembers(newId<"TransferGroup">()),
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
  step("tag.replaceOnSplit", (r) =>
    r.tags.replaceForSplit(system, sp, [sharedTag.id, ownerTag.id], T),
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
    r.tags.replaceForSplit(system, privSplit.id, [sharedTag.id], T);
  });
  out["tag.forPrivateSplit"] = tx((r) => [
    r.tags.listForSplit(asA, privSplit.id).length,
    r.tags.listForSplit(asB, privSplit.id).length,
    r.tags.listForSplit(system, privSplit.id).length,
  ]);
  // Provenance columns, replaceSplits, updateSplit, replaceForSplit, listForSplits.
  const view = (r: TxRepos, id: string) => r.transactions.findVisible(system, id, TODAY)?.splits;
  const extra = split(t1.id, { amountCents: 0, beneficiary: a, beneficiarySource: "user" });
  step("split.replaceAddsAndKeeps", (r) => {
    const keep = view(r, t1.id)?.find((x) => x.id === sp) as SplitRow;
    r.transactions.replaceSplits(t1.id, [
      { ...keep, amountCents: -1000, categorySource: "rule", updatedAt: T2 },
      { ...extra, amountCents: -250 },
    ]);
  });
  out["split.afterReplace"] = tx((r) => view(r, t1.id));
  out["split.tagsKeptOnReplace"] = tx((r) => r.tags.listForSplit(system, sp).length);
  step("split.badSource", (r) =>
    r.transactions.replaceSplits(t1.id, [
      { ...(view(r, t1.id)?.[0] as SplitRow), categorySource: "bogus" as never },
    ]),
  );
  step("split.badBeneficiary", (r) =>
    r.transactions.updateSplit({ ...(view(r, t1.id)?.[0] as SplitRow), beneficiary: "" }),
  );
  step("split.updateUnknownCategory", (r) =>
    r.transactions.updateSplit({ ...(view(r, t1.id)?.[0] as SplitRow), categoryId: newId() }),
  );
  out["split.updateSplit"] = tx((r) => [
    r.transactions.updateSplit({
      ...(view(r, t1.id)?.find((x) => x.id === extra.id) as SplitRow),
      deductibleBp: 5000,
      deductibleBpSource: "user",
      updatedAt: T2,
    }),
    r.transactions.updateSplit({ ...extra, id: newId<"Split">() }),
  ]);
  out["split.afterUpdate"] = tx((r) => view(r, t1.id));
  out["tag.listForSplits"] = tx((r) => [
    r.tags
      .listForSplits(asA, [sp, privSplit.id, extra.id])
      .map((x) => [x.splitId === sp, x.splitId === privSplit.id, x.tag.name, x.tag.scopePersonId]),
    r.tags.listForSplits(asB, [sp, privSplit.id]).map((x) => [x.tag.name]),
    r.tags.listForSplits(system, []).length,
  ]);
  out["tag.replaceForSplit"] = tx((r) => {
    r.tags.replaceForSplit(system, extra.id, [sharedTag.id, ownerTag.id], T2);
    const first = r.tags.listForSplit(system, extra.id).map((x) => x.name);
    r.tags.replaceForSplit(system, extra.id, [ownerTag.id], T2);
    const second = r.tags.listForSplit(system, extra.id).map((x) => x.id === ownerTag.id);
    r.tags.replaceForSplit(system, extra.id, [], T2);
    return [first, second, r.tags.listForSplit(system, extra.id).length];
  });
  step("tag.replaceForSplitUnknownTag", (r) =>
    r.tags.replaceForSplit(system, extra.id, [newId()], T2),
  );
  tx((r) => r.tags.replaceForSplit(system, extra.id, [sharedTag.id], T2));
  out["tag.hiddenSurvives"] = tx((r) => {
    r.tags.replaceForSplit(system, extra.id, [sharedTag.id, ownerTag.id], T2);
    // B cannot see A's scoped tag, so B's whole-set replace leaves it on the split.
    r.tags.replaceForSplit(asB, extra.id, [], T2);
    return r.tags.listForSplit(system, extra.id).map((x) => [x.name, x.scopePersonId !== null]);
  });
  tx((r) => r.tags.replaceForSplit(system, extra.id, [sharedTag.id], T2));
  step("split.replaceDropsSplitAndTags", (r) =>
    r.transactions.replaceSplits(t1.id, [view(r, t1.id)?.find((x) => x.id === sp) as SplitRow]),
  );
  out["split.afterDrop"] = tx((r) => [
    view(r, t1.id)?.map((x) => x.id === sp),
    r.tags.listForSplits(system, [extra.id]).length,
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
  const tHide = txn(shared, "secret", {
    payeeId: pOwn,
    externalId: "ext-hide",
    ...hide("2027-03-12", a),
  });
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
        row.fingerprint,
        row.externalId,
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
  // The stored row: real names for every viewer who may see the row, live rows only.
  const stored = (v: Viewer, id: string) => (r: TxRepos) => {
    const row = r.transactions.findStored(v, id);
    return row === undefined
      ? undefined
      : [row.descriptionRaw, row.payeeId, row.fingerprint, row.externalId, row.splits.length];
  };
  out["priv.storedHiddenAsB"] = tx(stored(asB, tHide.id));
  out["priv.storedHiddenAsA"] = tx(stored(asA, tHide.id));
  out["priv.storedPrivateAsB"] = tx(stored(asB, tPrivHide.id));
  out["priv.storedDeleted"] = tx(stored(system, tA.id));
  out["priv.storedWithSplits"] = tx(stored(asB, t1.id));
  step("priv.storedMissingViewer", (r) => {
    try {
      r.transactions.findStored(undefined as never, tHide.id);
      return "no throw";
    } catch (error) {
      return error instanceof TypeError ? "TypeError" : "other";
    }
  });
  // The audit scrub: name keys nulled while hidden, kept but never added.
  const auditRow = (before: object | null, after: object | null) => ({
    id: newId<"AuditLog">(),
    at: T,
    actor: `person:${b}`,
    entity: "transaction",
    entityId: tHide.id,
    accountId: shared,
    personId: null,
    action: "update",
    before: before === null ? null : JSON.stringify(before),
    after: after === null ? null : JSON.stringify(after),
  });
  const full = {
    descriptionRaw: "secret",
    payeeId: pOwn,
    fingerprint: "fp",
    externalId: "ext-hide",
    notes: "n",
  };
  tx((r) => {
    r.audit.append(auditRow(full, { ...full, notes: "m" }));
    r.audit.append(auditRow({ transferGroupId: "g", notes: null }, null));
  });
  const auditOf = (v: Viewer) => (r: TxRepos) =>
    r.audit
      .listVisible(v, TODAY)
      .filter((row) => row.entityId === tHide.id)
      .map((row) => [row.before, row.after, row.hiddenUntil]);
  out["priv.auditAsB"] = tx(auditOf(asB));
  out["priv.auditAsA"] = tx(auditOf(asA));
  // Not hidden: a payee another person scoped is nulled for the partner, a shared one kept.
  tx((r) => {
    r.audit.append({
      ...auditRow({ descriptionRaw: "scoped-payee", payeeId: pOwn }, { payeeId: pShared }),
      entityId: tScoped.id,
    });
  });
  const scopedAudit = (v: Viewer) => (r: TxRepos) =>
    r.audit
      .listVisible(v, TODAY)
      .filter((row) => row.entityId === tScoped.id)
      .map((row) => [row.before, row.after, row.hiddenUntil]);
  out["priv.auditScopedAsB"] = tx(scopedAudit(asB));
  out["priv.auditScopedAsA"] = tx(scopedAudit(asA));
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
  // A row the viewer cannot see is never checked, so its bad foreign key is just `false`; for a
  // row they can, UNIQUE answers before the foreign key does.
  step("w.updateUnknownCategoryAsOther", (r) =>
    r.payees.update(asB, { ...pwRow, name: "Renamed", defaultCategoryId: newId(), updatedAt: T2 }),
  );
  step("w.updateDuplicateAndUnknownCategory", (r) =>
    r.payees.update(asA, {
      ...pwRow,
      name: "Woolworths",
      defaultCategoryId: newId(),
      updatedAt: T2,
    }),
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
  step("w.activityUpdateNegativeAsOther", (r) =>
    r.activities.update(asA, { ...ac, name: "Trip", budgetCents: -5, updatedAt: T2 }),
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

  // Accounts: owner order and replacement, and the CHECKs of every table the matrix touches.
  const owner = (accountId: Id<"Account">, personId: Id<"Person">, shareBp: number, at = T) => ({
    accountId,
    personId,
    shareBp,
    createdAt: at,
    updatedAt: at,
  });
  const ownedAcct = newId<"Account">();
  step("owners.insertOrdered", (r) =>
    r.accounts.insert(account(ownedAcct, false), [
      owner(ownedAcct, b, 5000, T2),
      owner(ownedAcct, a, 5000, T),
    ]),
  );
  out["owners.order"] = tx((r) => r.accounts.owners(ownedAcct).map((o) => o.personId === a));
  step("owners.insertBadShare", (r) => {
    const id = newId<"Account">();
    r.accounts.insert(account(id, false), [owner(id, a, 0)]);
  });
  step("owners.insertDuplicate", (r) => {
    const id = newId<"Account">();
    r.accounts.insert(account(id, false), [owner(id, a, 5000), owner(id, a, 5000)]);
  });
  step("owners.insertUnknownPerson", (r) => {
    const id = newId<"Account">();
    r.accounts.insert(account(id, false), [owner(id, newId<"Person">(), 5000)]);
  });
  step("account.badType", (r) =>
    r.accounts.insert({ ...account(newId<"Account">(), false), type: "bogus" as never }, []),
  );
  step("owners.replace", (r) =>
    r.accounts.replaceOwners(ownedAcct, [owner(ownedAcct, b, 6000, T2), owner(ownedAcct, a, 4000)]),
  );
  out["owners.afterReplace"] = tx((r) =>
    r.accounts.owners(ownedAcct).map((o) => [o.personId === a, o.shareBp]),
  );
  step("owners.replaceKeepsPerson", (r) =>
    r.accounts.replaceOwners(ownedAcct, [owner(ownedAcct, a, 10000)]),
  );
  step("owners.replaceBadShare", (r) =>
    r.accounts.replaceOwners(ownedAcct, [owner(ownedAcct, a, 10001)]),
  );
  step("owners.replaceDuplicate", (r) =>
    r.accounts.replaceOwners(ownedAcct, [owner(ownedAcct, a, 5000), owner(ownedAcct, a, 5000)]),
  );
  step("owners.replaceUnknownPerson", (r) =>
    r.accounts.replaceOwners(ownedAcct, [owner(ownedAcct, newId<"Person">(), 5000)]),
  );
  step("owners.replaceUnknownAccount", (r) => {
    const id = newId<"Account">();
    r.accounts.replaceOwners(id, [owner(id, a, 5000)]);
  });
  step("owners.replaceUnknownAccountEmpty", (r) => r.accounts.replaceOwners(newId(), []));
  out["owners.afterFailures"] = tx((r) =>
    r.accounts.owners(ownedAcct).map((o) => [o.personId === a, o.shareBp]),
  );
  step("owners.replaceEmpty", (r) => r.accounts.replaceOwners(ownedAcct, []));
  out["owners.afterEmpty"] = tx((r) => r.accounts.owners(ownedAcct).length);

  // Privacy switches (story 2.15): splits for others, scoped references and the audit stamp.
  const swOwn = newId<"Account">();
  tx((r) => r.accounts.insert(account(swOwn, true), [owner(swOwn, a, 10000)]));
  const forOthers = (r: TxRepos) => [
    r.accounts.hasSplitForOthers(swOwn, a),
    r.accounts.hasSplitForOthers(swOwn, b),
  ];
  out["switch.forOthersEmpty"] = tx(forOthers);
  const swMine = txn(swOwn, "mine");
  step("switch.insertMine", (r) =>
    r.transactions.insert(swMine, [split(swMine.id, { beneficiary: a })]),
  );
  out["switch.forOthersMine"] = tx(forOthers);
  const swPartner = txn(swOwn, "partner");
  step("switch.insertPartner", (r) =>
    r.transactions.insert(swPartner, [split(swPartner.id, { beneficiary: b })]),
  );
  out["switch.forOthersPartner"] = tx(forOthers);
  out["switch.deletePartner"] = tx((r) => r.transactions.softDelete(system, swPartner.id, T2));
  out["switch.forOthersAfterDelete"] = tx(forOthers);
  const swShared = txn(swOwn, "shared");
  step("switch.insertShared", (r) =>
    r.transactions.insert(swShared, [split(swShared.id, { beneficiary: "shared" })]),
  );
  out["switch.forOthersShared"] = tx(forOthers);

  const swPriv = newId<"Account">();
  tx((r) => r.accounts.insert(account(swPriv, true), [owner(swPriv, a, 10000)]));
  const pZed = newId<"Payee">();
  const pAlpha = newId<"Payee">();
  const swTag = tagRow("trip", a);
  const swDeadTag = tagRow("unused", a);
  const swSharedTag = tagRow("trip", null);
  const swAct = act("Bali", a, null);
  tx((r) => {
    r.payees.insert(payeeRow(pZed, "Zed", a), swPriv);
    r.payees.insert(payeeRow(pAlpha, "Alpha", a), swPriv);
    r.tags.insert(swTag, swPriv);
    r.tags.insert(swDeadTag, swPriv);
    r.tags.insert(swSharedTag, null);
    r.activities.insert(swAct, swPriv);
  });
  const swT1 = txn(swPriv, "sw1", { payeeId: pZed });
  const swS1 = split(swT1.id, { beneficiary: a, activityId: swAct.id });
  const swT2 = txn(swPriv, "sw2", { payeeId: pAlpha });
  const swT3 = txn(swPriv, "sw3", { payeeId: pShared });
  const swT4 = txn(swPriv, "sw4", { payeeId: pAlpha });
  const swS4 = split(swT4.id, { beneficiary: a });
  tx((r) => {
    r.transactions.insert(swT1, [swS1]);
    r.transactions.insert(swT2, [split(swT2.id, { beneficiary: a })]);
    r.transactions.insert(swT3, [split(swT3.id, { beneficiary: a })]);
    r.transactions.insert(swT4, [swS4]);
    r.tags.replaceForSplit(system, swS1.id, [swTag.id, swSharedTag.id], T);
    r.tags.replaceForSplit(system, swS4.id, [swDeadTag.id], T);
    // The only use of the "unused" tag is on a soft-deleted transaction: not listed.
    r.transactions.softDelete(system, swT4.id, T2);
  });
  const refs = (r: TxRepos) => {
    const found = r.accounts.scopedReferences(swPriv);
    return [found.payees, found.tags, found.activities].map((list) =>
      list.map((x) => [x.name, Object.keys(x).sort().join(",")]),
    );
  };
  out["switch.refs"] = tx(refs);
  out["switch.refsOtherAccount"] = tx((r) => r.accounts.scopedReferences(swOwn));
  const switchCtx = {
    viewer: asA,
    clock: fixedClockAt(TODAY),
    newId,
    uow,
  };
  const refused = (fn: () => unknown) => {
    try {
      fn();
      return "ok";
    } catch (error) {
      return error instanceof AppError
        ? [error.code, error.message, JSON.stringify(error.details)]
        : "other";
    }
  };
  out["switch.publicRefused"] = refused(() =>
    setPrivacy(switchCtx, { id: swPriv, isPrivate: false }),
  );
  // Soft-deleting the scoped rows does not free the account: live transactions still use them.
  out["switch.softDeleteScoped"] = tx((r) => [
    r.payees.softDelete(asA, pZed, T2),
    r.tags.softDelete(asA, swTag.id, T2),
    r.activities.softDelete(asA, swAct.id, T2),
  ]);
  out["switch.refsAfterSoftDelete"] = tx(refs);
  out["switch.publicRefusedAfterSoftDelete"] = refused(() =>
    setPrivacy(switchCtx, { id: swPriv, isPrivate: false }),
  );
  out["switch.stillPrivate"] = tx((r) => r.accounts.findVisible(system, swPriv)?.isPrivate);

  // The stamp: only rows after the most recent switch to private (by at, then id).
  const T3 = "2026-09-29T00:00:00.000Z";
  const T4 = "2026-09-30T00:00:00.000Z";
  const swHist = newId<"Account">();
  const swNew = newId<"Account">();
  tx((r) => {
    r.accounts.insert(account(swHist, false), [owner(swHist, a, 5000), owner(swHist, b, 5000)]);
    r.accounts.insert(account(swNew, true), [owner(swNew, a, 10000)]);
  });
  const histRow = (
    accountId: Id<"Account">,
    action: string,
    at: string,
    over: { personId?: string; before?: object; after?: object; id?: Id<"AuditLog"> } = {},
  ) => ({
    id: over.id ?? newId<"AuditLog">(),
    at,
    actor: `person:${a}`,
    entity: action === "set_privacy" ? "account" : "transaction",
    entityId: accountId,
    accountId,
    personId: over.personId ?? null,
    action,
    before: over.before === undefined ? null : JSON.stringify(over.before),
    after: over.after === undefined ? null : JSON.stringify(over.after),
  });
  const lowId = newId<"AuditLog">();
  tx((r) => {
    for (const row of [
      histRow(swHist, "joint1", T),
      histRow(swHist, "set_privacy", T, {
        before: { isPrivate: false },
        after: { isPrivate: true },
      }),
      histRow(swHist, "private1", T2),
      histRow(swHist, "set_privacy", T2, {
        before: { isPrivate: true },
        after: { isPrivate: false },
      }),
      histRow(swHist, "joint2", T2),
      histRow(swHist, "joint3SameAtLowerId", T3, { id: lowId }),
      histRow(swHist, "set_privacy", T3, {
        before: { isPrivate: false },
        after: { isPrivate: true },
      }),
      histRow(swHist, "private2", T3),
      // A redundant private → private switch is not a transition: the era started at T3.
      histRow(swHist, "set_privacy", T3, {
        before: { isPrivate: true },
        after: { isPrivate: true },
      }),
      histRow(swHist, "private3", T4),
      histRow(swHist, "private4ScopedToB", T4, { personId: b }),
      histRow(swHist, "set_privacy", T4, { after: { isPrivate: "yes" } }),
      histRow(swNew, "created", T),
      histRow(swNew, "private", T2),
      histRow(swOwn, "otherAccount", T4),
    ]) {
      r.audit.append(row);
    }
  });
  const who = (id: string | null) => (id === null ? null : id === a ? "A" : id === b ? "B" : id);
  const stamps = (accountId: Id<"Account">) => (r: TxRepos) =>
    r.audit
      .listVisible(system, TODAY)
      .filter((row) => row.accountId === accountId)
      .map((row) => [row.action, who(row.personId)]);
  step("switch.stampHist", (r) => r.audit.scopeToPerson(swHist, a));
  step("switch.stampNew", (r) => r.audit.scopeToPerson(swNew, a));
  out["switch.stampedHist"] = tx(stamps(swHist));
  out["switch.stampedNew"] = tx(stamps(swNew));
  out["switch.stampedOther"] = tx(stamps(swOwn));

  step("institution.badKind", (r) =>
    r.institutions.insert({
      id: newId<"Institution">(),
      name: "Odd",
      kind: "bogus" as never,
      websiteUrl: null,
      createdAt: T,
      updatedAt: T,
    }),
  );
  const credit = newId<"Institution">();
  tx((r) =>
    r.institutions.insert({
      id: credit,
      name: "Credit",
      kind: "bank",
      websiteUrl: null,
      createdAt: T,
      updatedAt: T,
    }),
  );
  step("institution.updateBadKind", (r) =>
    r.institutions.update({
      id: credit,
      name: "Credit",
      kind: "bogus" as never,
      websiteUrl: null,
      createdAt: T,
      updatedAt: T2,
    }),
  );
  step("group.badMatchedBy", (r) =>
    r.transferGroups.insert({
      id: newId<"TransferGroup">(),
      matchedBy: "bogus" as never,
      createdAt: T,
      updatedAt: T,
    }),
  );
  step("txn.badStatus", (r) =>
    r.transactions.insert(txn(shared, "status", { status: "bogus" as never }), []),
  );
  step("txn.badPostedOn", (r) =>
    r.transactions.insert(txn(shared, "date", { postedOn: "2026-9-1" }), []),
  );
  step("txn.badPostedOnAndDuplicate", (r) =>
    r.transactions.insert(txn(shared, "joint", { postedOn: "soon" }), []),
  );
  const tEdit = txn(shared, "editable");
  tx((r) => r.transactions.insert(tEdit, []));
  const edit = (viewer: Viewer, postedOn: string) => (r: TxRepos) =>
    r.transactions.update(viewer, {
      id: tEdit.id,
      postedOn,
      amountCents: -1,
      notes: null,
      updatedAt: T2,
    });
  step("txn.updateBadPostedOn", edit(asA, "2026-09-1"));
  step("txn.updateBadPostedOnInvisible", (r) =>
    r.transactions.update(asB, {
      id: tA.id,
      postedOn: "nope",
      amountCents: -1,
      notes: null,
      updatedAt: T2,
    }),
  );
  step("txn.updateGoodPostedOn", edit(asA, "2026-09-02"));

  // replaceSplits: a split ID another transaction holds is a primary key violation, and
  // changes neither transaction.
  const tOwner = txn(shared, "split-owner");
  const ownerSplit = split(tOwner.id);
  const tTaker = txn(shared, "split-taker");
  tx((r) => {
    r.transactions.insert(tOwner, [ownerSplit]);
    r.transactions.insert(tTaker, [split(tTaker.id)]);
  });
  step("split.replaceStealsId", (r) =>
    r.transactions.replaceSplits(tTaker.id, [{ ...ownerSplit, transactionId: tTaker.id }]),
  );
  step("split.replaceRepeatsFreshId", (r) => {
    const fresh = split(tTaker.id);
    r.transactions.replaceSplits(tTaker.id, [fresh, fresh]);
  });
  out["split.afterSteal"] = tx((r) => [
    view(r, tOwner.id)?.map((x) => x.id === ownerSplit.id),
    view(r, tTaker.id)?.length,
  ]);
  step("split.insertBadSourceAndUnknownCategory", (r) => {
    const t = txn(shared, "order");
    r.transactions.insert(t, [
      split(t.id, { categorySource: "bogus" as never, categoryId: newId() }),
    ]);
  });
  step("split.insertReusedId", (r) => {
    const t = txn(shared, "reused");
    r.transactions.insert(t, [split(t.id, { id: ownerSplit.id })]);
  });

  // Balances: the latest snapshot on or before the day (ties by created_at, then id), then live
  // transactions after it; a soft-deleted account answers nothing.
  const balAcct = newId<"Account">();
  tx((r) => r.accounts.insert(account(balAcct, false), [owner(balAcct, a, 10000)]));
  const snapshot = (asOf: string, balanceCents: number, createdAt: string, source = "manual") => ({
    id: newId<"BalanceSnapshot">(),
    accountId: balAcct,
    asOf,
    balanceCents,
    source: source as "manual",
    createdAt,
    updatedAt: createdAt,
  });
  step("snapshot.badSource", (r) =>
    r.balanceSnapshots.insert(snapshot("2026-09-01", 1, T, "bogus")),
  );
  step("snapshot.badAsOf", (r) => r.balanceSnapshots.insert(snapshot("09/01/2026", 1, T)));
  tx((r) => {
    r.balanceSnapshots.insert(snapshot("2026-09-01", 1000, T));
    // Same day: the later created_at wins even with the lower ID.
    r.balanceSnapshots.insert(snapshot("2026-09-10", 2000, T2));
    r.balanceSnapshots.insert(snapshot("2026-09-10", 3000, T));
    // Same day and created_at: the higher ID wins.
    r.balanceSnapshots.insert(snapshot("2026-09-15", 4000, T));
    r.balanceSnapshots.insert(snapshot("2026-09-15", 5000, T));
  });
  const balTxn = (postedOn: string, amountCents: number, over: Partial<TransactionRow> = {}) =>
    txn(balAcct, `bal-${postedOn}-${amountCents}`, {
      postedOn,
      amountCents,
      status: "pending",
      ...over,
    });
  const gone = balTxn("2026-09-12", -777, { status: "posted" });
  tx((r) => {
    r.transactions.insert(balTxn("2026-08-20", -10), []);
    r.transactions.insert(balTxn("2026-09-05", -100), []);
    r.transactions.insert(balTxn("2026-09-10", -50), []);
    r.transactions.insert(balTxn("2026-09-20", 25, { status: "posted" }), []);
    r.transactions.insert(gone, []);
  });
  const balances = (viewer: Viewer) => (r: TxRepos) =>
    [
      "2026-08-01",
      "2026-08-25",
      "2026-09-01",
      "2026-09-10",
      "2026-09-12",
      "2026-09-15",
      "2026-09-30",
    ].map((day) => r.balanceSnapshots.balanceAsOf(viewer, balAcct, day));
  out["balance.beforeDelete"] = tx(balances(system));
  out["balance.softDeleteTxn"] = tx((r) => r.transactions.softDelete(system, gone.id, T2));
  out["balance.afterTxnDelete"] = tx(balances(system));
  out["balance.asOther"] = tx(balances(asB));
  out["snapshot.listOrder"] = tx((r) =>
    r.balanceSnapshots.listVisible(system, balAcct).map((x) => [x.asOf, x.balanceCents]),
  );
  softDeleteAccount(balAcct);
  out["balance.afterAccountDelete"] = tx(balances(system));
  out["snapshot.listAfterAccountDelete"] = tx((r) => [
    r.balanceSnapshots.listVisible(system, balAcct).length,
    r.balanceSnapshots.listVisible(asA, balAcct).length,
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
    const out = scenario(createUnitOfWork(db), softDeleteInSqlite);
    expect(out["txn.duplicateFingerprint"]).toBe("error:UNIQUE");
    expect(out["txn.duplicateExternalId"]).toBe("error:UNIQUE");
    expect(out["txn.sameExternalIdOtherAccount"]).toBe("ok");
    expect(out["txn.twoNullExternalIds"]).toBe("ok");
    expect(out["txn.reinsertDeleted"]).toBe("error:UNIQUE");
    expect(out["reviewItem.unknownAccount"]).toBe("error:FOREIGN KEY");
    expect(out["reviewItem.knownAccount"]).toBe(true);
    expect(out["group.members.beforeDelete"]).toEqual([
      { rows: ["m-shared", "m-deleted"], hidden: 1 },
      { rows: ["m-shared", "m-privB", "m-deleted"], hidden: 0 },
      { rows: ["m-shared", "m-privB", "m-deleted"], hidden: 0 },
      ["m-shared", "m-privB", "m-deleted"],
    ]);
    expect(out["group.members.afterDelete"]).toEqual([
      { rows: ["m-shared"], hidden: 1 },
      { rows: ["m-shared", "m-privB"], hidden: 0 },
      { rows: ["m-shared", "m-privB"], hidden: 0 },
      ["m-shared", "m-privB"],
      { rows: [], hidden: 0 },
      [],
    ]);
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
    // Same-day snapshots: the later created_at wins, then the higher ID; soft-deleted lines drop out.
    expect(out["balance.beforeDelete"]).toEqual([0, -10, 1000, 2000, 1223, 5000, 5025]);
    expect(out["balance.afterTxnDelete"]).toEqual([0, -10, 1000, 2000, 2000, 5000, 5025]);
    expect(out["balance.asOther"]).toEqual([0, -10, 1000, 2000, 2000, 5000, 5025]);
    expect(out["balance.afterAccountDelete"]).toEqual(Array(7).fill(undefined));
    expect(out["snapshot.listAfterAccountDelete"]).toEqual([0, 0]);
    expect(out["owners.order"]).toEqual([true, false]);
    expect(out["owners.afterEmpty"]).toBe(0);
    expect(out["split.replaceStealsId"]).toBe("error:UNIQUE");
    expect(out["split.insertBadSourceAndUnknownCategory"]).toBe("error:CHECK");
    expect(out["w.updateUnknownCategoryAsOther"]).toBe(false);
    expect(out["w.updateDuplicateAndUnknownCategory"]).toBe("error:UNIQUE");
    expect(out["w.activityUpdateNegativeAsOther"]).toBe(false);
    expect(out["txn.updateBadPostedOn"]).toBe("error:CHECK");
    expect(out["txn.updateBadPostedOnInvisible"]).toBe(false);
    expect(out["txn.badPostedOnAndDuplicate"]).toBe("error:CHECK");
    expect(out["w.missingViewer"]).toEqual(["TypeError", "TypeError", "TypeError", "TypeError"]);
    // Privacy switches: a split for anyone but the owner counts, live transactions only.
    expect(out["switch.forOthersEmpty"]).toEqual([false, false]);
    expect(out["switch.forOthersMine"]).toEqual([false, true]);
    expect(out["switch.forOthersPartner"]).toEqual([true, true]);
    expect(out["switch.forOthersAfterDelete"]).toEqual([false, true]);
    expect(out["switch.forOthersShared"]).toEqual([true, true]);
    const listed = [
      [
        ["Alpha", "id,name"],
        ["Zed", "id,name"],
      ],
      [["trip", "id,name"]],
      [["Bali", "id,name"]],
    ];
    expect(out["switch.refs"]).toEqual(listed);
    expect(out["switch.refsOtherAccount"]).toEqual({ payees: [], tags: [], activities: [] });
    expect(out["switch.softDeleteScoped"]).toEqual([true, true, true]);
    expect(out["switch.refsAfterSoftDelete"]).toEqual(listed);
    const [code, message, details] = out["switch.publicRefused"] as [string, string, string];
    expect(code).toBe("Conflict");
    expect(message).toContain('payee "Alpha", payee "Zed", tag "trip", activity "Bali"');
    expect(message).toContain("private to A");
    expect(Object.keys(JSON.parse(details))).toEqual(["payees", "tags", "activities", "owners"]);
    expect(JSON.parse(details).owners).toEqual([
      { personId: expect.any(String), displayName: "A" },
    ]);
    expect(out["switch.publicRefusedAfterSoftDelete"]).toEqual(out["switch.publicRefused"]);
    expect(out["switch.stillPrivate"]).toBe(true);
    // The stamp: rows after the most recent switch to private only; the flips stay unscoped.
    expect(out["switch.stampedHist"]).toEqual([
      ["joint1", null],
      ["set_privacy", null],
      ["private1", null],
      ["set_privacy", null],
      ["joint2", null],
      ["joint3SameAtLowerId", null],
      ["set_privacy", null],
      ["private2", "A"],
      ["set_privacy", "A"],
      ["private3", "A"],
      ["private4ScopedToB", "B"],
      ["set_privacy", "A"],
    ]);
    expect(out["switch.stampedNew"]).toEqual([
      ["created", "A"],
      ["private", "A"],
    ]);
    expect(out["switch.stampedOther"]).toEqual([["otherAccount", null]]);
    // findStored: the true row for any viewer who may see it; never a private or deleted one.
    const storedB = out["priv.storedHiddenAsB"] as unknown[];
    expect(storedB[0]).toBe("secret");
    expect(storedB[1]).not.toBeNull();
    expect(storedB.slice(3)).toEqual(["ext-hide", 0]);
    expect(out["priv.storedHiddenAsA"]).toEqual(storedB);
    expect(out["priv.storedPrivateAsB"]).toBeUndefined();
    expect(out["priv.storedDeleted"]).toBeUndefined();
    expect((out["priv.storedWithSplits"] as unknown[]).at(-1)).toBe(1);
    expect(out["priv.storedMissingViewer"]).toBe("TypeError");
    // The hidden projection nulls fingerprint and externalId for B only.
    const asB = (out["priv.asB"] as unknown[][]).filter((row) => row[5] === true);
    expect(asB).toHaveLength(1);
    expect(asB[0]?.slice(7)).toEqual([null, null]);
    const asA = (out["priv.asA"] as unknown[][]).find((row) => row[0] === asB[0]?.[0]);
    expect(asA?.[1]).toBe("secret");
    expect(asA?.[8]).toBe("ext-hide");
    expect(asA?.[7]).toEqual(expect.stringContaining("secret"));
    // The audit scrub: keys kept and nulled while hidden, none added; the hider sees the truth.
    const [full, transfer] = out["priv.auditAsB"] as [string | null, string | null, unknown][];
    expect(JSON.parse(full?.[0] ?? "")).toEqual({
      descriptionRaw: null,
      payeeId: null,
      fingerprint: null,
      externalId: null,
      notes: "n",
    });
    expect(JSON.parse(full?.[1] ?? "")).toMatchObject({ descriptionRaw: null, notes: "m" });
    expect(full?.[2]).toBe("2027-03-12");
    expect(JSON.parse(transfer?.[0] ?? "")).toEqual({ transferGroupId: "g", notes: null });
    expect(transfer?.[1]).toBeNull();
    const [fullA] = out["priv.auditAsA"] as [string | null, string | null, unknown][];
    expect(JSON.parse(fullA?.[0] ?? "")).toMatchObject({
      descriptionRaw: "secret",
      fingerprint: "fp",
    });
    expect(fullA?.[2]).toBeNull();
    const [scopedB] = out["priv.auditScopedAsB"] as [string, string, unknown][];
    expect(JSON.parse(scopedB?.[0] ?? "")).toEqual({
      descriptionRaw: "scoped-payee",
      payeeId: null,
    });
    expect(JSON.parse(scopedB?.[1] ?? "").payeeId).not.toBeNull();
    expect(scopedB?.[2]).toBeNull();
    const [scopedA] = out["priv.auditScopedAsA"] as [string, string, unknown][];
    expect(JSON.parse(scopedA?.[0] ?? "").payeeId).not.toBeNull();
  });

  it("keeps the scoped origin account in the database, never in a row", () => {
    scenario(createUnitOfWork(db), softDeleteInSqlite);
    expect(
      db.prepare("SELECT count(*) FROM payee WHERE origin_account_id IS NOT NULL").pluck().get(),
    ).toBe(7);
    const row = createUnitOfWork(db).read((r) => r.payees.list(systemViewer("cli:test"))[0]);
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {})).not.toContain("originAccountId");
  });
});

describe("memory and SQLite repositories agree", () => {
  it("gives the same answers to the same sequence", () => {
    const sqlite = scenario(createUnitOfWork(db), softDeleteInSqlite);
    const mirror = memoryUnitOfWork();
    const memory = scenario(mirror, (id) => mirror.state.deleted.add(id));
    expect(sqlite["tag.hiddenSurvives"]).toEqual([["holiday", true]]);
    expect(memory).toEqual(sqlite);
  });
});
