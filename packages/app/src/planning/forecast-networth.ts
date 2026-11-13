// `planning.forecastNetWorth` (read-only, AD-11, AD-22): three monthly net-worth series —
// low, mid and high return — for the signed-in person. Point 0 is today's `netWorth()` figures
// (same balance-as-of, visibility, and open/closed rules); each following month the pot gains
// the savings- and super-rate shares of the person's pay-anchor income and compounds at the
// line's stored return, while selected open home loans amortise on their stored terms and
// credit cards stay flat. Rates are stored basis points converted to decimal-string percents
// here (bps ÷ 100); loans without complete terms — and closed ones, which the net-worth
// baseline already excludes — contribute no amortisation. The domain walk is pure; this
// resolves the clock, the assumptions and the accounts.

import {
  NET_WORTH_PROJECTION_HORIZONS,
  type NetWorthProjectionHorizon,
  projectNetWorth,
} from "@pangolin/domain";
import { Decimal } from "@pangolin/shared";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { netWorth } from "../reports/net-worth.ts";
import { getForecastAssumptions } from "./forecast-assumptions.ts";

/** The horizons the projection offers, in years from today. */
export const FORECAST_NET_WORTH_HORIZONS = NET_WORTH_PROJECTION_HORIZONS;
export type ForecastNetWorthHorizon = NetWorthProjectionHorizon;

/** `1`, `2`, `5` or `10` (number or string); anything else means null (a `Validation` input). */
export function parseForecastNetWorthHorizon(value: unknown): ForecastNetWorthHorizon | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return NET_WORTH_PROJECTION_HORIZONS.find((h) => h === n) ?? null;
}

export const forecastNetWorthInput = z
  .object({
    /** `1`, `2`, `5` or `10` (number or string); omitted means 2. Anything else is `Validation`. */
    horizon: z.union([z.number(), z.string()]).optional(),
  })
  .strict()
  .superRefine((data, issue) => {
    if (data.horizon !== undefined && parseForecastNetWorthHorizon(data.horizon) === null) {
      issue.addIssue({
        code: "custom",
        message: "horizon must be one of 1, 2, 5 or 10",
        path: ["horizon"],
      });
    }
  });
export type ForecastNetWorthInput = z.input<typeof forecastNetWorthInput>;

export interface ForecastNetWorthPoint {
  /** 0-based month index from `asOf`. */
  readonly month: number;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly netWorthCents: number;
}

export interface ForecastNetWorthLine {
  /** The stored return assumption driving this line, in basis points. */
  readonly returnBps: number;
  /** The same return as the walk's decimal-string percent (`500` bps is `"5"`). */
  readonly annualReturnPercent: string;
  /** `horizonYears × 12 + 1` monthly points; point 0 is today. */
  readonly points: readonly ForecastNetWorthPoint[];
}

export interface ForecastNetWorthReport {
  /** `YYYY-MM-DD`: today by the clock — the date of every line's point 0. */
  readonly asOf: string;
  readonly horizonYears: ForecastNetWorthHorizon;
  readonly lines: {
    readonly low: ForecastNetWorthLine;
    readonly mid: ForecastNetWorthLine;
    readonly high: ForecastNetWorthLine;
  };
}

/**
 * `planning.forecastNetWorth`: the person-viewer net-worth projection behind views 8.6/8.7.
 * The pot starts at today's `netWorth(ctx).assetsCents` (floored at 0 — an overdrawn account's
 * excess folds into the flat deduction, keeping point 0 today's net worth); each month adds the savings and super contributions —
 * monthly income = Σ visible pay anchors' `expectedNetCents` (fortnightly ×26, monthly ×12) ÷ 12,
 * times each rate, half-even — then compounds the pot at the line's return. Every point
 * subtracts each open home loan's schedule balance (selected loans with complete terms
 * amortise on their stored terms, netting the whole open-offset pool when `countOffset`;
 * the rest hold today's balances) and the flat card subtotal. One domain call per line, on
 * identical everything-else, so low ≤ mid ≤ high at every point.
 */
