import { describe, expect, it } from "vitest";
import { type FlowKindInput, flowKind } from "./flow-kind.ts";

const kind = (over: Partial<FlowKindInput>) =>
  flowKind({ amountCents: -100, counterpart: null, groupKind: null, ...over });

describe("flowKind (AD-23)", () => {
  it("treats a link to our cash, savings, offset or credit-card account as a transfer", () => {
    for (const counterpart of ["transaction", "savings", "offset", "credit_card"] as const) {
      expect(kind({ counterpart, amountCents: -50000 })).toBe("transfer");
      expect(kind({ counterpart, amountCents: 50000, groupKind: "income" })).toBe("transfer");
    }
  });

  it("counts a home-loan repayment as an expense", () => {
    expect(kind({ counterpart: "home_loan", amountCents: -200000 })).toBe("expense");
  });

  it("treats a loan redraw (money in from a home loan) as a transfer", () => {
    expect(kind({ counterpart: "home_loan", amountCents: 1500 })).toBe("transfer");
    expect(kind({ counterpart: "home_loan", amountCents: 1500, groupKind: "income" })).toBe(
      "transfer",
    );
  });

  it("counts money into brokerage or super as investing", () => {
    expect(kind({ counterpart: "brokerage", amountCents: -100000 })).toBe("investing");
    expect(kind({ counterpart: "super", amountCents: -100000 })).toBe("investing");
  });

  it("treats a counterpart the viewer cannot see as a transfer, whatever else", () => {
    expect(kind({ counterpart: "hidden", amountCents: 300 })).toBe("transfer");
    expect(kind({ counterpart: "hidden", amountCents: -300, groupKind: "expense" })).toBe(
      "transfer",
    );
  });

  it("falls through to category and sign for any other counterpart type", () => {
    for (const counterpart of ["property", "vehicle", "other"] as const) {
      expect(kind({ counterpart, amountCents: -10 })).toBe("expense");
      expect(kind({ counterpart, amountCents: 10 })).toBe("income");
      expect(kind({ counterpart, amountCents: 10, groupKind: "transfer" })).toBe("transfer");
    }
  });

  it("treats an unlinked split in a transfer-kind group as a transfer", () => {
    expect(kind({ amountCents: 30000, groupKind: "transfer" })).toBe("transfer");
  });

  it("goes by sign otherwise: a refund is income, uncategorised spend and zero are expense", () => {
    expect(kind({ amountCents: 4000, groupKind: "expense" })).toBe("income");
    expect(kind({ amountCents: -2500 })).toBe("expense");
    expect(kind({ amountCents: 0 })).toBe("expense");
    expect(kind({ amountCents: -1, groupKind: "income" })).toBe("expense");
  });
});
