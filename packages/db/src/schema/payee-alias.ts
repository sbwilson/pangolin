import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { account } from "./account.ts";
import { payee } from "./payee.ts";
import { person } from "./person.ts";

/**
 * A raw-description pattern that maps to a payee. Scope as on `payee` (AD-18); a live
 * `(match_kind, pattern)` is unique per scope.
 */
export const payeeAlias = sqliteTable(
  "payee_alias",
  {
    id: text("id").primaryKey(),
    pattern: text("pattern").notNull(),
    matchKind: text("match_kind").notNull(),
    payeeId: text("payee_id")
      .notNull()
      .references(() => payee.id),
    scopePersonId: text("scope_person_id").references(() => person.id),
    originAccountId: text("origin_account_id").references(() => account.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("payee_alias_pattern_shared_idx")
      .on(t.matchKind, t.pattern)
      .where(sql`scope_person_id IS NULL AND deleted_at IS NULL`),
    uniqueIndex("payee_alias_pattern_scoped_idx")
      .on(t.scopePersonId, t.matchKind, t.pattern)
      .where(sql`scope_person_id IS NOT NULL AND deleted_at IS NULL`),
    index("payee_alias_payee_idx").on(t.payeeId),
    check(
      "payee_alias_match_kind",
      sql`${t.matchKind} IN ('exact', 'contains', 'prefix', 'regex')`,
    ),
  ],
);
