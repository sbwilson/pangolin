import { describe, expect, it } from "vitest";
import { createRng, hash128, rngFor } from "./rng.ts";

function draw(rng: { next(): number }, n: number): number[] {
  return Array.from({ length: n }, () => rng.next());
}

describe("hash128", () => {
  it("is stable and gives four unsigned 32-bit words", () => {
    const words = hash128("pangolin-v1:people-and-household");
    expect(words).toEqual(hash128("pangolin-v1:people-and-household"));
    expect(words).toHaveLength(4);
    for (const w of words) expect(w >>> 0).toBe(w);
    expect(hash128("a")).not.toEqual(hash128("b"));
  });
});

describe("createRng", () => {
  it("repeats the same stream for the same seed and differs for another", () => {
    expect(draw(createRng("x"), 20)).toEqual(draw(createRng("x"), 20));
    expect(draw(createRng("x"), 20)).not.toEqual(draw(createRng("y"), 20));
  });

  it("returns numbers in [0, 1)", () => {
    for (const n of draw(createRng("range"), 10_000)) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it("int covers [min, max] inclusively and rejects bad bounds", () => {
    const rng = createRng("int");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(-2, 3));
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect(() => rng.int(3, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 1)).toThrow(RangeError);
  });

  it("pick returns list members and rejects an empty list", () => {
    const rng = createRng("pick");
    const items = ["a", "b", "c"];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
    expect([...seen].sort()).toEqual(items);
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("never reads Math.random", () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error("Math.random read");
    };
    try {
      draw(createRng("no-math-random"), 10);
    } finally {
      Math.random = original;
    }
  });
});

describe("rngFor", () => {
  it("derives the stream from seed + ':' + module", () => {
    expect(draw(rngFor("s", "m"), 5)).toEqual(draw(createRng("s:m"), 5));
    expect(draw(rngFor("s", "m"), 5)).not.toEqual(draw(rngFor("s", "n"), 5));
  });
});
