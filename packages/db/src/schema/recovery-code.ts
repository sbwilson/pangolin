import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { person } from "./person.ts";

/**
 * One-time recovery codes (story 1.6), owned by `identity`. Each person has up to 10; only the
 * SHA-256 of the normalised code is stored. A code is unused while `used_at` is NULL.
 * Regenerating deletes the unused codes and inserts a new set; a partner-assisted reset deletes
 * them all.
 */
export const recoveryCode = sqliteTable(
  "recovery_code",
  {
    id: text("id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => person.id),
    codeHash: text("code_hash").notNull(),
    createdAt: text("created_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [index("recovery_code_person_hash_idx").on(t.personId, t.codeHash)],
);
