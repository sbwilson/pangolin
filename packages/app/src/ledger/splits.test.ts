import type { Id } from "@pangolin/shared";
import { describe, expect, it } from "vitest";
import { createAccount } from "../accounts/create-account.ts";
import { createActivity } from "../classify/activities.ts";
import { createCategory, deleteCategory } from "../classify/categories.ts";
import { createCategoryGroup } from "../classify/category-groups.ts";
import { createTag, deleteTag } from "../classify/tags.ts";
import { createTaxCategory } from "../classify/tax-categories.ts";
import type { UseCaseContext } from "../context.ts";
import { createPerson } from "../identity/create-person.ts";
import { systemViewer } from "../system-viewer.ts";
import { manualClock, sequentialIds } from "../testing/fixtures.ts";
import { memoryUnitOfWork } from "../testing/memory-uow.ts";
import { personViewer, type Viewer } from "../viewer.ts";
import { createTransaction } from "./create-transaction.ts";
import { getTransaction } from "./get-transaction.ts";
import { listTransactions } from "./list-transactions.ts";
import { mayOverwrite } from "./provenance.ts";
import {
  registerSplitFieldListener,
  type SplitFieldWrite,
  setSplitField,
} from "./set-split-field.ts";
import { setSplits } from "./set-splits.ts";
import { setSplitTags } from "./split-tags.ts";
import { updateTransaction } from "./update-transaction.ts";

const clock = manualClock("2026-09-27T00:00:00Z");

function setup() {
  const uow = memoryUnitOfWork();
  const newId = sequentialIds();
  const as = (viewer: Viewer): UseCaseContext => ({ viewer, clock, newId, uow });
  const sys = as(systemViewer("cli:test"));
  const a = createPerson(sys, { displayName: "A", colour: "#000000" });
  const b = createPerson(sys, { displayName: "B", colour: "#ffffff" });
  const of = (id: Id<"Person">) => as(personViewer(id, clock.now()));
  const owners = (ids: Id<"Person">[]) =>
    ids.map((personId) => ({ personId, shareBp: 10000 / ids.length }));
  const shared = createAccount(sys, {
    name: "Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: owners([a, b]),
  });
  const privateA = createAccount(sys, {
    name: "A private",
    type: "savings",
    currency: "AUD",
    isPrivate: true,
    owners: owners([a]),
  });
  const group = createCategoryGroup(of(a), { name: "Living", kind: "expense" });
  const cat = createCategory(of(a), { groupId: group.id, name: "Food" }).id;
  const cat2 = createCategory(of(a), { groupId: group.id, name: "Fuel" }).id;
  const activity = createActivity(of(a), { name: "Trip" }).id;
  const tax = createTaxCategory(of(a), { code: "WFH", label: "Work from home" }).id;
  const create = (accountId: string, amountCents = -1000) =>
    createTransaction(of(a), {
      accountId,
      postedOn: "2026-09-01",
      amountCents,
      description: "Shop",
    });
  return { uow, sys, a, b, of, shared, privateA, cat, cat2, activity, tax, create };
}

const codeOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? error;
  }
  return "no throw";
};

const detailsOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return (error as { details?: unknown }).details;
  }
  return "no throw";
};

describe("provenance.mayOverwrite", () => {
  it("follows user > rule > payee > activity > llm, and lets any source write an unset field", () => {
    const order = ["llm", "activity", "payee", "rule", "user"] as const;
    for (const next of order) expect(mayOverwrite(null, next)).toBe(true);
    for (const [i, current] of order.entries()) {
      for (const [j, next] of order.entries()) expect(mayOverwrite(current, next)).toBe(j >= i);
    }
  });
});

const firstSplit = (ctx: UseCaseContext, id: string) =>
  getTransaction(ctx, { id }).splits[0]?.id as string;

