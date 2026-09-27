import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One-time sign-up links (story 1.5), owned by `identity`. Only the SHA-256 of the token is
 * stored. `issued_by` is `cli` (the server at first boot, or the admin CLI later) or
 * `person:<id>` (a partner invite). A link is live while `used_at` is NULL and `expires_at`
 * (24 h after `created_at`) is in the future.
 */
export const setupLink = sqliteTable(
  "setup_link",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    issuedBy: text("issued_by").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [
    check("setup_link_issued_by", sql`${t.issuedBy} = 'cli' OR ${t.issuedBy} LIKE 'person:%'`),
  ],
);
