import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { person } from "./person.ts";

/** Who owns an account and in what share (`share_bp`: basis points, 5000 = 50%). */
export const accountOwner = sqliteTable(
  "account_owner",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => account.id),
    personId: text("person_id")
      .notNull()
      .references(() => person.id),
    shareBp: integer("share_bp").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.personId] }),
    index("account_owner_person_idx").on(t.personId),
    check("account_owner_share_bp", sql`${t.shareBp} BETWEEN 1 AND 10000`),
  ],
);
