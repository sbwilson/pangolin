// The better-auth database adapter (story 1.5): better-auth's drizzle adapter over our own
// connection and our own table definitions, so its tables stay in our migrations (0003) and the
// drizzle table objects never leave this package (AD-3). better-auth never migrates by itself.
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { Db } from "./open.ts";
import {
  authAccount,
  authPasskey,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
} from "./schema/auth.ts";

/** Keyed by better-auth's model names; each column's property name is its field name. */
const authSchema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  twoFactor: authTwoFactor,
  passkey: authPasskey,
};

/**
 * The `database` option for `betterAuth`. Adapter transactions stay off: better-sqlite3 is
 * synchronous, and our unit of work opens its own transactions on the same connection from
 * better-auth's database hooks.
 */
export function createAuthAdapter(db: Db): ReturnType<typeof drizzleAdapter> {
  return drizzleAdapter(drizzle({ client: db }), {
    provider: "sqlite",
    schema: authSchema,
    transaction: false,
  });
}
