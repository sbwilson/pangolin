import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The result of a weekly repository check or monthly restore drill (story 1.14), owned by
 * `system`; every result is kept, so there is a history. `at` is `formatInstant` text, `ok` is 0
 * or 1, and `summary` says what was verified or which check failed.
 */
export const backupVerification = sqliteTable(
  "backup_verification",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    at: text("at").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    summary: text("summary").notNull(),
  },
  (t) => [
    index("backup_verification_kind_at_idx").on(t.kind, t.at),
    check("backup_verification_kind", sql`${t.kind} IN ('check', 'drill')`),
    check("backup_verification_ok", sql`${t.ok} IN (0, 1)`),
  ],
);
