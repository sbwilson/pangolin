// Test support only: people with a login, written straight into a test database as better-auth
// and `identity.completeSignUp` would leave them (a password account and an open session).
import type { Db } from "@pangolin/db";

const AT = "2026-09-27T00:00:00.000Z";

let n = 0;

/** Adds a login `email` with a password and one session, linked to a new person; returns its ID. */
export function addLogin(db: Db, email: string, displayName: string): string {
  n++;
  const userId = `user-${n}-${email}`;
  const personId = `01J0000000000000000000${String(n).padStart(4, "0")}`;
  db.prepare(
    `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, ?)`,
  ).run(userId, displayName, email, AT, AT);
  db.prepare(
    `INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES (?, ?, ?, 'credential', 'old-hash', ?, ?)`,
  ).run(`account-${userId}`, userId, userId, AT, AT);
  db.prepare(
    `INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, '2999-01-01T00:00:00.000Z', ?, ?)`,
  ).run(`session-${userId}`, userId, `token-${userId}`, AT, AT);
  db.prepare(
    `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
     VALUES (?, ?, ?, '#336699', ?, ?)`,
  ).run(personId, userId, displayName, `${AT.slice(0, 20)}${String(n).padStart(3, "0")}Z`, AT);
  return personId;
}

/** The login's password hash and open sessions, to check a reset cleared them. */
export function signIn(db: Db, email: string): { password: string; sessions: number } {
  const row = db
    .prepare(
      `SELECT a.password AS password,
              (SELECT count(*) FROM auth_session s WHERE s.user_id = u.id) AS sessions
       FROM auth_user u JOIN auth_account a ON a.user_id = u.id WHERE u.email = ?`,
    )
    .get(email) as { password: string; sessions: number };
  return row;
}