describe("ledger.setSplits", () => {
  it("replaces splits that sum to the amount, keeping ids, provenance and tags", () => {
    const { uow, a, of, shared, cat, create } = setup();
    const id = create(shared);
    const [first] = getTransaction(of(a), { id }).splits;
    if (first === undefined) throw new Error("missing");
    const tag = createTag(of(a), { name: "tag" });
    setSplitField(of(a), { transactionId: id, splitId: first.id, field: "category", value: cat });
    setSplitTags(of(a), { transactionId: id, splitId: first.id, tagIds: [tag.id] });
    const out = setSplits(of(a), {
      transactionId: id,
      splits: [
        { id: first.id, amountCents: -600 },
        { amountCents: -400, memo: "rest" },
      ],
    });
    expect(out.remainingCents).toBe(0);
    expect(out.splits).toHaveLength(2);
    const kept = out.splits.find((s) => s.id === first.id);
    expect(kept).toMatchObject({ amountCents: -600, categoryId: cat, categorySource: "user" });
    expect(kept?.tags.map((t) => t.id)).toEqual([tag.id]);
    const minted = out.splits.find((s) => s.id !== first.id);
    expect(minted).toMatchObject({
      amountCents: -400,
      memo: "rest",
      beneficiary: "shared",
      categorySource: null,
    });
    expect(uow.state.splits).toHaveLength(2);
  });

  it("writes nothing and reports remainingCents when the sum is off", () => {
    const { uow, a, of, shared, create } = setup();
    const id = create(shared);
    const audits = uow.state.audit.length;
    const before = [...uow.state.splits];
    for (const [amounts, remaining] of [
      [[-300, -300], -400],
      [[-1500], 500],
    ] as const) {
      const run = () =>
        setSplits(of(a), {
          transactionId: id,
          splits: amounts.map((amountCents) => ({ amountCents })),
        });
      expect(codeOf(run)).toBe("Validation");
      expect(detailsOf(run)).toEqual({ remainingCents: remaining });
    }
    expect(uow.state.audit).toHaveLength(audits);
    expect(uow.state.splits).toEqual(before);
    expect(getTransaction(of(a), { id }).remainingCents).toBe(0);
  });

  it("drops an omitted split together with its tags", () => {
    const { uow, a, of, shared, create } = setup();
    const id = create(shared);
    const two = setSplits(of(a), {
      transactionId: id,
      splits: [{ amountCents: -500 }, { amountCents: -500 }],
    });
    const [keep, drop] = two.splits;
    if (keep === undefined || drop === undefined) throw new Error("missing");
    const tag = createTag(of(a), { name: "t" });
    setSplitTags(of(a), { transactionId: id, splitId: drop.id, tagIds: [tag.id] });
    expect(uow.state.splitTags).toHaveLength(1);
    setSplits(of(a), { transactionId: id, splits: [{ id: keep.id, amountCents: -1000 }] });
    expect(uow.state.splits.map((s) => s.id)).toEqual([keep.id]);
    expect(uow.state.splitTags).toEqual([]);
  });

  it("rejects 0 and 51 splits, unknown or repeated ids, and zero amounts in a non-zero transaction", () => {
    const { a, of, shared, create } = setup();
    const id = create(shared);
    const run = (splits: { id?: string; amountCents: number }[]) => () =>
      setSplits(of(a), { transactionId: id, splits });
    expect(codeOf(run([]))).toBe("Validation");
    expect(codeOf(run(Array.from({ length: 51 }, () => ({ amountCents: 0 }))))).toBe("Validation");
    expect(codeOf(run([{ id: "nope", amountCents: -1000 }]))).toBe("NotFound");
    const [only] = getTransaction(of(a), { id }).splits;
    const sid = only?.id as string;
    expect(
      codeOf(
        run([
          { id: sid, amountCents: -500 },
          { id: sid, amountCents: -500 },
        ]),
      ),
    ).toBe("Validation");
    expect(codeOf(run([{ amountCents: -1000 }, { amountCents: 0 }]))).toBe("Validation");
    expect(getTransaction(of(a), { id }).splits.map((s) => s.amountCents)).toEqual([-1000]);
  });

  it("allows up to 50 splits, and zero splits only in a zero transaction", () => {
    const { a, of, shared, create } = setup();
    const id = create(shared, -50);
    const fifty = setSplits(of(a), {
      transactionId: id,
      splits: Array.from({ length: 50 }, () => ({ amountCents: -1 })),
    });
    expect(fifty.splits).toHaveLength(50);
    const zero = create(shared, 0);
    const out = setSplits(of(a), {
      transactionId: zero,
      splits: [{ amountCents: 0 }, { amountCents: 0 }],
    });
    expect(out.splits).toHaveLength(2);
  });

  it("fills the owner in a private account and refuses another beneficiary", () => {
    const { uow, a, b, of, privateA, shared, create } = setup();
    const id = create(privateA);
    const out = setSplits(of(a), {
      transactionId: id,
      splits: [{ amountCents: -400 }, { amountCents: -600 }],
    });
    expect(out.splits.every((s) => s.beneficiary === a)).toBe(true);
    const audits = uow.state.audit.length;
    for (const beneficiary of [b, "shared"]) {
      const run = () =>
        setSplits(of(a), { transactionId: id, splits: [{ amountCents: -1000, beneficiary }] });
      expect(codeOf(run)).toBe("Validation");
      expect(detailsOf(run)).toEqual({ remainingCents: 0 });
    }
    expect(uow.state.audit).toHaveLength(audits);
    // A public account takes a person or shared, and rejects an unknown one.
    const pub = create(shared);
    const ok = setSplits(of(a), {
      transactionId: pub,
      splits: [{ amountCents: -1000, beneficiary: b }],
    });
    expect(ok.splits[0]).toMatchObject({ beneficiary: b, beneficiarySource: "user" });
    expect(
      codeOf(() =>
        setSplits(of(a), {
          transactionId: pub,
          splits: [{ amountCents: -1000, beneficiary: "ghost" }],
        }),
      ),
    ).toBe("Validation");
  });

  it("checks targets by viewer: missing and partner-scoped ones are NotFound", () => {
    const { a, b, of, privateA, shared, cat, create } = setup();
    const id = create(shared);
    const mine = createActivity(of(a), { name: "Mine", originAccountId: privateA }).id;
    const run = (extra: Record<string, string>) => () =>
      setSplits(of(b), { transactionId: id, splits: [{ amountCents: -1000, ...extra }] });
    expect(codeOf(run({ categoryId: "nope" }))).toBe("NotFound");
    expect(codeOf(run({ activityId: mine }))).toBe("NotFound");
    expect(codeOf(run({ taxCategoryId: "nope" }))).toBe("NotFound");
    expect(codeOf(run({ categoryId: cat }))).toBe("no throw");
  });

  it("refuses an owner-scoped activity on a shared split (Conflict), for either partner", () => {
    const { uow, a, of, privateA, shared, create } = setup();
    const id = create(shared);
    const sid = firstSplit(of(a), id);
    const mine = createActivity(of(a), { name: "Mine", originAccountId: privateA }).id;
    const audits = uow.state.audit.length;
    const before = JSON.stringify(uow.state.splits);
    expect(
      codeOf(() =>
        setSplitField(of(a), { transactionId: id, splitId: sid, field: "activity", value: mine }),
      ),
    ).toBe("Conflict");
    expect(
      codeOf(() =>
        setSplits(of(a), { transactionId: id, splits: [{ amountCents: -1000, activityId: mine }] }),
      ),
    ).toBe("Conflict");
    expect(
      codeOf(() =>
        setSplits(of(a), {
          transactionId: id,
          splits: [
            { id: sid, amountCents: -400 },
            { amountCents: -600, activityId: mine },
          ],
        }),
      ),
    ).toBe("Conflict");
    expect(uow.state.audit).toHaveLength(audits);
    expect(JSON.stringify(uow.state.splits)).toBe(before);
  });

  it("answers NotFound, not Conflict, to the partner who cannot see the scoped activity", () => {
    const { a, b, of, privateA, shared, create } = setup();
    const id = create(shared);
    const sid = firstSplit(of(a), id);
    const mine = createActivity(of(a), { name: "Mine", originAccountId: privateA }).id;
    expect(
      codeOf(() =>
        setSplitField(of(b), { transactionId: id, splitId: sid, field: "activity", value: mine }),
      ),
    ).toBe("NotFound");
  });

  it("accepts the owner's scoped activity in their private account, and shared ones anywhere", () => {
    const { uow, a, of, privateA, shared, activity, create } = setup();
    const mine = createActivity(of(a), { name: "Mine", originAccountId: privateA }).id;
    const priv = create(privateA);
    const psid = firstSplit(of(a), priv);
    expect(
      setSplitField(of(a), {
        transactionId: priv,
        splitId: psid,
        field: "activity",
        value: mine,
      }).applied,
    ).toBe(true);
    const priv2 = create(privateA);
    setSplits(of(a), {
      transactionId: priv2,
      splits: [{ amountCents: -1000, activityId: mine }],
    });
    const pub = create(shared);
    setSplitField(of(a), {
      transactionId: pub,
      splitId: firstSplit(of(a), pub),
      field: "activity",
      value: activity,
    });
    expect(uow.state.splits.filter((s) => s.activityId === mine)).toHaveLength(2);
    expect(uow.state.splits.filter((s) => s.activityId === activity)).toHaveLength(1);
  });

  it("refuses a property on any split, writing nothing", () => {
    const { uow, a, of, privateA, shared, create } = setup();
    const audits = uow.state.audit.length;
    for (const account of [shared, privateA]) {
      const id = create(account);
      const before = JSON.stringify(uow.state.splits);
      const audited = uow.state.audit.length;
      expect(
        codeOf(() =>
          setSplits(of(a), {
            transactionId: id,
            splits: [{ amountCents: -1000, propertyId: "01J0000000000000000000PROP" }],
          }),
        ),
      ).toBe("Validation");
      expect(JSON.stringify(uow.state.splits)).toBe(before);
      expect(uow.state.audit).toHaveLength(audited);
      // A null property is still fine.
      expect(
        setSplits(of(a), { transactionId: id, splits: [{ amountCents: -1000, propertyId: null }] })
          .remainingCents,
      ).toBe(0);
    }
    expect(uow.state.audit.length).toBeGreaterThan(audits);
  });

  it("keeps an omitted field, clears on null, and records the user source on change only", () => {
    const { uow, a, of, shared, cat, cat2, create } = setup();
    const id = create(shared);
    const [only] = getTransaction(of(a), { id }).splits;
    const sid = only?.id as string;
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -1000, categoryId: cat }],
    });
    const audits = uow.state.audit.length;
    // Same value again: nothing changes, nothing is audited.
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -1000, categoryId: cat }],
    });
    setSplits(of(a), { transactionId: id, splits: [{ id: sid, amountCents: -1000 }] });
    expect(uow.state.audit).toHaveLength(audits);
    expect(uow.state.splits[0]).toMatchObject({ categoryId: cat, categorySource: "user" });
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -1000, categoryId: cat2 }],
    });
    expect(uow.state.splits[0]?.categoryId).toBe(cat2);
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -1000, categoryId: null }],
    });
    expect(uow.state.splits[0]).toMatchObject({ categoryId: null, categorySource: "user" });
  });

  it("records an explicit null as a user clear even on an unset field, and omitted fields change nothing", () => {
    const { uow, a, of, shared, cat, create } = setup();
    const id = create(shared);
    const sid = getTransaction(of(a), { id }).splits[0]?.id as string;
    const audits = uow.state.audit.length;
    setSplits(of(a), { transactionId: id, splits: [{ id: sid, amountCents: -1000 }] });
    expect(uow.state.audit).toHaveLength(audits);
    expect(uow.state.splits[0]).toMatchObject({ activitySource: null, categorySource: null });
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -1000, categoryId: null }],
    });
    expect(uow.state.splits[0]).toMatchObject({
      categoryId: null,
      categorySource: "user",
      activitySource: null,
    });
    expect(uow.state.audit).toHaveLength(audits + 1);
    // A new split with an explicit null records the clear too.
    const out = setSplits(of(a), {
      transactionId: id,
      splits: [
        { id: sid, amountCents: -500 },
        { amountCents: -500, activityId: null },
      ],
    });
    const fresh = out.splits.find((x) => x.id !== sid);
    expect(fresh).toMatchObject({ activitySource: "user", categorySource: null });
    // The user clear holds against a rule.
    expect(
      setSplitField(of(a), {
        transactionId: id,
        splitId: sid,
        field: "category",
        value: cat,
        source: "rule",
      }).applied,
    ).toBe(false);
  });

  it("validates a target only when its value changes", () => {
    const { a, of, shared, cat, cat2, create } = setup();
    const id = create(shared);
    const sid = getTransaction(of(a), { id }).splits[0]?.id as string;
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -1000, categoryId: cat }],
    });
    deleteCategory(of(a), { id: cat });
    // The same deleted category, round-tripped, does not block an amount edit.
    const out = setSplits(of(a), {
      transactionId: id,
      splits: [{ id: sid, amountCents: -400, categoryId: cat }, { amountCents: -600 }],
    });
    expect(out.splits.find((x) => x.id === sid)).toMatchObject({
      amountCents: -400,
      categoryId: cat,
    });
    // Changing to a deleted category, or adding it to a new split, is NotFound.
    deleteCategory(of(a), { id: cat2 });
    for (const splits of [
      [{ id: sid, amountCents: -400, categoryId: cat2 }, { amountCents: -600 }],
      [
        { id: sid, amountCents: -400 },
        { amountCents: -600, categoryId: cat },
      ],
    ]) {
      expect(codeOf(() => setSplits(of(a), { transactionId: id, splits }))).toBe("NotFound");
    }
  });

  it("audits one update with the account and splits, sources and tag ids before and after", () => {
    const { uow, a, of, shared, create } = setup();
    const id = create(shared);
    const [only] = getTransaction(of(a), { id }).splits;
    const tag = createTag(of(a), { name: "t" });
    setSplitTags(of(a), { transactionId: id, splitId: only?.id as string, tagIds: [tag.id] });
    const audits = uow.state.audit.length;
    setSplits(of(a), {
      transactionId: id,
      splits: [{ id: only?.id, amountCents: -700 }, { amountCents: -300 }],
    });
    const rows = uow.state.audit.slice(audits);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      entity: "transaction",
      entityId: id,
      accountId: shared,
      action: "update",
    });
    const before = JSON.parse(row?.before ?? "{}");
    const after = JSON.parse(row?.after ?? "{}");
    expect(before.splits).toHaveLength(1);
    expect(before.splits[0]).toMatchObject({ categorySource: null, tagIds: [tag.id] });
    expect(after.splits).toHaveLength(2);
    expect(
      after.splits
        .map((s: { amountCents: number }) => s.amountCents)
        .sort((x: number, y: number) => x - y),
    ).toEqual([-700, -300]);
  });

  it("is NotFound for the partner's private row", () => {
    const { a, b, of, privateA, create } = setup();
    const id = create(privateA);
    expect(
      codeOf(() => setSplits(of(b), { transactionId: id, splits: [{ amountCents: -1000 }] })),
    ).toBe("NotFound");
    expect(
      codeOf(() => setSplits(of(a), { transactionId: id, splits: [{ amountCents: -1000 }] })),
    ).toBe("no throw");
  });

  it("leaves updateTransaction refusing a multi-split amount change, pointing at the replace route", () => {
    const { a, of, shared, create } = setup();
    const id = create(shared);
    setSplits(of(a), { transactionId: id, splits: [{ amountCents: -500 }, { amountCents: -500 }] });
    expect(codeOf(() => updateTransaction(of(a), { id, amountCents: -1 }))).toBe("Conflict");
    expect(() => updateTransaction(of(a), { id, amountCents: -1 })).toThrow(/splits/);
  });
});

