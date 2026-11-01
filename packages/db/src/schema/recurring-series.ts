// RecurringSeries schema (AD-3, AD-10, AD-25, CAP-5).
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { payee } from "./payee.ts";

/**
 * Recurring series table for detected, confirmed, or rejected recurring bills (or income).
 * Account-scoped privacy (AD-3).
 * Direction: 'bill' | 'income' (salary deposits are never recurring series, AD-25).
 * Cadence: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annual'.
 * Status: 'candidate' | 'confirmed' | 'rejected'.
 */
export const recurringSeries = sqliteTable(
  "recurring_series",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    payeeId: text("payee_id")
      .notNull()
      .references(() => payee.id),
    direction: text("direction", { enum: ["bill", "income"] }).notNull(),
    cadence: text("cadence", {
      enum: ["weekly", "fortnightly", "monthly", "quarterly", "annual"],
    }).notNull(),
    expectedCents: integer("expected_cents").notNull(),
    toleranceBp: integer("tolerance_bp").notNull().default(1500),
    nextDueOn: text("next_due_on").notNull(),
    status: text("status", { enum: ["candidate", "confirmed", "rejected"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("recurring_series_account_idx").on(t.accountId),
    index("recurring_series_payee_idx").on(t.payeeId),
    index("recurring_series_status_idx").on(t.status),
    check("recurring_series_direction", sql`${t.direction} IN ('bill', 'income')`),
    check(
      "recurring_series_cadence",
      sql`${t.cadence} IN ('weekly', 'fortnightly', 'monthly', 'quarterly', 'annual')`,
    ),
    check("recurring_series_expected_cents", sql`${t.expectedCents} > 0`),
    check("recurring_series_tolerance_bp", sql`${t.toleranceBp} >= 0`),
    check("recurring_series_status", sql`${t.status} IN ('candidate', 'confirmed', 'rejected')`),
  ],
);
