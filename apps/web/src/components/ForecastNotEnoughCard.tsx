// Cash-flow mode's "Not enough to forecast yet" card: one row per forecast input — pay cycle,
// confirmed bills, budgets — naming each gap and linking to the page that fixes it. A present
// input is a calm ✓ with its count. The page decides when this renders (report and both count
// sources settled, at least one gap); this component only shows it.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export interface ForecastNotEnoughCardProps {
  /** The pay gap: true when the projection can see no expected deposit at all. */
  readonly pay: boolean;
  readonly bills: {
    readonly missing: boolean;
    /** Confirmed bill-direction series; shown as `N confirmed` when present. */
    readonly count: number;
    /** Candidate bill series waiting to confirm on the Budgets page. */
    readonly waiting: number;
  };
  readonly budgets: {
    readonly missing: boolean;
    /** Shown as `N set` when present. */
    readonly count: number;
  };
}

const ROW =
  "grid grid-cols-[10rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-2.5 text-sm";
const KEY = "font-semibold";
const VALUE = "inline-flex items-center gap-1.5 text-muted-foreground";
const LINK = "font-semibold underline text-primary";

const Tick = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

interface RowProps {
  readonly testid: string;
  readonly label: string;
  readonly missing: boolean;
  readonly gapValue: string;
  readonly presentValue: string;
  readonly action?: ReactNode;
}

/** One input row: missing shows its gap value and the link that fixes it; present shows a ✓. */
function Row({ testid, label, missing, gapValue, presentValue, action }: RowProps) {
  return (
    <div data-testid={testid} className={ROW}>
      <span className={KEY}>{label}</span>
      {missing ? (
        <span className={VALUE}>{gapValue}</span>
      ) : (
        <span className={`${VALUE} text-money-in`}>
          <Tick />
          {presentValue}
        </span>
      )}
      {missing ? action : <span />}
    </div>
  );
}

/** The card that replaces chart, warnings and chips while the forecast still lacks inputs. */
export function ForecastNotEnoughCard({ pay, bills, budgets }: ForecastNotEnoughCardProps) {
  return (
    <div
      data-testid="forecast-not-enough-card"
      className="rounded-xl border border-border bg-card p-4"
    >
      <h3 className="text-base font-semibold">Not enough to forecast yet</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Pangolin needs three things before it can project your balances.
      </p>
      <div className="mt-2">
        <Row
          testid="forecast-gap-pay"
          label="Pay cycle"
          missing={pay}
          gapValue="Not set"
          presentValue="Set"
          action={
            <Link to="/settings" className={LINK}>
              Set it in Settings →
            </Link>
          }
        />
        <Row
          testid="forecast-gap-bills"
          label="Confirmed bills"
          missing={bills.missing}
          gapValue={
            bills.waiting > 0 ? `None yet · ${bills.waiting} waiting to confirm` : "None yet"
          }
          presentValue={`${bills.count} confirmed`}
          action={
            <Link to="/planning/budgets" className={LINK}>
              Confirm bills →
            </Link>
          }
        />
        <Row
          testid="forecast-gap-budgets"
          label="Budgets"
          missing={budgets.missing}
          gapValue="None yet"
          presentValue={`${budgets.count} set`}
          action={
            <Link to="/planning/budgets" className={LINK}>
              Set budgets →
            </Link>
          }
        />
      </div>
    </div>
  );
}
