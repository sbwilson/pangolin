import { describe, expect, it } from "vitest";
import { checkSeedReferences, emptySeedKnown, type SeedReferenceEvent } from "./seed-references.ts";

const run = (events: SeedReferenceEvent[]) => {
  const known = emptySeedKnown();
  return events.map((event) => checkSeedReferences(event, known));
};

describe("checkSeedReferences", () => {
  it("accepts events that name earlier keys and records what they create", () => {
    expect(
      run([
        { type: "person.created", key: "p" },
        {
          type: "account.created",
          key: "a",
          institution: null,
          isPrivate: true,
          owners: [{ person: "p" }],
        },
        { type: "tag.created", key: "t", origin: "a" },
        { type: "transaction.created", key: "x", account: "a", amountCents: 5, tags: ["t"] },
      ]),
    ).toEqual([[], [], [], []]);
  });

  it("names duplicate keys, unknown references, public origins and uneven splits", () => {
    const [, dup, publicOrigin, , uneven] = run([
      { type: "person.created", key: "p" },
      { type: "person.created", key: "p" },
      {
        type: "account.created",
        key: "a",
        institution: "bank",
        isPrivate: false,
        owners: [{ person: "q" }],
      },
      { type: "tag.created", key: "t", origin: "a" },
      {
        type: "transaction.created",
        key: "x",
        account: "a",
        amountCents: 5,
        splits: [{ amountCents: 4 }],
      },
    ]);
    expect(dup).toEqual(['person key "p" is used twice']);
    expect(publicOrigin).toEqual(['unknown owner "q"', 'unknown institution "bank"']);
    expect(uneven).toEqual(["splits must add up to the transaction amount"]);
  });
});
