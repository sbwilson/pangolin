import { customType, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * better-auth's tables (story 1.5), owned by `identity` and written only by better-auth through
 * the drizzle adapter in `auth-adapter.ts`. The keys of the exported object in that file are
 * better-auth's model names, and each column's property name is better-auth's field name, so
 * better-auth needs no field mapping; the SQL names follow our snake_case convention.
 *
 * The tables carry an `auth_` prefix so they never collide with our own tables (epic 2 adds the
 * ledger's `account`). better-auth never migrates them: they come from migration 0003.
 *
 * better-auth hands the adapter `Date` objects; they are stored as UTC ISO-8601 text like every
 * other timestamp here, so text order is time order.
 */
const isoTimestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value),
});

export const authUser = sqliteTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }),
  createdAt: isoTimestamp("created_at").notNull(),
  updatedAt: isoTimestamp("updated_at").notNull(),
});

export const authSession = sqliteTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: isoTimestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: isoTimestamp("created_at").notNull(),
    updatedAt: isoTimestamp("updated_at").notNull(),
  },
  (t) => [index("auth_session_user_id_idx").on(t.userId)],
);

export const authAccount = sqliteTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: isoTimestamp("access_token_expires_at"),
    refreshTokenExpiresAt: isoTimestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: isoTimestamp("created_at").notNull(),
    updatedAt: isoTimestamp("updated_at").notNull(),
  },
  (t) => [index("auth_account_user_id_idx").on(t.userId)],
);

export const authVerification = sqliteTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: isoTimestamp("expires_at").notNull(),
    createdAt: isoTimestamp("created_at").notNull(),
    updatedAt: isoTimestamp("updated_at").notNull(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

/** The `twoFactor` plugin: one TOTP secret (encrypted by better-auth) per user. */
export const authTwoFactor = sqliteTable(
  "auth_two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: integer("verified", { mode: "boolean" }),
    failedVerificationCount: integer("failed_verification_count"),
    lockedUntil: isoTimestamp("locked_until"),
  },
  (t) => [
    index("auth_two_factor_secret_idx").on(t.secret),
    index("auth_two_factor_user_id_idx").on(t.userId),
  ],
);

/** The `@better-auth/passkey` plugin: one row per WebAuthn credential. */
export const authPasskey = sqliteTable(
  "auth_passkey",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
    transports: text("transports"),
    aaguid: text("aaguid"),
    createdAt: isoTimestamp("created_at"),
  },
  (t) => [
    index("auth_passkey_user_id_idx").on(t.userId),
    index("auth_passkey_credential_id_idx").on(t.credentialID),
  ],
);
