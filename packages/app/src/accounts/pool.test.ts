import { describe, expect, it } from "vitest";
import { payerOf, poolOf } from "./pool.ts";

describe("poolOf", () => {
  it("is shared with two or more owners, else the sole owner", () => {
    expect(poolOf([{ personId: "A" }, { personId: "B" }])).toBe("shared");
    expect(poolOf([{ personId: "A" }])).toBe("A");
  });

  it("refuses an account with no owner", () => {
    expect(() => poolOf([])).toThrow(expect.objectContaining({ code: "Conflict" }));
  });
});

describe("payerOf", () => {
  it("is performedBy, else the sole owner, else shared", () => {
    const joint = [{ personId: "A" }, { personId: "B" }];
    expect(payerOf(joint, "B")).toBe("B");
    expect(payerOf(joint, null)).toBe("shared");
    expect(payerOf([{ personId: "A" }], null)).toBe("A");
    expect(payerOf([{ personId: "A" }], "B")).toBe("B");
  });
});