describe("ledger.setSplitField", () => {
  const first = (ctx: UseCaseContext, id: string) =>
    getTransaction(ctx, { id }).splits[0]?.id as string;

  it("lets a user over a rule value, and refuses a rule over a user value", () => {
    const { uow, a, of, shared, cat, cat2, create } = setup();
    const id = create(shared);
    const sid = first(of(a), id);
    const set = (field: "category", value: string | null, source: "user" | "rule" | "llm") =>
      setSplitField(of(a), { transactionId: id, splitId: sid, field, value, source });
    expect(set("category", cat, "rule")).toMatchObject({ applied: true, changed: true });
    expect(uow.state.splits[0]).toMatchObject({ categoryId: cat, categorySource: "rule" });
    expect(set("category", cat2, "llm")).toMatchObject({ applied: false, changed: false });
    expect(set("category", cat2, "user")).toMatchObject({ applied: true, changed: true });
    expect(uow.state.splits[0]).toMatchObject({ categoryId: cat2, categorySource: "user" });
    const audits = uow.state.audit.length;
    const down = set("category", cat, "rule");
    expect(down.applied).toBe(false);
    expect(down.reason).toMatch(/higher-ranked/);
    expect(uow.state.splits[0]).toMatchObject({ categoryId: cat2, categorySource: "user" });
    expect(uow.state.audit).toHaveLength(audits);
  });

  it("counts a rank upgrade with the same value as a change and audits it", () => {
    const { uow, a, of, shared, cat, create } = setup();
    const id = create(shared);
    const sid = first(of(a), id);
    const set = (source: "user" | "rule") =>
      setSplitField(of(a), {
        transactionId: id,
        splitId: sid,
        field: "category",
        value: cat,
        source,
      });
    set("rule");
    const audits = uow.state.audit.length;
    expect(set("user")).toMatchObject({ applied: true, changed: true });
    expect(uow.state.audit).toHaveLength(audits + 1);
    expect(set("user")).toMatchObject({ applied: true, changed: false });
    expect(uow.state.audit).toHaveLength(audits + 1);
    const row = uow.state.audit[uow.state.audit.length - 1];
    expect(row).toMatchObject({ accountId: shared, action: "update" });
    expect(JSON.parse(row?.before ?? "{}").splits[0].categorySource).toBe("rule");
    expect(JSON.parse(row?.after ?? "{}").splits[0].categorySource).toBe("user");
  });

  it("records a user clear so a rule cannot refill it", () => {
    const { uow, a, of, shared, cat, create } = setup();
    const id = create(shared);
    const sid = first(of(a), id);
    const base = { transactionId: id, splitId: sid, field: "category" } as const;
    setSplitField(of(a), { ...base, value: cat, source: "rule" });
    setSplitField(of(a), { ...base, value: null });
    expect(uow.state.splits[0]).toMatchObject({ categoryId: null, categorySource: "user" });
    expect(setSplitField(of(a), { ...base, value: cat, source: "rule" }).applied).toBe(false);
    expect(uow.state.splits[0]?.categoryId).toBeNull();
    expect(codeOf(() => setSplitField(of(a), { ...base, value: null, source: "rule" }))).toBe(
      "Validation",
    );
  });

  it("sets activity, tax category and deductible share, validating each", () => {
    const { uow, a, of, shared, activity, tax, create } = setup();
    const id = create(shared);
    const sid = first(of(a), id);
    const base = { transactionId: id, splitId: sid } as const;
    setSplitField(of(a), { ...base, field: "activity", value: activity });
    setSplitField(of(a), { ...base, field: "tax_category", value: tax });
    setSplitField(of(a), { ...base, field: "deductible_bp", value: 5000 });
    expect(uow.state.splits[0]).toMatchObject({
      activityId: activity,
      activitySource: "user",
      taxCategoryId: tax,
      taxCategorySource: "user",
      deductibleBp: 5000,
      deductibleBpSource: "user",
    });
    expect(
      codeOf(() => setSplitField(of(a), { ...base, field: "deductible_bp", value: 10001 })),
    ).toBe("Validation");
    expect(codeOf(() => setSplitField(of(a), { ...base, field: "category", value: 5 }))).toBe(
      "Validation",
    );
    expect(codeOf(() => setSplitField(of(a), { ...base, field: "category", value: "nope" }))).toBe(
      "NotFound",
    );
    expect(
      codeOf(() =>
        setSplitField(of(a), { ...base, splitId: "nope", field: "category", value: null }),
      ),
    ).toBe("NotFound");
  });

  it("sets a beneficiary for any viewer who sees the transaction, but never clears it", () => {
    const { uow, a, b, of, privateA, shared, create } = setup();
    const id = create(shared);
    const sid = first(of(a), id);
    const base = { transactionId: id, splitId: sid, field: "beneficiary" } as const;
    setSplitField(of(b), { ...base, value: a });
    expect(uow.state.splits[0]).toMatchObject({ beneficiary: a, beneficiarySource: "user" });
    expect(codeOf(() => setSplitField(of(a), { ...base, value: null }))).toBe("Validation");
    expect(codeOf(() => setSplitField(of(a), { ...base, value: "ghost" }))).toBe("Validation");
    const priv = create(privateA);
    const psid = first(of(a), priv);
    const pbase = { transactionId: priv, splitId: psid, field: "beneficiary" } as const;
    expect(codeOf(() => setSplitField(of(a), { ...pbase, value: b }))).toBe("Validation");
    expect(codeOf(() => setSplitField(of(a), { ...pbase, value: "shared" }))).toBe("Validation");
    expect(codeOf(() => setSplitField(of(b), { ...pbase, value: b }))).toBe("NotFound");
    expect(setSplitField(of(a), { ...pbase, value: a }).applied).toBe(true);
  });
});

