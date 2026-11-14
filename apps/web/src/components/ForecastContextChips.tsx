// The cash-flow mode's "Assumptions" chips row: four read-only chips naming what drives the
// projection — pay, confirmed bills, budgets and the low-balance lines. The page assembles the
// data from the existing fetchers and the report's own thresholds; this component only shows it.
// A source that is still loading or failed keeps its chip out; zero counts say so honestly.
import type { Me, PayAnchorData } from "../api.ts";
import { formatWholeDollars } from "../lib/money.ts";

/** One context source: still loading, failed (the chip is then omitted), or ready to render. */
export type ChipSource<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly value: T };

export interface LowBalanceLine {
  readonly name: string;
  readonly thresholdCents: number;
}

export interface PayContext {
  readonly me: Me | null;
  readonly anchors: readonly PayAnchorData[];
}

export interface ForecastContextChipsProps {
  readonly pay: ChipSource<PayContext>;
  readonly bills: ChipSource<number>;
  readonly budgets: ChipSource<number>;
  readonly thresholds: ChipSource<readonly LowBalanceLine[]>;
}

const CADENCE_WORD: Readonly<Record<PayAnchorData["cadence"], string>> = {
  fortnightly: "Fortnightly",
  monthly: "Monthly",
};

const ROW = "mt-3.5 flex flex-wrap items-center gap-2";
const LABEL = "mr-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground";
const CHIP =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground";

/** The signed-in person's or the partner's name for an anchor; anything else is not ours to name. */
const payName = (me: Me | null, personId: string): string | null => {
  if (me === null) return null;
  if (personId === me.personId) return me.displayName === "" ? "You" : me.displayName;
  if (me.partner !== null && personId === me.partner.personId) {
    return me.partner.displayName === "" ? "Partner" : me.partner.displayName;
  }
  return null;
};

const payCopy = (value: PayContext): string => {
  const { me, anchors } = value;
  const entries = anchors.flatMap((anchor) => {
    const name = payName(me, anchor.personId);
    if (name === null) return [];
    return [
      anchor.expectedNetCents === null
        ? name
        : `${name} ${formatWholeDollars(anchor.expectedNetCents)}`,
    ];
  });
  if (entries.length === 0) return "Pay cycle — not set";
  const sharedCadence =
    anchors[0] !== undefined && anchors.every((a) => a.cadence === anchors[0]?.cadence)
      ? anchors[0].cadence
      : undefined;
  const label = sharedCadence === undefined ? "Pay:" : `${CADENCE_WORD[sharedCadence]} pay:`;
  return `${label} ${entries.join(" · ")}`;
};

const billsCopy = (count: number): string =>
  count === 0 ? "No confirmed bills" : `${count} confirmed bill${count === 1 ? "" : "s"}`;

const budgetsCopy = (count: number): string =>
  count === 0
    ? "No budgets yet"
    : count === 1
      ? "1 budget, spent at its limit"
      : `${count} budgets, spent at their limits`;

const thresholdsCopy = (lines: readonly LowBalanceLine[]): string => {
  const set = lines.filter((line) => line.thresholdCents > 0);
  if (set.length === 0) return "Low-balance lines — none set";
  return `Low-balance lines: ${set
    .map((line) => `${line.name} ${formatWholeDollars(line.thresholdCents)}`)
    .join(" · ")}`;
};

/** Read-only context chips; no chip here carries an edit affordance. */
export function ForecastContextChips({
  pay,
  bills,
  budgets,
  thresholds,
}: ForecastContextChipsProps) {
  const chips: string[] = [];
  if (pay.state === "ready") chips.push(payCopy(pay.value));
  if (bills.state === "ready") chips.push(billsCopy(bills.value));
  if (budgets.state === "ready") chips.push(budgetsCopy(budgets.value));
  if (thresholds.state === "ready") chips.push(thresholdsCopy(thresholds.value));
  if (chips.length === 0) return null;

  return (
    <div className={ROW} data-testid="forecast-context-chips">
      <span className={LABEL}>Assumptions</span>
      {chips.map((text) => (
        <span key={text} className={CHIP}>
          {text}
        </span>
      ))}
    </div>
  );
}
