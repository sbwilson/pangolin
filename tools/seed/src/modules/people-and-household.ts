// The first seed module: the two people of the household and its settings.
import type { SeedModule } from "../module.ts";
import type { HouseholdSettingsEvent, PersonCreatedEvent } from "../world.ts";

/** Stable keys later modules use to refer to each person (e.g. as account owners). */
export const PERSON_KEYS = ["person-a", "person-b"] as const;

const FIRST_NAMES = [
  "Alex",
  "Charlie",
  "Harper",
  "Jordan",
  "Kai",
  "Morgan",
  "Riley",
  "Sam",
  "Taylor",
  "Quinn",
] as const;

/** Distinct, readable on light and dark backgrounds. */
const COLOURS = ["#2563EB", "#DB2777", "#059669", "#D97706", "#7C3AED", "#0891B2"] as const;

const HOUSEHOLD: Omit<HouseholdSettingsEvent, "type"> = {
  timezone: "Australia/Sydney",
  baseCurrency: "AUD",
  sharedAttribution: "contribution",
};

/** Draws `count` distinct items, in draw order. */
function distinct<T>(items: readonly T[], count: number, pick: (list: readonly T[]) => T): T[] {
  const left = [...items];
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const item = pick(left);
    out.push(item);
    left.splice(left.indexOf(item), 1);
  }
  return out;
}

export const peopleAndHousehold: SeedModule = {
  name: "people-and-household",
  dependsOn: [],
  generate(_world, rng) {
    const names = distinct(FIRST_NAMES, PERSON_KEYS.length, (list) => rng.pick(list));
    const colours = distinct(COLOURS, PERSON_KEYS.length, (list) => rng.pick(list));
    const people: PersonCreatedEvent[] = PERSON_KEYS.map((key, i) => ({
      type: "person.created",
      key,
      displayName: names[i] as string,
      colour: colours[i] as string,
    }));
    return {
      events: [...people, { type: "household.settings", ...HOUSEHOLD }],
      expectations: {
        peopleCount: people.length,
        peopleNames: people.map((person) => person.displayName),
        peopleColours: people.map((person) => person.colour),
        timezone: HOUSEHOLD.timezone,
        baseCurrency: HOUSEHOLD.baseCurrency,
        sharedAttribution: HOUSEHOLD.sharedAttribution,
      },
    };
  },
};
