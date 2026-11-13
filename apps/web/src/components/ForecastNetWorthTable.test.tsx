// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ForecastNetWorthLine, ForecastNetWorthReport } from "../api.ts";
import { ForecastNetWorthTable } from "./ForecastNetWorthTable.tsx";

afterEach(cleanup);

function line(start: number, step: number): ForecastNetWorthLine {
  return {
    returnBps: 500,
    annualReturnPercent: "5",
    points: Array.from({ length: 3 }, (_, month) => {
      const d = new Date(Date.UTC(2026, 10, 15));
      d.setUTCMonth(d.getUTCMonth() + month);
      return { month, date: d.toISOString().slice(0, 10), netWorthCents: start + month * step };
    }),
  };
}

const report: ForecastNetWorthReport = {
  asOf: "2026-11-15",
  horizonYears: 1,
  lines: {
    low: line(33_320_534, 300_000),
    mid: line(33_320_534, 400_000),
    high: line(33_320_534, 500_000),
  },
};

describe("ForecastNetWorthTable", () => {
  it("lists every monthly point in a keyboard-reachable region", () => {
    render(<ForecastNetWorthTable report={report} />);
    const table = screen.getByTestId("forecast-networth-table");
    expect(table.getAttribute("role")).toBe("region");
    expect(table.getAttribute("tabIndex")).toBe("0");
    expect(table.getAttribute("aria-label")).toBe("Net worth projection by month");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("labels point 0 Today and orders the rest by month, Low/Mid/High per row", () => {
    render(<ForecastNetWorthTable report={report} />);
    const rows = screen.getAllByRole("row");
    const headers = Array.from(rows[0]?.querySelectorAll("th") ?? []).map((th) => th.textContent);
    expect(headers).toEqual(["Month", "Low", "Mid", "High"]);

    const first = rows[1];
    expect(first?.querySelector("th[scope='row']")?.textContent).toBe("Today");
    expect(first?.textContent).toContain("$333,205.34");
    expect(first?.textContent).toContain("$333,205.34");

    const last = rows[rows.length - 1];
    expect(last?.querySelector("th[scope='row']")?.textContent).toBe("January 2027");
    expect(last?.textContent).toContain("$339,205.34"); // low  +2×300k
    expect(last?.textContent).toContain("$341,205.34"); // mid  +2×400k
    expect(last?.textContent).toContain("$343,205.34"); // high +2×500k
  });
});
