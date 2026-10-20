import { describe, expect, it } from "vitest";
import {
  matchFuzzyPayee,
  matchPayeeAlias,
  type PayeeAliasCandidate,
  type PayeeCandidate,
} from "./payee-matching.ts";
import {
  evaluateRules,
  matchesRuleConditions,
  type RuleCandidate,
  type TransactionForRules,
} from "./rule-engine.ts";

describe("Payee alias matching", () => {
  const aliases: PayeeAliasCandidate[] = [
    {
      id: "a1",
      payeeId: "p-woolworths",
      pattern: "WOOLWORTHS 1234",
      matchKind: "exact",
    },
    {
      id: "a2",
      payeeId: "p-woolworths",
      pattern: "WW METRO",
      matchKind: "prefix",
    },
    {
      id: "a3",
      payeeId: "p-netflix",
      pattern: "NETFLIX",
      matchKind: "contains",
    },
    {
      id: "a4",
      payeeId: "p-uber",
      pattern: "^UBER\\s*\\*\\s*TRIP",
      matchKind: "regex",
    },
    {
      id: "a5",
      payeeId: "p-broken",
      pattern: "[invalid(regex",
      matchKind: "regex",
    },
  ];

  it("matches exact pattern ignoring case and whitespace", () => {
    expect(matchPayeeAlias("woolworths 1234", aliases)).toBe("p-woolworths");
    expect(matchPayeeAlias("WOOLWORTHS 1234", aliases)).toBe("p-woolworths");
    expect(matchPayeeAlias("WOOLWORTHS 12345", aliases)).toBeNull();
  });

  it("matches prefix pattern", () => {
    expect(matchPayeeAlias("WW METRO SUBIACO 4912", aliases)).toBe("p-woolworths");
    expect(matchPayeeAlias("WW METRO", aliases)).toBe("p-woolworths");
    expect(matchPayeeAlias("SUBIACO WW METRO", aliases)).toBeNull();
  });

  it("matches contains pattern", () => {
    expect(matchPayeeAlias("PAYMENT TO NETFLIX SYDNEY", aliases)).toBe("p-netflix");
    expect(matchPayeeAlias("netflix.com", aliases)).toBe("p-netflix");
    expect(matchPayeeAlias("STAN STREAMING", aliases)).toBeNull();
  });

  it("matches regex pattern", () => {
    expect(matchPayeeAlias("UBER * TRIP SYDNEY", aliases)).toBe("p-uber");
    expect(matchPayeeAlias("UBER*TRIP 9876", aliases)).toBe("p-uber");
    expect(matchPayeeAlias("UBER EATS", aliases)).toBeNull();
  });

  it("safely skips invalid regex without throwing", () => {
    expect(matchPayeeAlias("any description", aliases)).toBeNull();
  });
});

describe("Fuzzy payee matching", () => {
  const payees: PayeeCandidate[] = [
    { id: "p-coles", name: "Coles" },
    { id: "p-woolworths", name: "Woolworths" },
    { id: "p-bunnings", name: "Bunnings Warehouse" },
  ];

  it("matches payee name when token exists in description", () => {
    expect(matchFuzzyPayee("COLES SUPERMARKET EXPRESS", payees)).toBe("p-coles");
    expect(matchFuzzyPayee("WOOLWORTHS 1234 SUBIACO", payees)).toBe("p-woolworths");
  });

  it("matches multi-word payee names", () => {
    expect(matchFuzzyPayee("BUNNINGS WAREHOUSE ARTARMON", payees)).toBe("p-bunnings");
  });

  it("does not match when similarity is below threshold", () => {
    expect(matchFuzzyPayee("RANDOM STORE TRANSACTION", payees)).toBeNull();
    expect(
      matchFuzzyPayee("COLES SUPERMARKET EXPRESS", [{ id: "p-bunnings", name: "Bunnings" }]),
    ).toBeNull();
  });
});

