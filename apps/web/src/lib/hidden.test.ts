import { describe, expect, it } from "vitest";
import { hiddenUntilLabel, hidingActive, longDay, utcDay } from "./hidden.ts";

describe("hidden names", () => {
  it("spells the month out, from the timestamp the server sends", () => {
    expect(longDay("2027-03-12T00:00:00.000Z")).toBe("12 March 2027");
    expect(hiddenUntilLabel("2027-03-12")).toBe("Hidden until 12 March 2027");
    expect(hiddenUntilLabel(null)).toBe("Hidden");
  });

  it("is active only until the end day", () => {
    expect(hidingActive("2027-03-12T00:00:00Z", "2027-03-11")).toBe(true);
    expect(hidingActive("2027-03-12T00:00:00Z", "2027-03-12")).toBe(false);
    expect(hidingActive(null, "2027-03-12")).toBe(false);
  });

  it("takes the UTC day, not the local one", () => {
    expect(utcDay(new Date("2027-03-11T23:30:00Z"))).toBe("2027-03-11");
    expect(utcDay(new Date("2027-03-12T00:30:00Z"))).toBe("2027-03-12");
  });
});
