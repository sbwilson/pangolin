import { describe, expect, it } from "vitest";
import { verifyStatementBalances } from "./pdf-verify.ts";

describe("verifyStatementBalances", () => {
  it("accepts statements whose printed running balances chain only in reverse of the listed order", () => {
    const result = verifyStatementBalances({
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      startDate: "2024-09-01",
      endDate: "2024-09-30",
      rows: [
        {
          rowNumber: 1,
          postedOn: "2024-09-10",
          amountCents: -2_000,
          runningBalanceCents: 103_000,
        },
        {
          rowNumber: 2,
          postedOn: "2024-09-10",
          amountCents: 5_000,
          runningBalanceCents: 105_000,
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("fails with the primary-order mismatch when neither chain order reconciles", () => {
    const result = verifyStatementBalances({
      openingBalanceCents: 100_000,
      closingBalanceCents: 103_000,
      startDate: "2024-09-01",
      endDate: "2024-09-30",
      rows: [
        {
          rowNumber: 1,
          postedOn: "2024-09-10",
          amountCents: -2_000,
          runningBalanceCents: 111_000,
        },
        {
          rowNumber: 2,
          postedOn: "2024-09-10",
          amountCents: 5_000,
          runningBalanceCents: 116_000,
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("running_balance_mismatch");
    }
  });
});
