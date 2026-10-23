import { describe, expect, it } from "vitest";
import { apportion } from "./apportion.ts";

const people = ["a", "b"];

describe("apportion", () => {
  it("splits by contribution", () => {
    const r = apportion({
      sharedCents: 100_000,
      contributions: [
        { personId: "a", cents: 600 },
        { personId: "b", cents: 400 },
      ],
      people,
      setting: "contribution",
    });
    expect(r.basis).toBe("contribution");
    expect(r.shares).toEqual([
      { personId: "a", cents: 60_000 },
      { personId: "b", cents: 40_000 },
    ]);
  });

  it("splits evenly whatever was contributed", () => {
    const r = apportion({
      sharedCents: 1000,
      contributions: [{ personId: "a", cents: 900 }],
      people,
      setting: "even",
    });
    expect(r.basis).toBe("even");
    expect(r.shares.map((s) => s.cents)).toEqual([500, 500]);
  });

  it("falls back to even with no contribution", () => {
    const r = apportion({ sharedCents: 1000, contributions: [], people, setting: "contribution" });
    expect(r.basis).toBe("even-fallback");
    expect(r.shares.map((s) => s.cents)).toEqual([500, 500]);
  });

  it("gives the odd cent to the earlier person and sums exactly", () => {
    const r = apportion({ sharedCents: 10_001, contributions: [], people, setting: "even" });
    expect(r.shares.map((s) => s.cents)).toEqual([5001, 5000]);
  });

  it("sums exactly on awkward weights and ignores unknown contributors", () => {
    const r = apportion({
      sharedCents: 9999,
      contributions: [
        { personId: "a", cents: 1 },
        { personId: "b", cents: 2 },
        { personId: "gone", cents: 1_000_000 },
      ],
      people,
      setting: "contribution",
    });
    expect(r.shares.reduce((n, s) => n + s.cents, 0)).toBe(9999);
  });

  it("handles a zero total and rejects no people", () => {
    expect(
      apportion({ sharedCents: 0, contributions: [], people, setting: "even" }).shares.map(
        (s) => s.cents,
      ),
    ).toEqual([0, 0]);
    expect(() =>
      apportion({ sharedCents: 1, contributions: [], people: [], setting: "even" }),
    ).toThrow(RangeError);
  });

  it("clamps a negative contribution to zero", () => {
    const r = apportion({
      sharedCents: 1000,
      contributions: [
        { personId: "a", cents: -500 },
        { personId: "b", cents: 400 },
      ],
      people,
      setting: "contribution",
    });
    expect(r.basis).toBe("contribution");
    expect(r.shares.map((s) => s.cents)).toEqual([0, 1000]);
  });

  it("falls back to even when every contribution is negative", () => {
    const r = apportion({
      sharedCents: 1000,
      contributions: [
        { personId: "a", cents: -500 },
        { personId: "b", cents: -400 },
      ],
      people,
      setting: "contribution",
    });
    expect(r.basis).toBe("even-fallback");
    expect(r.shares.map((s) => s.cents)).toEqual([500, 500]);
  });

  it("splits a negative shared total exactly", () => {
    const r = apportion({
      sharedCents: -10_001,
      contributions: [
        { personId: "a", cents: 1 },
        { personId: "b", cents: 2 },
      ],
      people,
      setting: "contribution",
    });
    expect(r.shares.reduce((n, s) => n + s.cents, 0)).toBe(-10_001);
  });
});
