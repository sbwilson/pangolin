import { describe, expect, it } from "vitest";
import { createTransactionInput } from "./create-transaction.ts";
import { updateTransactionInput } from "./update-transaction.ts";

const messages = (
  schema: { safeParse(v: unknown): { error?: { issues: { message: string }[] } } },
  input: unknown,
) => schema.safeParse(input).error?.issues.map((i) => i.message);

describe("shared transaction field schemas", () => {
  it("give create and update the same message for the same bad field", () => {
    const bad = { postedOn: "2025-02-30", description: "   " };
    const created = messages(createTransactionInput, { accountId: "a", amountCents: 1, ...bad });
    const updated = messages(updateTransactionInput, { id: "t", ...bad });
    expect(created).toEqual(["Expected a real YYYY-MM-DD date", "Enter a description"]);
    expect(updated).toEqual(created);
  });
});