describe("ledger.setSplitTags", () => {
  it("replaces the whole set, audits it, and treats a repeat as a no-op", () => {
    const { uow, a, of, shared, create } = setup();
    const id = create(shared);
    const sid = getTransaction(of(a), { id }).splits[0]?.id as string;
    const t1 = createTag(of(a), { name: "one" });
    const t2 = createTag(of(a), { name: "two" });
    const audits = uow.state.audit.length;
    const out = setSplitTags(of(a), {
      transactionId: id,
      splitId: sid,
      tagIds: [t1.id, t2.id, t1.id],
    });
    expect(out.splits[0]?.tags.map((t) => t.name)).toEqual(["one", "two"]);
    expect(uow.state.audit).toHaveLength(audits + 1);
    setSplitTags(of(a), { transactionId: id, splitId: sid, tagIds: [t2.id, t1.id] });
    expect(uow.state.audit).toHaveLength(audits + 1);
    const row = uow.state.audit[uow.state.audit.length - 1];
    expect(row).toMatchObject({ accountId: shared, action: "update", entityId: id });
    expect(JSON.parse(row?.before ?? "{}").splits[0].tagIds).toEqual([]);
    expect(JSON.parse(row?.after ?? "{}").splits[0].tagIds).toEqual([t1.id, t2.id].sort());
    setSplitTags(of(a), { transactionId: id, splitId: sid, tagIds: [t2.id] });
    expect(uow.state.splitTags).toHaveLength(1);
    expect(listTransactions(of(a))[0]?.splits[0]?.tags.map((t) => t.id)).toEqual([t2.id]);
    setSplitTags(of(a), { transactionId: id, splitId: sid, tagIds: [] });
    expect(uow.state.splitTags).toEqual([]);
  });

  it("answers NotFound for a partner's scoped tag, a deleted tag and an unknown tag", () => {
    const { uow, a, b, of, privateA, shared, create } = setup();
    const id = create(shared);
    const sid = getTransaction(of(a), { id }).splits[0]?.id as string;
    const scoped = createTag(of(a), { name: "mine", originAccountId: privateA });
    const gone = createTag(of(a), { name: "gone" });
    deleteTag(of(a), { id: gone.id });
    const audits = uow.state.audit.length;
    for (const tagId of [scoped.id, gone.id, "nope"]) {
      expect(
        codeOf(() => setSplitTags(of(b), { transactionId: id, splitId: sid, tagIds: [tagId] })),
      ).toBe("NotFound");
    }
    expect(
      codeOf(() => setSplitTags(of(a), { transactionId: id, splitId: sid, tagIds: [gone.id] })),
    ).toBe("NotFound");
    expect(uow.state.audit).toHaveLength(audits);
  });

  it("refuses an owner-scoped tag on a public account, and allows a shared tag on a private split", () => {
    const { uow, a, of, privateA, shared, create } = setup();
    const pub = create(shared);
    const priv = create(privateA);
    const pubSplit = getTransaction(of(a), { id: pub }).splits[0]?.id as string;
    const privSplit = getTransaction(of(a), { id: priv }).splits[0]?.id as string;
    const scoped = createTag(of(a), { name: "mine", originAccountId: privateA });
    const open = createTag(of(a), { name: "open" });
    const audits = uow.state.audit.length;
    expect(
      codeOf(() =>
        setSplitTags(of(a), { transactionId: pub, splitId: pubSplit, tagIds: [scoped.id] }),
      ),
    ).toBe("Conflict");
    expect(uow.state.audit).toHaveLength(audits);
    expect(uow.state.splitTags).toEqual([]);
    setSplitTags(of(a), { transactionId: priv, splitId: privSplit, tagIds: [scoped.id, open.id] });
    expect(uow.state.splitTags).toHaveLength(2);
  });

  it("is NotFound for the partner's private row and for a split of another transaction", () => {
    const { a, b, of, privateA, shared, create } = setup();
    const priv = create(privateA);
    const other = create(shared);
    const tag = createTag(of(a), { name: "t" });
    const privSplit = getTransaction(of(a), { id: priv }).splits[0]?.id as string;
    expect(
      codeOf(() =>
        setSplitTags(of(b), { transactionId: priv, splitId: privSplit, tagIds: [tag.id] }),
      ),
    ).toBe("NotFound");
    expect(
      codeOf(() =>
        setSplitTags(of(a), { transactionId: other, splitId: privSplit, tagIds: [tag.id] }),
      ),
    ).toBe("NotFound");
  });
});