export function forecastNetWorth(
  ctx: UseCaseContext,
  input: ForecastNetWorthInput = {},
): ForecastNetWorthReport {
  const parsed = parseInput(forecastNetWorthInput, input);
  const horizonYears = parseForecastNetWorthHorizon(parsed.horizon ?? 2);
  if (horizonYears === null) {
    throw new AppError("Validation", "horizon must be one of 1, 2, 5 or 10");
  }
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");

  const report = netWorth(ctx);
  const assumptions = getForecastAssumptions(ctx);
  const anchors = ctx.uow.read((repos) => repos.payAnchors.listVisible(viewer));

  // Monthly income (AD-25): expected nets annualised — fortnightly ×26, monthly ×12 — over 12.
  // The division stays fractional; each contribution rounds once, half-even, to whole cents.
  let annualIncomeCents = new Decimal(0);
  for (const anchor of anchors) {
    if (anchor.expectedNetCents === null) continue;
    annualIncomeCents = annualIncomeCents.plus(
      new Decimal(anchor.expectedNetCents).times(anchor.cadence === "fortnightly" ? 26 : 12),
    );
  }
  const monthlyIncomeCents = annualIncomeCents.dividedBy(12);
  const contributionCents = (rateBps: number): number =>
    monthlyIncomeCents
      .times(rateBps)
      .dividedBy(10_000)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN)
      .toNumber();

  // `report.accounts` carries only open, viewer-visible accounts (the net-worth rules), so a
  // closed selected loan is simply absent — flat, exactly as it is absent from today's figure.
  let offsetPoolCents = 0;
  for (const a of report.accounts) {
    if (a.type === "offset") offsetPoolCents += a.balanceCents;
  }
  offsetPoolCents = Math.max(0, offsetPoolCents);

  const selected = new Map(assumptions.mortgages.map((m) => [m.accountId, m]));
  const loans = report.accounts
    .filter((a) => a.type === "home_loan")
    .map((a) => {
      const terms = selected.get(a.id);
      return {
        // Signed balances: a home loan owes its negated balance (0 or less).
        principalCents: -a.balanceCents,
        annualRatePercent: terms?.annualRatePercent ?? null,
        monthlyRepaymentCents: terms?.monthlyRepaymentCents ?? null,
        offsetCents: terms?.countOffset === true ? offsetPoolCents : 0,
      };
    });

  const startDate = ctx.clock.today();
  // Visible balances carry no sign CHECK: an overdrawn pot is floored at 0 (only the pot
  // compounds) and the negative excess folds into the flat deduction, so point 0 stays exactly
  // assets − Σ loan balances − cards.
  const assetsCents = Math.max(0, report.assetsCents);
  const creditCardCents = -report.subtotals.cardsCents + Math.max(0, -report.assetsCents);
  const monthlySavingsCents = contributionCents(assumptions.savingsRateBps);
  const monthlySuperCents = contributionCents(assumptions.superRateBps);

  const line = (returnBps: number) => {
    // bps → decimal-string percent at the boundary: 500 → "5", 617 → "6.17" (never a float).
    const annualReturnPercent = new Decimal(returnBps).dividedBy(100).toString();
    const projection = projectNetWorth({
      startDate,
      horizonYears,
      assetsCents,
      creditCardCents,
      loans,
      monthlySavingsCents,
      monthlySuperCents,
      annualReturnPercent,
    });
    return {
      returnBps,
      annualReturnPercent,
      points: projection.points.map((p) => ({
        month: p.month,
        date: p.date.toString(),
        netWorthCents: p.netWorthCents,
      })),
    };
  };

  return {
    asOf: report.asOf,
    horizonYears,
    lines: {
      low: line(assumptions.returnLowBps),
      mid: line(assumptions.returnMidBps),
      high: line(assumptions.returnHighBps),
    },
  };
}
