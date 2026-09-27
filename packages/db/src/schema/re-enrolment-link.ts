import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { person } from "./person.ts";

/**
 * Partner-assisted re-enrolment links (story 1.6), owned by `identity`. Only the SHA-256 of the
 * token is stored. `issued_by` is `person:<id>` (the partner) or `cli:reset-user`. A link is live
 * while `used_at` is NULL and `expires_at` (24 h after `created_at`) is in the future; issuing a
 * new link for a person ends their earlier live ones by setting `expires_at`.
 */
export const reEnrolmentLink = sqliteTable(
  "re_enrolment_link",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => person.id),
    issuedBy: text("issued_by").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [
    index("re_enrolment_link_person_idx").on(t.personId),
    check(
      "re_enrolment_link_issued_by",
      sql`${t.issuedBy} = 'cli:reset-user' OR ${t.issuedBy} LIKE 'person:%'`,
    ),
  ],
);
