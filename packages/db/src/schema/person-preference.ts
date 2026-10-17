import { sql } from "drizzle-orm";
import { check, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { person } from "./person.ts";

/** Each person's appearance preference (theme and mode). */
export const personPreference = sqliteTable(
  "person_preference",
  {
    personId: text("person_id")
      .primaryKey()
      .references(() => person.id),
    theme: text("theme").notNull().default("clay-linen"),
    mode: text("mode").notNull().default("system"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check(
      "person_preference_theme",
      sql`${t.theme} IN ('clay-linen', 'harbour-morning', 'fern-gully', 'galah-party', 'gelato-bar', 'black-opal')`,
    ),
    check("person_preference_mode", sql`${t.mode} IN ('light', 'dark', 'system')`),
  ],
);
