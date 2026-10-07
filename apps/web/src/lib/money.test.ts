import { describe, expect, it } from "vitest";
import { centsToText, parseCents } from "./money.ts";

describe("parseCents", () => {
  it("reads dollars and cents without floating point", () => {
    expect(parseCents("4.65")).toBe(465);
    expect(parseCents("-4.5")).toBe(-450);
    expect(parseCents(" 12 ")).toBe(1200);
    expect(parseCents("0.1")).toBe(10);
    expect(parseCents("-0")).toBe(0);
  });

  it("rejects anything that is not an amount to the cent", () => {
    for (const text of ["", "abc", "1.234", "1,5", "--1", ".5", "1e3"]) {
      expect(parseCents(text)).toBeUndefined();
    }
  });
});

describe("centsToText", () => {
  it("round-trips", () => {
    for (const cents of [0, 5, 465, -450, -5, 123456]) {
      expect(parseCents(centsToText(cents))).toBe(cents);
    }
    expect(centsToText(-450)).toBe("-4.50");
  });
});
