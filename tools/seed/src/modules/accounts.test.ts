import { describe, expect, it } from "vitest";
import { runSeed } from "../run.ts";
import { ACCOUNT_KEYS, accounts } from "./accounts.ts";
import { peopleAndHousehold } from "./people-and-household.ts";

describe("accounts", () => {
  const out = runSeed({ modules: [peopleAndHousehold, accounts] });
  const events = out.events.filter((e) => e.module === "accounts");

  it("emits one shared account and one private account per person", () => {
    const created = events.filter((e) => e.type === "account.created");
    expect(created.map((e) => [e.key, e.isPrivate, e.owners.map((o) => o.person)])).toEqual([
      [ACCOUNT_KEYS.shared, false, ["person-a", "person-b"]],
      [ACCOUNT_KEYS.privateA, true, ["person-a"]],
      [ACCOUNT_KEYS.privateB, true, ["person-b"]],
    ]);
    for (const account of created) {
      expect(account.owners.reduce((sum, o) => sum + o.shareBp, 0)).toBe(10000);
    }
  });

  it("puts transactions in every account, as signed integer cents on real dates", () => {
    const txns = events.filter((e) => e.type === "transaction.created");
    expect(new Set(txns.map((t) => t.account))).toEqual(new Set(Object.values(ACCOUNT_KEYS)));
    for (const t of txns) {
      expect(Number.isSafeInteger(t.amountCents)).toBe(true);
      expect(t.postedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("states the descriptions it expects each partner to see", () => {
    expect(out.expectations["accounts.privateDescriptionsA"]).toHaveLength(2);
    expect(out.expectations["accounts.sharedDescriptions"]).toHaveLength(4);
  });
});
