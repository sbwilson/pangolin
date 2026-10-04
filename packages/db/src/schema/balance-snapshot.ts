import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";

/** A balance of an account on one day, from a statement, a connector or typed in. */
export const balanceSnapshot = sqliteTable(
  "balance_snapshot",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    asOf: text("as_of").notNull(),
    balanceCents: integer("balance_cents").notNull(),
    source: text("source").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("balance_snapshot_account_as_of_idx").on(t.accountId, t.asOf),
    check("balance_snapshot_source", sql`${t.source} IN ('statement', 'api', 'manual')`),
    check(
      "balance_snapshot_as_of",
      sql`${t.asOf} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
