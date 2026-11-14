import { describe, expect, it } from "vitest";
import { shortDayLabel } from "./forecast-labels.ts";

describe("shortDayLabel", () => {
  it("renders a day-of-month and short month", () => {
    expect(shortDayLabel("2026-07-15")).toBe("15 Jul");
    expect(shortDayLabel("2027-01-01")).toBe("1 Jan");
    expect(shortDayLabel("2026-12-31")).toBe("31 Dec");
  });
});
