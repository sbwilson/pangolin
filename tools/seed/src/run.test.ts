import { describe, expect, it } from "vitest";
import type { SeedModule } from "./module.ts";
import { defaultModules } from "./modules/index.ts";
import { peopleAndHousehold } from "./modules/people-and-household.ts";
import { DEFAULT_SEED, DEFAULT_TODAY, orderModules, runSeed } from "./run.ts";
import { serialize } from "./serialize.ts";
import type { SeedEvent, World } from "./world.ts";

function stub(name: string, dependsOn: string[] = [], seen?: World[]): SeedModule {
  return {
    name,
    dependsOn,
    generate(world, rng) {
      seen?.push(world);
      return {
        events: [
          {
            type: "person.created",
            key: `${name}-${rng.int(0, 1_000_000)}`,
            displayName: name,
            colour: "#000000",
          },
        ],
        expectations: { draw: rng.next() },
      };
    },
  };
}

describe("orderModules", () => {
  it("runs dependencies first and breaks ties by name", () => {
    const modules = [stub("c", ["b"]), stub("b"), stub("a"), stub("d", ["a"])];
    expect(orderModules(modules).map((m) => m.name)).toEqual(["a", "b", "c", "d"]);
    const later = [stub("z"), stub("a", ["z"])];
    expect(orderModules(later).map((m) => m.name)).toEqual(["z", "a"]);
  });

  it("throws naming a module with an unknown dependency", () => {
    expect(() => orderModules([stub("a", ["ghost"])])).toThrow(
      'Seed module "a" depends on unknown module "ghost"',
    );
  });

  it("throws naming the modules in a cycle", () => {
    expect(() => orderModules([stub("a", ["b"]), stub("b", ["a"]), stub("c")])).toThrow(
      "Seed modules have a dependency cycle: a, b",
    );
  });

  it("rejects duplicate and invalid names", () => {
    expect(() => orderModules([stub("a"), stub("a")])).toThrow('"a" is listed twice');
    expect(() => orderModules([stub("Not Valid")])).toThrow("lowercase letters");
  });
});

