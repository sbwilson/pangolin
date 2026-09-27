import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Household-wide configuration: always exactly one row, `id` = 1, inserted by migration 0001
 * with the defaults (AUD, 07-01, Australia/Sydney, contribution).
 */
export const householdSettings = sqliteTable(
  "household_settings",
  {
    id: integer("id").primaryKey(),
    baseCurrency: text("base_currency").notNull(),
    fyStart: text("fy_start").notNull(),
    timezone: text("timezone").notNull(),
    sharedAttribution: text("shared_attribution", { enum: ["contribution", "even"] }).notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("household_settings_singleton", sql`${t.id} = 1`),
    check(
      "household_settings_shared_attribution",
      sql`${t.sharedAttribution} IN ('contribution', 'even')`,
    ),
  ],
);
