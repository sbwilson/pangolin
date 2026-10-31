// PayAnchor schema (AD-14, AD-22, AD-25).
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/**
 * Each person's pay cadence, deposit account, expected net and gross pay.
 * Scoped to `person_id` (AD-22).
 */
export const payAnchor = sqliteTable(
  "pay_anchor",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .unique()
      .references(() => person.id),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    cadence: text("cadence", { enum: ["fortnightly", "monthly"] }).notNull(),
    dayOfMonth: integer("day_of_month"),
    anchorDate: text("anchor_date"),
    alignment: text("alignment", { enum: ["calendar", "deposit"] })
      .notNull()
      .default("calendar"),
    expectedNetCents: integer("expected_net_cents"),
    expectedGrossCents: integer("expected_gross_cents"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("pay_anchor_cadence", sql`${t.cadence} IN ('fortnightly', 'monthly')`),
    check("pay_anchor_alignment", sql`${t.alignment} IN ('calendar', 'deposit')`),
    check(
      "pay_anchor_cadence_fields",
      sql`(${t.cadence} = 'fortnightly' AND ${t.anchorDate} IS NOT NULL) OR (${t.cadence} = 'monthly' AND ${t.dayOfMonth} IS NOT NULL AND ${t.dayOfMonth} BETWEEN 1 AND 31)`,
    ),
  ],
);