describe("registerSplitFieldListener", () => {
  const prime = () => {
    const env = setup();
    const id = env.create(env.shared);
    const splitId = getTransaction(env.of(env.a), { id }).splits[0]?.id as string;
    return { ...env, id, splitId };
  };

  it("is called once per changed write with the event, and not for refused or no-change writes", () => {
    const { a, of, cat, cat2, id, splitId } = prime();
    const events: SplitFieldWrite[] = [];
    const unregister = registerSplitFieldListener((_tx, _audit, event) => events.push(event));
    try {
      const base = { transactionId: id, splitId, field: "category" } as const;
      setSplitField(of(a), { ...base, value: cat, source: "rule" });
      expect(events).toEqual([
        { transactionId: id, splitId, field: "category", value: cat, source: "rule" },
      ]);
      setSplitField(of(a), { ...base, value: cat2, source: "llm" }); // refused
      setSplitField(of(a), { ...base, value: cat, source: "rule" }); // no change
      expect(events).toHaveLength(1);
      setSplitField(of(a), { ...base, value: cat2 });
      expect(events).toHaveLength(2);
    } finally {
      unregister();
    }
    setSplitField(of(a), { transactionId: id, splitId, field: "category", value: null });
    expect(events).toHaveLength(2);
  });

  it("rolls the field write back when a listener throws", () => {
    const { uow, a, of, cat, id, splitId } = prime();
    const audits = uow.state.audit.length;
    const unregister = registerSplitFieldListener(() => {
      throw new Error("boom");
    });
    try {
      expect(() =>
        setSplitField(of(a), { transactionId: id, splitId, field: "category", value: cat }),
      ).toThrow("boom");
    } finally {
      unregister();
    }
    expect(uow.state.splits[0]).toMatchObject({ categoryId: null, categorySource: null });
    expect(uow.state.audit).toHaveLength(audits);
  });
});

