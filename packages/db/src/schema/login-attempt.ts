import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Password and TOTP login attempts per (lower-cased) email, for the lockout (story 1.5). Owned
 * by `identity`; the rows are themselves the log, so they are not audited. `ok` is 1 for an
 * attempt that ended in a session, 0 for a failure.
 */
export const loginAttempt = sqliteTable(
  "login_attempt",
  {
    id: integer("id").primaryKey(),
    email: text("email").notNull(),
    at: text("at").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
  },
  (t) => [index("login_attempt_email_at_idx").on(t.email, t.at)],
);
