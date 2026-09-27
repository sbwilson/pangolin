import { type Id, idSchema } from "@pangolin/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createIdGenerator, newId } from "./ids.ts";

const accountId = idSchema("Account");

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("newId", () => {
  it("mints an ID that parses under its brand's schema", () => {
    const id = newId<"Account">();
    expectTypeOf(id).toEqualTypeOf<Id<"Account">>();
    expect(accountId.parse(id)).toBe(id);
  });
});

describe("createIdGenerator", () => {
  it("is deterministic with injected time and randomness", () => {
    const sources = () => ({ now: () => 1_790_000_000_000, random: mulberry32(7) });
    const a = createIdGenerator(sources());
    const b = createIdGenerator(sources());
    const first = [a<"Split">(), a<"Split">(), a<"Split">()];
    expect([b<"Split">(), b<"Split">(), b<"Split">()]).toEqual(first);
    for (const id of first) expect(accountId.safeParse(id).success).toBe(true);
  });

  it("encodes the injected time and stays monotonic within a millisecond", () => {
    // 33 ms since the epoch is "0000000011" in Crockford base32 (32 + 1).
    const generate = createIdGenerator({ now: () => 33, random: mulberry32(1) });
    const ids = Array.from({ length: 50 }, () => generate<"Account">());
    expect(ids.every((id) => id.startsWith("0000000011"))).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([0, -1, 1.5])("rejects an injected time of %s instead of reading the real clock", (t) => {
    const generate = createIdGenerator({ now: () => t, random: mulberry32(1) });
    expect(() => generate<"Account">()).toThrow(RangeError);
  });

  it("sorts by time across milliseconds", () => {
    let ms = 1_790_000_000_000;
    const generate = createIdGenerator({ now: () => ms++, random: mulberry32(3) });
    const ids = Array.from({ length: 20 }, () => generate<"Account">());
    expect([...ids].sort()).toEqual(ids);
  });
});
