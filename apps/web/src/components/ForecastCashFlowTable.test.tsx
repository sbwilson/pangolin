// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ForecastAccountData } from "../api.ts";
import { ForecastCashFlowTable } from "./ForecastCashFlowTable.tsx";

afterEach(cleanup);

function account(
  id: string,
  name: string,
  points: { date: string; balanceCents: number }[],
): ForecastAccountData {
  return { accountId: id, name, lowBalanceThresholdCents: 0, points };
}

const accounts = [
  account("acc-1", "Joint everyday", [
    { date: "2026-07-15", balanceCents: 5_890_975 },
    { date: "2026-07-16", balanceCents: 5_890_974 },
    { date: "2026-07-17", balanceCents: -1_429_250 },
  ]),
  account("acc-2", "Person A private", [
    { date: "2026-07-15", balanceCents: -1_429_250 },
    { date: "2026-07-16", balanceCents: 0 },
    { date: "2026-07-17", balanceCents: 250 },
  ]),
];

describe("ForecastCashFlowTable", () => {
  it("lists every projected day in a keyboard-reachable region", () => {
    render(<ForecastCashFlowTable accounts={accounts} />);
    const table = screen.getByTestId("forecast-cashflow-table");
    expect(table.getAttribute("role")).toBe("region");
    expect(table.getAttribute("tabIndex")).toBe("0");
    expect(table.getAttribute("aria-label")).toBe("Projected balance by day");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("has one column per visible account, labelled by name", () => {
    render(<ForecastCashFlowTable accounts={accounts} />);
    const headers = Array.from(screen.getAllByRole("columnheader")).map((th) => th.textContent);
    expect(headers).toEqual(["Day", "Joint everyday", "Person A private"]);
  });

  it("labels point 0 Today and formats each balance in its account's column", () => {
    render(<ForecastCashFlowTable accounts={accounts} />);
    const rows = screen.getAllByRole("row");

    const first = rows[1];
    expect(first?.querySelector("th[scope='row']")?.textContent).toBe("Today");
    const firstCells = Array.from(first?.querySelectorAll("td") ?? []).map((td) => td.textContent);
    expect(firstCells).toEqual(["$58,909.75", "-$14,292.50"]);

    const last = rows[rows.length - 1];
    expect(last?.querySelector("th[scope='row']")?.textContent).toBe("17 Jul");
    const lastCells = Array.from(last?.querySelectorAll("td") ?? []).map((td) => td.textContent);
    expect(lastCells).toEqual(["-$14,292.50", "$2.50"]);
  });

  it("renders nothing misleading for an empty projection", () => {
    render(<ForecastCashFlowTable accounts={[]} />);
    expect(screen.getByTestId("forecast-cashflow-table").querySelectorAll("tbody tr")).toHaveLength(
      0,
    );
  });
});
