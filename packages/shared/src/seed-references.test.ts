import { describe, expect, it } from "vitest";
import { checkSeedReferences, emptySeedKnown, type SeedReferenceEvent } from "./seed-references.ts";

type Txn = Extract<SeedReferenceEvent, { type: "transaction.created" }>;

/** Checks `events` in order and returns the problems of the last one. */
const last = (...events: SeedReferenceEvent[]): string[] => {
  const known = emptySeedKnown();
  let problems: string[] = [];
  for (const event of events) problems = checkSeedReferences(event, known);
  return problems;
};

const person = (key: string): SeedReferenceEvent => ({ type: "person.created", key });
const account = (key: string, isPrivate: boolean, owner: string): SeedReferenceEvent => ({
  type: "account.created",
  key,
  institution: null,
  isPrivate,
  owners: [{ person: owner }],
});
const txn = (over: Partial<Txn> = {}): SeedReferenceEvent => ({
  type: "transaction.created",
  key: "x",
  account: "a",
  amountCents: 5,
  ...over,
});
/** A world with persons p and q, a private account `a` of p, a shared account `s`, tag, payee. */
const world: SeedReferenceEvent[] = [
  person("p"),
  person("q"),
  account("a", true, "p"),
  account("s", false, "p"),
  { type: "tag.created", key: "t", origin: null },
  { type: "payee.created", key: "y", origin: null },
];

describe("checkSeedReferences", () => {
  it("accepts events that name earlier keys", () => {
    expect(
      last(...world, { type: "tag.created", key: "own", origin: "a" }, txn({ tags: ["own"] })),
    ).toEqual([]);
  });

  it("names duplicate person, institution, account, tag, payee and transaction keys", () => {
    expect(last(person("p"), person("p"))).toEqual(['person key "p" is used twice']);
    const inst: SeedReferenceEvent = { type: "institution.created", key: "i" };
    expect(last(inst, inst)).toEqual(['institution key "i" is used twice']);
    expect(last(person("p"), account("a", false, "p"), account("a", false, "p"))).toEqual([
      'account key "a" is used twice',
    ]);
    const tag: SeedReferenceEvent = { type: "tag.created", key: "t", origin: null };
    expect(last(tag, tag)).toEqual(['tag key "t" is used twice']);
    const payee: SeedReferenceEvent = { type: "payee.created", key: "y", origin: null };
    expect(last(payee, payee)).toEqual(['payee key "y" is used twice']);
    expect(last(...world, txn(), txn())).toEqual(['transaction key "x" is used twice']);
  });

  it("names an unknown owner and institution on an account", () => {
    expect(
      last({
        type: "account.created",
        key: "a",
        institution: "bank",
        isPrivate: false,
        owners: [{ person: "q" }],
      }),
    ).toEqual(['unknown owner "q"', 'unknown institution "bank"']);
  });

  it("names an unknown or public origin account on a tag or payee", () => {
    expect(last(...world, { type: "tag.created", key: "u", origin: "nope" })).toEqual([
      'tag "u" has unknown origin account "nope"',
    ]);
    expect(last(...world, { type: "tag.created", key: "u", origin: "s" })).toEqual([
      'tag "u" has origin account "s", which is not private',
    ]);
    expect(last(...world, { type: "payee.created", key: "u", origin: "s" })).toEqual([
      'payee "u" has origin account "s", which is not private',
    ]);
  });

  it("names an unknown account, payee, tag and beneficiary on a transaction", () => {
    expect(last(...world, txn({ account: "zz" }))).toEqual(['unknown account "zz"']);
    expect(last(...world, txn({ payee: "zz" }))).toEqual(['unknown payee "zz"']);
    expect(last(...world, txn({ tags: ["zz"] }))).toEqual(['unknown tag "zz"']);
    expect(
      last(...world, txn({ splits: [{ amountCents: 5, tags: ["zz"], beneficiary: "zz" }] })),
    ).toEqual(['unknown tag "zz"', 'unknown beneficiary "zz"']);
    expect(last(...world, txn({ payee: "y", tags: ["t"], splits: undefined }))).toEqual([]);
  });

  it("names uneven splits and a private account's split for someone else", () => {
    expect(last(...world, txn({ splits: [{ amountCents: 4 }] }))).toEqual([
      "splits must add up to the transaction amount",
    ]);
    expect(last(...world, txn({ splits: [{ amountCents: 5, beneficiary: "q" }] }))).toEqual([
      `a private account's splits belong to its owner, not "q"`,
    ]);
    expect(last(...world, txn({ splits: [{ amountCents: 5, beneficiary: "p" }] }))).toEqual([]);
    expect(
      last(...world, txn({ account: "s", splits: [{ amountCents: 5, beneficiary: "q" }] })),
    ).toEqual([]);
  });

  it("checks balance.recorded, transaction.name-hidden and transfer.grouped references", () => {
    expect(last(...world, { type: "balance.recorded", account: "zz" })).toEqual([
      'unknown account "zz"',
    ]);
    expect(last(...world, { type: "balance.recorded", account: "a" })).toEqual([]);
    expect(
      last(...world, { type: "transaction.name-hidden", transaction: "nope", by: "zz" }),
    ).toEqual(['unknown transaction "nope"', 'unknown person "zz"']);
    expect(
      last(...world, txn(), { type: "transaction.name-hidden", transaction: "x", by: "p" }),
    ).toEqual([]);
    expect(
      last(...world, { type: "transfer.grouped", transactions: ["m", "n"], by: "zz" }),
    ).toEqual(['unknown transaction "m"', 'unknown transaction "n"', 'unknown person "zz"']);
    expect(
      last(...world, txn(), txn({ key: "y2", account: "s" }), {
        type: "transfer.grouped",
        transactions: ["x", "y2"],
        by: "p",
      }),
    ).toEqual([]);
  });
});
