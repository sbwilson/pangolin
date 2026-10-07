import { describe, expect, it } from "vitest";
import { freshnessLabel, isStale } from "./freshness.ts";

describe("isStale", () => {
  it("is stale only past 45 days", () => {
    expect(isStale("2026-08-23", "2026-10-07")).toBe(false); // 45 days
    expect(isStale("2026-08-22", "2026-10-07")).toBe(true); // 46 days
    expect(isStale("2026-10-07", "2026-10-07")).toBe(false);
  });

  it("is never stale without a transaction", () => {
    expect(isStale(null, "2026-10-07")).toBe(false);
  });
});

describe("freshnessLabel", () => {
  it("names the day the data runs to", () => {
    expect(freshnessLabel("2026-09-30")).toBe("to 30 Sep");
    expect(freshnessLabel(null)).toBe("No transactions yet");
  });
});
