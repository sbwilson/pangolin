import { parseDate } from "@pangolin/shared/temporal";
import { describe, expect, it } from "vitest";
import { rngFor } from "../rng.ts";
import { runSeed } from "../run.ts";
import { emptyWorld } from "../world.ts";
import { PERSON_KEYS, peopleAndHousehold } from "./people-and-household.ts";

const world = emptyWorld("pangolin-v1", parseDate("2026-07-15"));

describe("people-and-household", () => {
  it("emits two people with distinct names and #RRGGBB colours, then the settings", () => {
    const { events } = peopleAndHousehold.generate(
      world,
      rngFor("pangolin-v1", "people-and-household"),
    );
    const people = events.filter((e) => e.type === "person.created");
    expect(people.map((p) => p.key)).toEqual([...PERSON_KEYS]);
    expect(new Set(people.map((p) => p.displayName)).size).toBe(2);
    expect(new Set(people.map((p) => p.colour)).size).toBe(2);
    for (const p of people) expect(p.colour).toMatch(/^#[0-9A-F]{6}$/);
    expect(events.at(-1)).toEqual({
      type: "household.settings",
      timezone: "Australia/Sydney",
      baseCurrency: "AUD",
      sharedAttribution: "contribution",
    });
  });

  it("states its expectations from its own events", () => {
    const out = runSeed({ modules: [peopleAndHousehold] });
    const people = out.events.filter((e) => e.type === "person.created");
    expect(out.expectations).toEqual({
      "people-and-household.peopleCount": 2,
      "people-and-household.peopleNames": people.map((p) => p.displayName),
      "people-and-household.peopleColours": people.map((p) => p.colour),
      "people-and-household.timezone": "Australia/Sydney",
      "people-and-household.baseCurrency": "AUD",
      "people-and-household.sharedAttribution": "contribution",
    });
  });

  it("depends on nothing", () => {
    expect(peopleAndHousehold.dependsOn).toEqual([]);
  });
});