describe("Rule condition matching", () => {
  const baseTxn: TransactionForRules = {
    accountId: "acc-1",
    rawDescription: "WOOLWORTHS METRO SURRY HILLS",
    amountCents: -5420,
    payeeId: "p-woolworths",
  };

  it("matches on description prefix with whitespace trimmed", () => {
    expect(
      matchesRuleConditions(
        { ...baseTxn, rawDescription: "  WOOLWORTHS METRO  " },
        {
          descriptionPattern: " woolworths ",
          descriptionMatchKind: "prefix",
        },
      ),
    ).toBe(true);
  });

  it("matches on description contains", () => {
    expect(
      matchesRuleConditions(baseTxn, {
        descriptionPattern: "METRO",
        descriptionMatchKind: "contains",
      }),
    ).toBe(true);

    expect(
      matchesRuleConditions(baseTxn, {
        descriptionPattern: "COLES",
        descriptionMatchKind: "contains",
      }),
    ).toBe(false);
  });

  it("matches on payeeId", () => {
    expect(matchesRuleConditions(baseTxn, { payeeId: "p-woolworths" })).toBe(true);
    expect(matchesRuleConditions(baseTxn, { payeeId: "p-coles" })).toBe(false);
  });

  it("matches on accountId", () => {
    expect(matchesRuleConditions(baseTxn, { accountId: "acc-1" })).toBe(true);
    expect(matchesRuleConditions(baseTxn, { accountId: "acc-2" })).toBe(false);
  });

  it("matches on direction and amounts", () => {
    expect(matchesRuleConditions(baseTxn, { direction: "outflow" })).toBe(true);
    expect(matchesRuleConditions(baseTxn, { direction: "inflow" })).toBe(false);

    expect(matchesRuleConditions(baseTxn, { minAmountCents: 5000, maxAmountCents: 6000 })).toBe(
      true,
    );
    expect(matchesRuleConditions(baseTxn, { minAmountCents: 6000 })).toBe(false);
    expect(matchesRuleConditions(baseTxn, { maxAmountCents: 5000 })).toBe(false);
  });

  it("requires all specified conditions to match (AND logic)", () => {
    expect(
      matchesRuleConditions(baseTxn, {
        payeeId: "p-woolworths",
        direction: "outflow",
        minAmountCents: 5000,
      }),
    ).toBe(true);

    expect(
      matchesRuleConditions(baseTxn, {
        payeeId: "p-woolworths",
        direction: "inflow",
      }),
    ).toBe(false);
  });
});

describe("Rule priority evaluation", () => {
  const txn: TransactionForRules = {
    accountId: "acc-1",
    rawDescription: "WOOLWORTHS SUBIACO",
    amountCents: -4500,
    payeeId: "p-woolworths",
  };

  const ruleA: RuleCandidate = {
    id: "r-1",
    name: "Rule A - Groceries",
    priority: 10,
    conditions: { payeeId: "p-woolworths" },
    actions: { categoryId: "cat-groceries" },
  };

  const ruleB: RuleCandidate = {
    id: "r-2",
    name: "Rule B - Snacks",
    priority: 20,
    conditions: { descriptionPattern: "WOOLWORTHS" },
    actions: { categoryId: "cat-snacks" },
  };

  it("selects lowest priority number first regardless of array order", () => {
    expect(evaluateRules(txn, [ruleB, ruleA])).toBe(ruleA);
    expect(evaluateRules(txn, [ruleA, ruleB])).toBe(ruleA);
  });

  it("falls back to lower priority if first does not match", () => {
    const strictRule: RuleCandidate = {
      id: "r-strict",
      name: "Strict Rule",
      priority: 5,
      conditions: { minAmountCents: 10000 },
      actions: { categoryId: "cat-big-spend" },
    };
    expect(evaluateRules(txn, [strictRule, ruleB])).toBe(ruleB);
  });

  it("deterministically breaks ties using rule id and respects reflexivity", () => {
    const tieRule1: RuleCandidate = {
      id: "r-alpha",
      name: "Tie Alpha",
      priority: 10,
      conditions: {},
      actions: { categoryId: "cat-1" },
    };
    const tieRule2: RuleCandidate = {
      id: "r-beta",
      name: "Tie Beta",
      priority: 10,
      conditions: {},
      actions: { categoryId: "cat-2" },
    };
    expect(evaluateRules(txn, [tieRule2, tieRule1])).toBe(tieRule1);
    expect(evaluateRules(txn, [tieRule1, tieRule1])).toBe(tieRule1);
  });

  it("returns null when no rule matches", () => {
    const nonMatchingRule: RuleCandidate = {
      id: "r-none",
      name: "Coles Rule",
      priority: 1,
      conditions: { payeeId: "p-coles" },
      actions: { categoryId: "cat-groceries" },
    };
    expect(evaluateRules(txn, [nonMatchingRule])).toBeNull();
  });
});
