import { describe, expect, it } from "vitest";
import { reconcileStatement } from "./reconcile-statement.ts";

// Oldest first: opening 1000, then -300, +500, -200.
const oldest = [
  { amountCents: -300, balanceCents: 700 },
  { amountCents: 500, balanceCents: 1200 },
  { amountCents: -200, balanceCents: 1000 },
];

describe("reconcileStatement", () => {
  it("accepts balances that chain, oldest first", () => {
    expect(reconcileStatement(oldest)).toEqual({
      status: "ok",
      gapCents: 0,
      openingCents: 1000,
      closingCents: 1000,
    });
  });

  it("accepts the same rows listed newest first", () => {
    expect(reconcileStatement([...oldest].reverse())).toEqual({
      status: "ok",
      gapCents: 0,
      openingCents: 1000,
      closingCents: 1000,
    });
  });

  it("reports the size of a break, in either order", () => {
    // Opening 10000; the +400 row is missing, so 9400 then 9300 leaves 400 unexplained.
    const dropped = [
      { amountCents: -100, balanceCents: 9900 },
      { amountCents: -200, balanceCents: 9700 },
      { amountCents: -300, balanceCents: 9400 },
      { amountCents: -500, balanceCents: 9300 },
      { amountCents: -600, balanceCents: 8700 },
    ];
    expect(reconcileStatement(dropped)).toEqual({
      status: "gap",
      gapCents: 400,
      openingCents: null,
      closingCents: null,
    });
    expect(reconcileStatement([...dropped].reverse())).toEqual({
      status: "gap",
      gapCents: 400,
      openingCents: null,
      closingCents: null,
    });
  });

  it("sums several breaks", () => {
    const rows = [
      { amountCents: -100, balanceCents: 900 },
      { amountCents: -100, balanceCents: 700 },
      { amountCents: -100, balanceCents: 400 },
    ];
    expect(reconcileStatement(rows)).toEqual({
      status: "gap",
      gapCents: 300,
      openingCents: null,
      closingCents: null,
    });
  });

  it("is unavailable without printed balances", () => {
    expect(reconcileStatement([])).toEqual({
      status: "unavailable",
      gapCents: 0,
      openingCents: null,
      closingCents: null,
    });
    expect(
      reconcileStatement([{ amountCents: 5 }, { amountCents: 6, balanceCents: null }]),
    ).toEqual({ status: "unavailable", gapCents: 0, openingCents: null, closingCents: null });
  });

  it("is unavailable with a single balanced row", () => {
    expect(reconcileStatement([{ amountCents: -100, balanceCents: 5 }])).toEqual({
      status: "unavailable",
      gapCents: 0,
      openingCents: null,
      closingCents: null,
    });
  });

  it("skips pairs that lack a balance", () => {
    expect(
      reconcileStatement([
        { amountCents: -300, balanceCents: 700 },
        { amountCents: 1 },
        { amountCents: 500, balanceCents: 1200 },
      ]),
    ).toEqual({ status: "unavailable", gapCents: 0, openingCents: null, closingCents: null });
  });

  it("derives the opening and closing balance in either order", () => {
    const rows = [
      { amountCents: -300, balanceCents: 700 },
      { amountCents: 500, balanceCents: 1200 },
      { amountCents: -200, balanceCents: 1000 },
      { amountCents: -250, balanceCents: 750 },
    ];
    const expected = { status: "ok", gapCents: 0, openingCents: 1000, closingCents: 750 };
    expect(reconcileStatement(rows)).toEqual(expected);
    expect(reconcileStatement([...rows].reverse())).toEqual(expected);
  });

  it("gives no opening or closing when the oldest row prints no balance", () => {
    const rows = [
      { amountCents: -50 },
      { amountCents: -100, balanceCents: 900 },
      { amountCents: -100, balanceCents: 800 },
    ];
    const expected = { status: "ok", gapCents: 0, openingCents: null, closingCents: null };
    expect(reconcileStatement(rows)).toEqual(expected);
    expect(reconcileStatement([...rows].reverse())).toEqual(expected);
  });

  it("gives no opening or closing when both orientations chain", () => {
    expect(
      reconcileStatement([
        { amountCents: 0, balanceCents: 100 },
        { amountCents: 0, balanceCents: 100 },
      ]),
    ).toEqual({ status: "ok", gapCents: 0, openingCents: null, closingCents: null });
  });
});
