// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Me, PayAnchorData } from "../api.ts";
import {
  type ChipSource,
  ForecastContextChips,
  type LowBalanceLine,
} from "./ForecastContextChips.tsx";

afterEach(() => cleanup());

const me: Me = {
  personId: "p1",
  displayName: "Simon",
  colour: "#2C6681",
  authAt: "2026-10-18T00:00:00Z",
  canInvite: false,
  demo: false,
  enrolment: "complete",
  needs: [],
  recoveryCodes: { issued: true, remaining: 10 },
  partner: { personId: "p2", displayName: "Carissa" },
};

const anchor = (over: Partial<PayAnchorData> = {}): PayAnchorData => ({
  id: "pa-1",
  personId: "p1",
  accountId: "acc-1",
  cadence: "fortnightly",
  dayOfMonth: null,
  anchorDate: "2026-10-03",
  alignment: "deposit",
  expectedNetCents: 318_000,
  expectedGrossCents: null,
  ...over,
});

const ready = <T,>(value: T): ChipSource<T> => ({ state: "ready", value });
const line = (name: string, thresholdCents: number): LowBalanceLine => ({ name, thresholdCents });

const renderChips = (props: {
  pay?: ChipSource<{ me: Me | null; anchors: readonly PayAnchorData[] }>;
  bills?: ChipSource<number>;
  budgets?: ChipSource<number>;
  thresholds?: ChipSource<readonly LowBalanceLine[]>;
}) =>
  render(
    <ForecastContextChips
      pay={props.pay ?? ready({ me, anchors: [] })}
      bills={props.bills ?? ready(0)}
      budgets={props.budgets ?? ready(0)}
      thresholds={props.thresholds ?? ready([])}
    />,
  );

describe("ForecastContextChips", () => {
  it("carries the mockup copy when everything is set", () => {
    renderChips({
      pay: ready({
        me,
        anchors: [anchor(), anchor({ id: "pa-2", personId: "p2", expectedNetCents: 295_615 })],
      }),
      bills: ready(11),
      budgets: ready(4),
      thresholds: ready([
        line("Everyday", 20_000),
        line("Shared bills", 50_000),
        line("No line", 0),
      ]),
    });
    expect(screen.getByText("Assumptions")).toBeDefined();
    expect(screen.getByText("Fortnightly pay: Simon $3,180 · Carissa $2,956")).toBeDefined();
    expect(screen.getByText("11 confirmed bills")).toBeDefined();
    expect(screen.getByText("4 budgets, spent at their limits")).toBeDefined();
    expect(screen.getByText("Low-balance lines: Everyday $200 · Shared bills $500")).toBeDefined();
  });

  it("gives the honest zero copy", () => {
    renderChips({});
    expect(screen.getByText("Pay cycle — not set")).toBeDefined();
    expect(screen.getByText("No confirmed bills")).toBeDefined();
    expect(screen.getByText("No budgets yet")).toBeDefined();
    expect(screen.getByText("Low-balance lines — none set")).toBeDefined();
  });

  it("says Pay: when the anchors' cadences disagree", () => {
    renderChips({
      pay: ready({
        me,
        anchors: [anchor(), anchor({ id: "pa-2", personId: "p2", cadence: "monthly" })],
      }),
    });
    expect(screen.getByText(/Pay: Simon \$3,180 · Carissa \$3,180/)).toBeDefined();
  });

  it("shows a singular and a name without an amount when there is none", () => {
    renderChips({
      pay: ready({ me, anchors: [anchor({ expectedNetCents: null })] }),
      bills: ready(1),
      budgets: ready(1),
    });
    expect(screen.getByText("Fortnightly pay: Simon")).toBeDefined();
    expect(screen.getByText("1 confirmed bill")).toBeDefined();
    expect(screen.getByText("1 budget, spent at its limit")).toBeDefined();
  });

  it("omits a chip whose source failed, and renders nothing when none are ready", () => {
    const { container } = render(
      <ForecastContextChips
        pay={{ state: "failed" }}
        bills={{ state: "loading" }}
        budgets={ready(2)}
        thresholds={{ state: "failed" }}
      />,
    );
    expect(screen.getByText("2 budgets, spent at their limits")).toBeDefined();
    expect(screen.queryByText(/Pay/)).toBeNull();
    expect(screen.queryByText(/confirmed bills/)).toBeNull();
    expect(screen.queryByText(/Low-balance lines/)).toBeNull();
    expect(container.querySelectorAll(".chdot, [aria-label='changed']")).toHaveLength(0);

    cleanup();
    const empty = render(
      <ForecastContextChips
        pay={{ state: "loading" }}
        bills={{ state: "failed" }}
        budgets={{ state: "loading" }}
        thresholds={{ state: "failed" }}
      />,
    );
    expect(empty.container.firstChild).toBeNull();
  });

  it("carries no edit affordance", () => {
    renderChips({ bills: ready(3) });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
