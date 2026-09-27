import { describe, expect, it } from "vitest";
import { serialize } from "./serialize.ts";

describe("serialize", () => {
  it("sorts keys at every depth, indents and ends with a newline", () => {
    const text = serialize({ b: 1, a: { d: [{ z: 1, y: 2 }], c: null } });
    expect(text).toBe(
      `${JSON.stringify({ a: { c: null, d: [{ y: 2, z: 1 }] }, b: 1 }, null, 2)}\n`,
    );
    expect(serialize({ a: 1, b: 2 })).toBe(serialize({ b: 2, a: 1 }));
  });

  it.each([
    [{ a: undefined }, "undefined at $.a"],
    [{ a: Number.NaN }, "Not a finite number at $.a"],
    [[Number.POSITIVE_INFINITY], "Not a finite number at $[0]"],
    [{ a: new Date(0) }, "Not a plain object at $.a"],
    [{ a: () => 1 }, "Cannot serialise function at $.a"],
  ])("rejects %o", (value, message) => {
    expect(() => serialize(value)).toThrow(message);
  });
});
