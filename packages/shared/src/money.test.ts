import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { allocate, type Cents, cents, centsSchema, toCents } from "./money.ts";

/** Deterministic PRNG (mulberry32) so the property test is reproducible. */
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

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

const sum = (parts: readonly number[]): number => parts.reduce((a, b) => a + b, 0);

describe("cents", () => {
  it("brands safe integers and rejects anything else", () => {
    expect(cents(-42)).toBe(-42);
    expect(Object.is(cents(-0), 0)).toBe(true);
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => cents(Number.NaN)).toThrow(RangeError);
  });

  it("centsSchema accepts only safe integers", () => {
    expect(centsSchema.parse(1234)).toBe(1234);
    expect(centsSchema.safeParse(12.5).success).toBe(false);
    expect(centsSchema.safeParse("12").success).toBe(false);
    expect(centsSchema.safeParse(2 ** 53).success).toBe(false);
  });
});

describe("allocate", () => {
  it("splits evenly with earlier indexes winning remainder ties", () => {
    expect(allocate(cents(100), [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("splits by basis points", () => {
    expect(allocate(cents(1001), [5000, 5000])).toEqual([501, 500]);
  });

  it("gives leftovers to the largest remainders", () => {
    // Exact shares 1.6, 3.2, 5.2 -> floors 1, 3, 5; one leftover goes to the .6.
    expect(allocate(cents(10), [16, 32, 52])).toEqual([2, 3, 5]);
  });

  it("negates parts for a negative total", () => {
    expect(allocate(cents(-100), [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it("returns zeros for a zero total and for zero weights", () => {
    const parts = allocate(cents(0), [1, 2]);
    expect(parts).toEqual([0, 0]);
    expect(parts.every((p) => Object.is(p, 0))).toBe(true);
    expect(allocate(cents(-7), [0, 1, 0])).toEqual([0, -7, 0]);
  });

  it("is exact for huge values", () => {
    const total = cents(900_000_000_000_000);
    expect(allocate(total, [3333, 3333, 3334])).toEqual([
      299_970_000_000_000, 299_970_000_000_000, 300_060_000_000_000,
    ]);
    expect(allocate(total, [10000])).toEqual([900_000_000_000_000]);
    const max = cents(Number.MAX_SAFE_INTEGER);
    expect(sum(allocate(max, [1, 1, 1, 7]))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each<[string, number[]]>([
    ["empty", []],
    ["all zero", [0, 0]],
    ["negative", [1, -1]],
    ["non-integer", [0.5, 1]],
    ["NaN", [Number.NaN]],
    ["unsafe", [2 ** 53]],
  ])("throws RangeError for %s weights", (_, weights) => {
    expect(() => allocate(cents(100), weights)).toThrow(RangeError);
  });

  it("throws RangeError for a non-integer total", () => {
    expect(() => allocate(1.5 as Cents, [1])).toThrow(RangeError);
  });

  it("property: parts sum to the total and are within one cent of the exact share", () => {
    const rng = mulberry32(20260927);
    for (let run = 0; run < 2000; run++) {
      const magnitude = run % 10 === 0 ? 1_000_000_000_000 : 1_000_000;
      const total = cents(randInt(rng, -magnitude, magnitude));
      const length = randInt(rng, 1, 12);
      const weights = Array.from({ length }, () => randInt(rng, 0, 10_000));
      if (sum(weights) === 0) weights[0] = 1;
      const weightSum = BigInt(sum(weights));

      const parts = allocate(total, weights);
      expect(parts).toHaveLength(length);
      expect(parts.reduce((a, b) => a + BigInt(b), 0n)).toBe(BigInt(total));
      weights.forEach((weight, i) => {
        // |part * W - total * w| <= W  <=>  |part - exact share| <= 1 cent
        const diff = BigInt(parts[i] ?? 0) * weightSum - BigInt(total) * BigInt(weight);
        expect(diff < 0n ? -diff : diff).toBeLessThanOrEqual(weightSum);
        if (weight === 0) expect(parts[i]).toBe(0);
      });
    }
  });
});

describe("toCents", () => {
  it.each([
    ["0.125", 12],
    ["0.135", 14],
    ["-0.125", -12],
    ["-0.135", -14],
    ["0.005", 0],
    ["0.015", 2],
    ["2.675", 268],
    ["12.34", 1234],
    ["7", 700],
    ["-.5", -50],
    ["+1.", 100],
  ])("rounds %s dollars half-even to %i cents", (amount, expected) => {
    expect(toCents(amount)).toBe(expected);
  });

  it("does not round twice on long inputs", () => {
    expect(toCents(`0.005${"0".repeat(50)}1`)).toBe(1);
  });

  it("accepts decimal.js values, including other contexts", () => {
    expect(toCents(new Decimal("1.005"))).toBe(100);
    expect(toCents(new Decimal("3.3333").times(3))).toBe(1000);
  });

  it("normalises negative zero", () => {
    expect(Object.is(toCents("-0.001"), 0)).toBe(true);
  });

  it("throws RangeError beyond safe-integer cents", () => {
    expect(toCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toCents("90071992547409.92")).toThrow(RangeError);
    expect(() => toCents(`-1${"0".repeat(30)}`)).toThrow(RangeError);
  });

  it.each(["", "abc", "1e5", "0x10", "1,000.00", "NaN", "Infinity", " 1"])(
    "rejects the malformed amount %j",
    (amount) => {
      expect(() => toCents(amount)).toThrow(RangeError);
    },
  );

  it("rejects non-finite decimal.js values", () => {
    expect(() => toCents(new Decimal(Number.POSITIVE_INFINITY))).toThrow(RangeError);
    expect(() => toCents(new Decimal(Number.NaN))).toThrow(RangeError);
  });
});
