import { describe, expect, it } from "vitest";
import { freshnessLabel, isStale } from "./freshness.ts";

describe("isStale", () => {
  it("is stale only past 45 days", () => {
    expect(isStale("2026-08-23", "2026-10-07")).toBe(false); // 45 days
    expect(isStale("2026-08-22", "2026-10-07")).toBe(true); // 46 days
    expect(isStale("2026-10-07", "2026-10-07")).toBe(false);
  });

  it("is never stale without an import", () => {
    expect(isStale(null, "2026-10-07")).toBe(false);
  });
});

describe("freshnessLabel", () => {
  it("names the day, source and time of the last import", () => {
    const importedAt = new Date(2026, 9, 7, 14, 5).toISOString(); // 14:05 in the local zone
    expect(freshnessLabel({ through: "2026-09-30", source: "ofx", importedAt })).toBe(
      "imported up to 30 Sep from ofx, 14:05",
    );
    expect(freshnessLabel(null)).toBe("No imports yet");
  });
});