describe("ledger.setSplitTags with a tag the viewer cannot see", () => {
  it("leaves it on the split when a partner replaces the set", () => {
    const { uow, a, b, of, shared, create } = setup();
    const id = create(shared);
    const sid = getTransaction(of(a), { id }).splits[0]?.id as string;
    const hidden = createTag(of(a), { name: "mine" });
    const open = createTag(of(a), { name: "open" });
    // As if the account had been private when it was tagged.
    uow.state.tags = uow.state.tags.map((t) =>
      t.id === hidden.id ? { ...t, scopePersonId: a } : t,
    );
    uow.state.splitTags.push({
      splitId: sid as never,
      tagId: hidden.id,
      createdAt: "t",
      updatedAt: "t",
    });
    setSplitTags(of(b), { transactionId: id, splitId: sid, tagIds: [open.id] });
    expect(uow.state.splitTags.map((t) => t.tagId).sort()).toEqual([hidden.id, open.id].sort());
    setSplitTags(of(b), { transactionId: id, splitId: sid, tagIds: [] });
    expect(uow.state.splitTags.map((t) => t.tagId)).toEqual([hidden.id]);
  });
});

describe("transaction reads", () => {
  it("return remainingCents and tags per split on get and list", () => {
    const { uow, a, b, of, shared, create } = setup();
    const id = create(shared);
    const sid = getTransaction(of(a), { id }).splits[0]?.id as string;
    const tag = createTag(of(a), { name: "t" });
    setSplitTags(of(a), { transactionId: id, splitId: sid, tagIds: [tag.id] });
    expect(getTransaction(of(b), { id })).toMatchObject({ remainingCents: 0 });
    expect(listTransactions(of(b))[0]?.splits[0]?.tags).toHaveLength(1);
    // A transaction whose splits do not add up (a seeded or imported state) reports the gap.
    const row = uow.state.splits[0];
    if (row === undefined) throw new Error("missing");
    uow.state.splits[0] = { ...row, amountCents: -400 };
    expect(getTransaction(of(a), { id }).remainingCents).toBe(-600);
    expect(listTransactions(of(a))[0]?.remainingCents).toBe(-600);
  });
});
