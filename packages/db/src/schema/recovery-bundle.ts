import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Which recovery bundle the household confirmed it stored safely (story 1.17, AD-27), owned by
 * `system`: at most one row, `id` = 1, absent until the first confirmation. Only the bundle's id
 * (from `PANGOLIN_RECOVERY_BUNDLE_ID`) is kept, never a secret. `confirmed_at` is
 * `formatInstant` text.
 */
export const recoveryBundle = sqliteTable(
  "recovery_bundle",
  {
    id: integer("id").primaryKey(),
    bundleId: text("bundle_id").notNull(),
    confirmedAt: text("confirmed_at").notNull(),
  },
  (t) => [check("recovery_bundle_singleton", sql`${t.id} = 1`)],
);
