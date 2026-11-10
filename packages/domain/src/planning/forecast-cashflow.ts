// Pure cash-flow projection (AD-14, CAP forecast tracer). No I/O, no clock: the app supplies
// forecast movements and opening balances, this walks them day by day into per-account balance
// series and reports the first dip below each account's low-balance threshold.
import type { PlainDate } from "@pangolin/shared/temporal";
import { Temporal } from "@pangolin/shared/temporal";

/** One forecast movement on one day: positive in, negative out, in signed cents. */
export interface ForecastMovement {
  readonly date: PlainDate;
  readonly cents: number;
}

/** What the walk needs to know about one account. */
export interface ForecastAccountInput {
  readonly accountId: string;
  /** The balance on the day before `from` (or on `from` before that day's movements). */
  readonly openingCents: number;
  /** Warn when a projected balance is strictly below this. 0 means unset. */
  readonly thresholdCents: number;
  readonly movements: readonly ForecastMovement[];
}

export interface ForecastInput {
  /** The first projected day (inclusive). Usually the clock's today. */
  readonly from: PlainDate;
  /** The last projected day (inclusive). */
  readonly through: PlainDate;
  readonly accounts: readonly ForecastAccountInput[];
}

/** One day of an account's projected balance, after that day's movements. */
export interface ForecastPoint {
  readonly date: PlainDate;
  readonly balanceCents: number;
}

export interface ForecastAccountProjection {
  readonly accountId: string;
  readonly thresholdCents: number;
  readonly points: readonly ForecastPoint[];
}

/** The first day an account's projected balance fell strictly below its threshold. */
export interface ForecastDipWarning {
  readonly accountId: string;
  /** The projected balance on `date`, in signed cents. */
  readonly cents: number;
  readonly date: PlainDate;
}

export interface ForecastProjection {
  readonly accounts: readonly ForecastAccountProjection[];
  readonly warnings: readonly ForecastDipWarning[];
}

/**
 * Walks `from`..`through` (both inclusive) per account: balance starts at `openingCents`,
 * each day adds that day's movements (signed), and the first day whose balance is strictly
 * below the account's threshold becomes its warning — named once, with the projected cents.
 * Movements outside the window are ignored. A balance equal to the threshold is not a dip.
 */
export function projectCashFlow(input: ForecastInput): ForecastProjection {
  if (Temporal.PlainDate.compare(input.through, input.from) < 0) {
    throw new RangeError(
      `projectCashFlow: through (${input.through.toString()}) must not be before from (${input.from.toString()})`,
    );
  }

  const accounts: ForecastAccountProjection[] = [];
  const warnings: ForecastDipWarning[] = [];

  for (const account of input.accounts) {
    // Sum the account's movements per day once, so the walk is one comparison per day.
    const byDay = new Map<string, number>();
    for (const movement of account.movements) {
      if (
        Temporal.PlainDate.compare(movement.date, input.from) < 0 ||
        Temporal.PlainDate.compare(movement.date, input.through) > 0
      ) {
        continue;
      }
      const key = movement.date.toString();
      byDay.set(key, (byDay.get(key) ?? 0) + movement.cents);
    }

    const points: ForecastPoint[] = [];
    let balanceCents = account.openingCents;
    let dip: ForecastDipWarning | null = null;
    for (let day = input.from; Temporal.PlainDate.compare(day, input.through) <= 0; ) {
      balanceCents += byDay.get(day.toString()) ?? 0;
      points.push({ date: day, balanceCents });
      if (dip === null && balanceCents < account.thresholdCents) {
        dip = { accountId: account.accountId, cents: balanceCents, date: day };
      }
      day = day.add({ days: 1 });
    }

    accounts.push({
      accountId: account.accountId,
      thresholdCents: account.thresholdCents,
      points,
    });
    if (dip !== null) warnings.push(dip);
  }

  return { accounts, warnings };
}
