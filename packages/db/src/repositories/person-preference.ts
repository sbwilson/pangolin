import type { PersonPreferenceRepo, PersonPreferenceRow } from "@pangolin/app";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { personPreference } from "../schema/person-preference.ts";

type Orm = BetterSQLite3Database;

export function createPersonPreferenceRepo(orm: Orm, check: () => void): PersonPreferenceRepo {
  return {
    get: (personId) => {
      check();
      const row = orm
        .select()
        .from(personPreference)
        .where(eq(personPreference.personId, personId))
        .get();
      return row as PersonPreferenceRow | undefined;
    },
    upsert: (row) => {
      check();
      orm
        .insert(personPreference)
        .values(row)
        .onConflictDoUpdate({
          target: personPreference.personId,
          set: {
            theme: row.theme,
            mode: row.mode,
            updatedAt: row.updatedAt,
          },
        })
        .run();
      const result = orm
        .select()
        .from(personPreference)
        .where(eq(personPreference.personId, row.personId))
        .get();
      if (result === undefined) {
        throw new Error(`Failed to upsert person_preference for ${row.personId}`);
      }
      return result as PersonPreferenceRow;
    },
    deleteForPerson: (personId) => {
      check();
      orm.delete(personPreference).where(eq(personPreference.personId, personId)).run();
    },
  };
}
