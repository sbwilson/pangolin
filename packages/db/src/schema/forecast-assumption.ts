// ForecastAssumption schemas (AD-22).
import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/**
 * Each person's editable forecast rates, held as integer basis points (0..10000) so they are
 * CHECK-able in SQLite and convert to `mortgageSchedule`'s decimal rates at 8.5's boundary.
 * Scoped to `person_id` (AD-22): only the person sees their own row. Nothing stored means
 * neutral zeros on read; the use case defaults, never this table.
 */
export const forecastAssumption = sqliteTable(
  "forecast_assumption",
  {
    personId: text("person_id")
      .primaryKey()
      .references(() => person.id),
    savingsRateBps: integer("savings_rate_bps").notNull().default(0),
    returnLowBps: integer("return_low_bps").notNull().default(0),
    returnMidBps: integer("return_mid_bps").notNull().default(0),
    returnHighBps: integer("return_high_bps").notNull().default(0),
    superRateBps: integer("super_rate_bps").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("forecast_assumption_savings_rate", sql`${t.savingsRateBps} BETWEEN 0 AND 10000`),
    check("forecast_assumption_return_low_rate", sql`${t.returnLowBps} BETWEEN 0 AND 10000`),
    check("forecast_assumption_return_mid_rate", sql`${t.returnMidBps} BETWEEN 0 AND 10000`),
    check("forecast_assumption_return_high_rate", sql`${t.returnHighBps} BETWEEN 0 AND 10000`),
    check("forecast_assumption_super_rate", sql`${t.superRateBps} BETWEEN 0 AND 10000`),
  ],
);

/**
 * A person's per-loan forecast selections, one relational row per loan (never a JSON blob):
 * a row present means that `home_loan` is paid down in the projection, and `count_offset`
 * says whether its offset balances are netted. Closed loans survive through the account's
 * `closedOn`, so these rows never dangle (AD-22: only the person sees them).
 */
export const forecastAssumptionMortgage = sqliteTable(
  "forecast_assumption_mortgage",
  {
    personId: text("person_id")
      .notNull()
      .references(() => person.id),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    countOffset: integer("count_offset", { mode: "boolean" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.accountId] }),
    check("forecast_assumption_mortgage_count_offset", sql`${t.countOffset} IN (0, 1)`),
  ],
);