describe("runSeed", () => {
  it("defaults to seed pangolin-v1 and today 2026-07-15", () => {
    const out = runSeed({ modules: [] });
    expect([out.seed, out.today]).toEqual([DEFAULT_SEED, DEFAULT_TODAY]);
    expect(DEFAULT_SEED).toBe("pangolin-v1");
    expect(DEFAULT_TODAY).toBe("2026-07-15");
  });

  it("is byte-identical across runs", () => {
    const a = serialize(runSeed({ modules: defaultModules }));
    const b = serialize(runSeed({ modules: defaultModules }));
    expect(a).toBe(b);
  });

  it("stamps every event with its module and prefixes expectation keys", () => {
    const out = runSeed({ modules: [stub("dummy"), peopleAndHousehold] });
    for (const event of out.events)
      expect(["dummy", "people-and-household"]).toContain(event.module);
    for (const key of Object.keys(out.expectations)) {
      expect(key).toMatch(/^(dummy|people-and-household)\./);
    }
  });

  it("leaves a module's output unchanged when an unrelated module is added", () => {
    const own = (modules: SeedModule[]) => {
      const out = runSeed({ modules });
      return {
        events: out.events.filter((e) => e.module === "people-and-household"),
        expectations: Object.entries(out.expectations).filter(([k]) =>
          k.startsWith("people-and-household."),
        ),
      };
    };
    const alone = own([peopleAndHousehold]);
    // "aaa" sorts first and draws from the stream before people-and-household runs.
    expect(own([peopleAndHousehold, stub("aaa"), stub("zzz")])).toEqual(alone);
    expect(own([stub("aaa"), peopleAndHousehold])).toEqual(alone);
    expect(alone.events.length).toBeGreaterThan(0);
  });

  it("gives each module a world with only its dependencies' events", () => {
    const seen: World[] = [];
    runSeed({
      modules: [
        peopleAndHousehold,
        stub("aaa"),
        stub("uses-people", ["people-and-household"], seen),
      ],
    });
    const [world] = seen;
    expect(world?.people.map((p) => p.key)).toEqual(["person-a", "person-b"]);
    expect(world?.household?.timezone).toBe("Australia/Sydney");
    expect(world?.today.toString()).toBe("2026-07-15");
  });

  it("changes the output with the seed and validates today", () => {
    const a = runSeed({ modules: defaultModules });
    const b = runSeed({ seed: "other", modules: defaultModules });
    expect(serialize(a)).not.toBe(serialize(b));
    expect(() => runSeed({ today: "2026-02-30", modules: [] })).toThrow(RangeError);
    expect(() => runSeed({ seed: "", modules: [] })).toThrow("must not be empty");
  });

  it("rejects a module whose events contradict the world", () => {
    const twice: SeedModule = {
      name: "twice",
      dependsOn: [],
      generate: () => ({
        events: [
          { type: "person.created", key: "x", displayName: "X", colour: "#000000" },
          { type: "person.created", key: "x", displayName: "X", colour: "#000000" },
        ],
        expectations: {},
      }),
    };
    expect(() => runSeed({ modules: [twice] })).toThrow('person key "x" is used twice');
  });

  it("rejects two unrelated modules creating the same person key, naming both", () => {
    const person = (name: string): SeedModule => ({
      name,
      dependsOn: [],
      generate: () => ({
        events: [{ type: "person.created", key: "person-a", displayName: "X", colour: "#000000" }],
        expectations: {},
      }),
    });
    expect(() => runSeed({ modules: [peopleAndHousehold, person("other")] })).toThrow(
      'Seed modules "other" and "people-and-household" both create person "person-a"',
    );
  });

  describe("keys across unrelated modules", () => {
    const emits = (name: string, events: SeedEvent[]): SeedModule => ({
      name,
      dependsOn: [],
      generate: () => ({ events, expectations: {} }),
    });
    const institution = (key: string): SeedEvent => ({
      type: "institution.created",
      key,
      name: "Bank",
      kind: "bank",
    });
    const tag = (key: string): SeedEvent => ({ type: "tag.created", key, name: "T", origin: null });
    const payee = (key: string): SeedEvent => ({
      type: "payee.created",
      key,
      name: "P",
      websiteUrl: null,
      defaultCategory: null,
      origin: null,
    });
    /** A module with its own person and account, so only the transaction key can clash. */
    const withTransaction = (name: string, key: string): SeedModule =>
      emits(name, [
        { type: "person.created", key: `${name}-person`, displayName: "X", colour: "#000000" },
        {
          type: "account.created",
          key: `${name}-account`,
          name: "A",
          accountType: "transaction",
          currency: "AUD",
          isPrivate: false,
          owners: [{ person: `${name}-person`, shareBp: 10000 }],
          institution: null,
          isSavings: false,
        },
        {
          type: "transaction.created",
          key,
          account: `${name}-account`,
          postedOn: "2026-01-01",
          amountCents: -100,
          description: "x",
        },
      ]);

    it.each([
      ["institution", (n: string) => emits(n, [institution("shared-key")])],
      ["tag", (n: string) => emits(n, [tag("shared-key")])],
      ["payee", (n: string) => emits(n, [payee("shared-key")])],
      ["transaction", (n: string) => withTransaction(n, "shared-key")],
    ])("rejects two modules creating the same %s key, naming both", (what, make) => {
      expect(() => runSeed({ modules: [make("alpha"), make("beta")] })).toThrow(
        `Seed modules "alpha" and "beta" both create ${what} "shared-key"`,
      );
    });

    it("keeps each kind of key in its own namespace", () => {
      const out = runSeed({
        modules: [
          emits("alpha", [institution("k"), tag("k")]),
          emits("beta", [payee("k")]),
          withTransaction("gamma", "k"),
        ],
      });
      expect(out.events).toHaveLength(6);
    });
  });

  it("rejects two modules setting the household settings, naming both", () => {
    const settings: SeedModule = {
      name: "more-settings",
      dependsOn: [],
      generate: () => ({
        events: [
          {
            type: "household.settings",
            timezone: "UTC",
            baseCurrency: "AUD",
            sharedAttribution: "even",
          },
        ],
        expectations: {},
      }),
    };
    expect(() => runSeed({ modules: [peopleAndHousehold, settings] })).toThrow(
      'Seed modules "more-settings" and "people-and-household" both set the household settings',
    );
  });

  it("never reads the clock or Math.random", () => {
    const random = Math.random;
    const now = Date.now;
    Math.random = () => {
      throw new Error("Math.random read");
    };
    Date.now = () => {
      throw new Error("Date.now read");
    };
    try {
      runSeed({ modules: defaultModules });
    } finally {
      Math.random = random;
      Date.now = now;
    }
  });
});
