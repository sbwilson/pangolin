import { describe, expect, it } from "vitest";
import {
  daysApart,
  findTransferMatch,
  isProbableDuplicate,
  shiftDay,
  type TransferLeg,
} from "./match-transfers.ts";

const leg = (
  id: string,
  accountId: string,
  postedOn: string,
  amountCents: number,
): TransferLeg => ({
  id,
  accountId,
  postedOn,
  amountCents,
});

describe("day arithmetic", () => {
  it("shifts across month and year ends", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysApart("2026-03-05", "2026-03-02")).toBe(3);
  });
});

describe("findTransferMatch", () => {
  const out = leg("n", "A", "2026-03-05", -50000);
  const inB = leg("b", "B", "2026-03-03", 50000);

  it("matches a unique pair from both ends", () => {
    const r = findTransferMatch(out, [inB], () => [out]);
    expect(r).toEqual({ kind: "match", candidate: inB });
  });

  it("is none outside the window or in the same account", () => {
    expect(findTransferMatch(out, [leg("x", "B", "2026-03-01", 50000)], () => [out]).kind).toBe(
      "none",
    );
    expect(findTransferMatch(out, [leg("x", "A", "2026-03-05", 50000)], () => [out]).kind).toBe(
      "none",
    );
  });

  it("is ambiguous with two candidates", () => {
    const r = findTransferMatch(out, [inB, leg("c", "C", "2026-03-05", 50000)], () => [out]);
    expect(r.kind).toBe("ambiguous");
  });

  it("is ambiguous when the candidate has two counterparts", () => {
    const sibling = leg("s", "A", "2026-03-04", -50000);
    expect(findTransferMatch(out, [inB], () => [out, sibling]).kind).toBe("ambiguous");
  });
});

describe("isProbableDuplicate", () => {
  const base = {
    postedOn: "2026-03-03",
    amountCents: -450,
    normalisedDescription: "CAFE",
    externalId: null,
  };
  it("flags a 1-3 day shift", () => {
    expect(isProbableDuplicate(base, { ...base, postedOn: "2026-03-02" })).toBe(true);
    expect(isProbableDuplicate(base, { ...base, postedOn: "2026-02-27" })).toBe(false);
  });
  it("ignores same-day, other amounts, other descriptions and distinct bank ids", () => {
    expect(isProbableDuplicate(base, { ...base })).toBe(false);
    expect(isProbableDuplicate(base, { ...base, postedOn: "2026-03-02", amountCents: -451 })).toBe(
      false,
    );
    expect(
      isProbableDuplicate(base, { ...base, postedOn: "2026-03-02", normalisedDescription: "X" }),
    ).toBe(false);
    expect(
      isProbableDuplicate(
        { ...base, externalId: "1" },
        { ...base, postedOn: "2026-03-02", externalId: "2" },
      ),
    ).toBe(false);
  });
});
