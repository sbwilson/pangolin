import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  balanceAsOf,
  createIdGenerator,
  fixedClockAt,
  listAllTransactions,
  listPayees,
  listTags,
  personViewer,
  systemClock,
} from "@pangolin/app";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { type AdminDeps, SEED_DISABLED, seedCommand } from "./commands.ts";
import { applySeed, linkSeed, parseSeed, seedClassifyDefaults } from "./seed.ts";

let seedDir: string;
let seedJson: string;
interface SeedEventShape {
  type: string;
  key?: string;
  displayName?: string;
  colour?: string;
  account?: string;
  isPrivate?: boolean;
  owners?: { person: string }[];
  postedOn?: string;
  amountCents?: number;
  description?: string;
  splits?: { amountCents: number; beneficiary?: string }[];
  transaction?: string;
  transactions?: string[];
  by?: string;
  [field: string]: unknown;
}
let seed: {
  events: SeedEventShape[];
  expectations: Record<string, unknown>;
};

beforeAll(() => {
  seedDir = mkdtempSync(join(tmpdir(), "pangolin-seed-apply-"));
  const file = join(seedDir, "seed.json");
  generateSeedFile(file);
  seedJson = readFileSync(file, "utf8");
  seed = JSON.parse(seedJson);
});

afterAll(() => {
  rmSync(seedDir, { recursive: true, force: true });
});

let db: Db;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
});

const deps = () => ({ clock: systemClock("UTC"), newId: createIdGenerator() });
const expected = (key: string) => seed.expectations[`people-and-household.${key}`];
const ex = (key: string) => seed.expectations[key];
const eventsOf = (type: string) => seed.events.filter((e) => e.type === type);
const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();

function withEvents(events: unknown[]): string {
  return JSON.stringify({ ...seed, events });
}

function rejection(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

describe("applySeed", () => {
  it("applies the default seed: people and settings match its expectations", () => {
    const result = applySeed(createUnitOfWork(db), deps(), seedJson);

    const people = db.prepare("SELECT id, display_name, colour FROM person ORDER BY id").all() as {
      id: string;
      display_name: string;
      colour: string;
    }[];
    expect(people).toHaveLength(expected("peopleCount") as number);
    expect(people.map((p) => p.display_name)).toEqual(expected("peopleNames"));
    expect(people.map((p) => p.colour)).toEqual(expected("peopleColours"));
    expect(Object.values(result.people).sort()).toEqual(people.map((p) => p.id).sort());

    const settings = db.prepare("SELECT * FROM household_settings").get() as Record<
      string,
      unknown
    >;
    expect(settings).toMatchObject({
      timezone: expected("timezone"),
      base_currency: expected("baseCurrency"),
      shared_attribution: expected("sharedAttribution"),
    });
    expect(result).toMatchObject({ seed: "pangolin-v1", today: "2026-07-15" });
  });

  it("seeds the default categories, once", () => {
    applySeed(createUnitOfWork(db), deps(), seedJson);
    expect(count("category_group")).toBe(13);
    expect(count("tax_category")).toBe(8);
    const categories = count("category");
    expect(categories).toBeGreaterThan(0);
    const audits = count("audit_log");
    expect(seedClassifyDefaults(createUnitOfWork(db), deps())).toBe(false);
    expect(count("category_group")).toBe(13);
    expect(count("category")).toBe(categories);
    expect(count("audit_log")).toBe(audits);
    expect(
      db.prepare("SELECT count(*) FROM audit_log WHERE actor = 'job:seed-defaults'").pluck().get(),
    ).toBe((categories as number) + 13 + 8);
  });

  it("audits every write as cli:seed, except hidden names and transfers, which are the owner's", () => {
    const result = applySeed(createUnitOfWork(db), deps(), seedJson);
    // The default categories are seeded first, as `job:seed-defaults` (story 2.5).
    const audit = db
      .prepare("SELECT actor, entity, action FROM audit_log WHERE actor <> 'job:seed-defaults'")
      .all() as { actor: string; entity: string; action: string }[];
    const people = new Set(Object.values(result.people).map((id) => `person:${id}`));
    const asPerson = audit.filter((row) => people.has(row.actor));
    // One update per hidden name and two per transfer group: the use cases need a person.
    expect(asPerson).toHaveLength(
      eventsOf("transaction.name-hidden").length + 2 * eventsOf("transfer.grouped").length,
    );
    for (const row of asPerson)
      expect(row).toMatchObject({ entity: "transaction", action: "update" });
    for (const row of audit.filter((r) => !people.has(r.actor))) expect(row.actor).toBe("cli:seed");
    const entities = (entity: string) => audit.filter((row) => row.entity === entity);
    expect(entities("person")).toHaveLength(count("person") as number);
    expect(entities("account")).toHaveLength(count("account") as number);
    expect(entities("institution")).toHaveLength(count("institution") as number);
    expect(entities("balance_snapshot")).toHaveLength(count("balance_snapshot") as number);
    expect(entities("tag")).toHaveLength(count("tag") as number);
    expect(entities("payee")).toHaveLength(count("payee") as number);
    expect(entities("transaction").filter((r) => r.action === "create")).toHaveLength(
      count('"transaction"') as number,
    );
  });

  it("loads the seed's institutions, accounts, classification, transactions and balances", () => {
    const result = applySeed(createUnitOfWork(db), deps(), seedJson);
    expect(count("institution")).toBe(ex("institutions-and-accounts.institutionCount"));
    expect(count("account")).toBe((ex("institutions-and-accounts.accountKeys") as string[]).length);
    expect(count("tag")).toBe(ex("classification.tagCount"));
    expect(count("payee")).toBe(ex("classification.payeeCount"));
    expect(count('"transaction"')).toBe(ex("transfers-and-privacy.transactionCount"));
    expect(count("balance_snapshot")).toBe(ex("balance-snapshots.snapshotCount"));
    expect(result).toMatchObject({
      accounts: count("account"),
      transactions: count('"transaction"'),
    });
    expect(db.prepare("SELECT DISTINCT type FROM account ORDER BY type").pluck().all()).toEqual([
      "credit_card",
      "home_loan",
      "offset",
      "savings",
      "transaction",
    ]);
  });

  it("applies the accounts: shared with the 50/50 and 6000/4000 owners, one private per person", () => {
    applySeed(createUnitOfWork(db), deps(), seedJson);
    const rows = db
      .prepare(
        `SELECT a.name, a.is_private, group_concat(o.share_bp ORDER BY o.created_at, o.person_id) AS shares, count(*) AS n
         FROM account a JOIN account_owner o ON o.account_id = a.id GROUP BY a.id ORDER BY a.name`,
      )
      .all() as { name: string; is_private: number; shares: string; n: number }[];
    const byName = new Map(rows.map((r) => [r.name, r]));
    const shares = (name: string) => byName.get(name)?.shares.split(",").sort();
    expect(shares("Joint everyday")).toEqual(["5000", "5000"]);
    expect(shares("Joint savings")).toEqual(["4000", "6000"]);
    expect(rows.filter((r) => r.is_private === 1).map((r) => [r.name, r.n])).toEqual([
      ["Person A private", 1],
      ["Person B private", 1],
    ]);
    expect(rows.every((r) => r.is_private === 1 || r.n === 2)).toBe(true);
  });

  it("audits a settings change too", () => {
    const events = seed.events.map((e) =>
      e.type === "household.settings" ? { ...e, timezone: "Australia/Perth" } : e,
    );
    applySeed(createUnitOfWork(db), deps(), withEvents(events));
    const rows = db
      .prepare("SELECT actor FROM audit_log WHERE entity = 'household_settings'")
      .all();
    expect(rows).toEqual([{ actor: "cli:seed" }]);
    expect(db.prepare("SELECT timezone FROM household_settings").pluck().get()).toBe(
      "Australia/Perth",
    );
  });

  it.each([
    ["malformed JSON", "{ not json", /not valid JSON/],
    [
      "a missing field",
      JSON.stringify({ seed: "s", today: "2026-07-15", events: [] }),
      /expectations/,
    ],
    [
      "a bad today",
      JSON.stringify({ ...{ seed: "s", events: [], expectations: {} }, today: "15/07/2026" }),
      /today: Expected YYYY-MM-DD/,
    ],
    [
      "a today that does not exist",
      JSON.stringify({ seed: "s", today: "2026-02-30", events: [], expectations: {} }),
      /today: Expected a real calendar date/,
    ],
  ])("rejects %s before writing anything", (_name, text, message) => {
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), text));
    expect(error.code).toBe("Validation");
    expect(error.message).toMatch(message);
    expect([count("person"), count("audit_log")]).toEqual([0, 0]);
  });

  it("rejects an unknown event type, naming it, after valid events and before any write", () => {
    const events = [...seed.events, { type: "budget.created", module: "budgets", key: "x" }];
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), withEvents(events)));
    expect(error.message).toContain(
      `events.${seed.events.length}: unknown event type "budget.created"`,
    );
    expect([count("person"), count("audit_log")]).toEqual([0, 0]);
  });

  it("rejects an event the use case would reject, and a reused person key", () => {
    const [first] = seed.events;
    const events = [first, { ...first, colour: "red" }, first];
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), withEvents(events)));
    expect(error.message).toContain("events.1.colour: Expected a #RRGGBB colour");
    expect(error.message).toContain('events.2: person key "person-a" is used twice');
    expect(count("person")).toBe(0);
  });

  it("rejects unknown fields on an event", () => {
    const [first] = seed.events;
    expect(() => parseSeed(withEvents([{ ...first, extra: 1 }]))).toThrow(/events\.0/);
  });
});

describe("parseSeed references", () => {
  const first = <T extends SeedEventShape>(type: string): T => {
    const found = seed.events.find((e) => e.type === type);
    if (found === undefined) throw new Error(`no ${type}`);
    return structuredClone(found) as T;
  };
  /** The seed with `change` applied to a copy of its events. */
  const changed = (change: (events: SeedEventShape[]) => void): string => {
    const events = structuredClone(seed.events);
    change(events);
    return withEvents(events);
  };
  const indexOf = (predicate: (e: SeedEventShape) => boolean) => seed.events.findIndex(predicate);
  const reject = (json: string, message: RegExp) => {
    const error = rejection(() => applySeed(createUnitOfWork(db), deps(), json));
    expect(error.code).toBe("Validation");
    expect(error.message).toMatch(message);
    // Rejected before the first write: not even the people exist.
    expect([count("person"), count("audit_log"), count("category_group")]).toEqual([0, 0, 0]);
  };

  it("accepts the seed itself", () => {
    expect(parseSeed(seedJson).events).toHaveLength(seed.events.length);
  });

  it("rejects an account at an unknown institution", () => {
    reject(
      changed((events) => {
        const at = indexOf((e) => e.type === "account.created");
        (events[at] as SeedEventShape).institution = "nowhere";
      }),
      /unknown institution "nowhere"/,
    );
  });

  it("rejects a transaction in an unknown account, with an unknown payee or tag", () => {
    const at = indexOf((e) => e.type === "transaction.created" && e.category !== undefined);
    reject(
      changed((e) => {
        (e[at] as SeedEventShape).account = "no-such-account";
      }),
      /unknown account "no-such-account"/,
    );
    reject(
      changed((e) => {
        (e[at] as SeedEventShape).payee = "no-such-payee";
      }),
      /unknown payee "no-such-payee"/,
    );
    reject(
      changed((e) => {
        (e[at] as SeedEventShape).tags = ["no-such-tag"];
      }),
      /unknown tag "no-such-tag"/,
    );
  });

  it("rejects a category the defaults do not have, and a payee default that is missing too", () => {
    const at = indexOf((e) => e.type === "transaction.created" && e.category !== undefined);
    reject(
      changed((e) => {
        (e[at] as SeedEventShape).category = { group: "Food", name: "Caviar" };
      }),
      /category: unknown category "Food \/ Caviar"/,
    );
    const payee = indexOf((e) => e.type === "payee.created" && e.defaultCategory !== null);
    reject(
      changed((e) => {
        (e[payee] as SeedEventShape).defaultCategory = { group: "Nope", name: "Nothing" };
      }),
      /defaultCategory: unknown category "Nope \/ Nothing"/,
    );
  });

  it("rejects splits that do not add up, a zero split and an unknown beneficiary", () => {
    const at = indexOf((e) => (e.splits?.length ?? 0) > 1);
    reject(
      changed((e) => {
        const split = ((e[at] as SeedEventShape).splits as { amountCents: number }[])[0];
        (split as { amountCents: number }).amountCents += 1;
      }),
      /splits must add up to the transaction amount/,
    );
    reject(
      changed((e) => {
        const splits = (e[at] as SeedEventShape).splits as { beneficiary?: string }[];
        (splits[0] as { beneficiary?: string }).beneficiary = "person-z";
      }),
      /unknown beneficiary "person-z"/,
    );
    reject(
      changed((e) => {
        (e[at] as SeedEventShape).category = { group: "Food", name: "Groceries" };
      }),
      /classifies in its splits/,
    );
  });

  it("rejects a private account's split that names the other person", () => {
    const at = indexOf((e) => e.type === "transaction.created" && e.account === "person-a-private");
    reject(
      changed((e) => {
        const txn = e[at] as SeedEventShape;
        txn.splits = [{ amountCents: txn.amountCents as number, beneficiary: "person-b" }];
        delete txn.category;
        delete txn.tags;
      }),
      /belong to its owner/,
    );
  });

  it("rejects owner-only payees and tags used in a shared account, or in the partner's", () => {
    const shared = indexOf(
      (e) => e.type === "transaction.created" && e.account === "joint-everyday",
    );
    reject(
      changed((e) => {
        (e[shared] as SeedEventShape).payee = "dymocks";
      }),
      /payee "dymocks" is owner-only and cannot be used in account "joint-everyday"/,
    );
    reject(
      changed((e) => {
        (e[shared] as SeedEventShape).tags = ["surprise"];
        delete (e[shared] as SeedEventShape).splits;
      }),
      /tag "surprise" is owner-only/,
    );
    const mine = indexOf(
      (e) => e.type === "transaction.created" && e.account === "person-b-private",
    );
    reject(
      changed((e) => {
        (e[mine] as SeedEventShape).payee = "dymocks";
      }),
      /payee "dymocks" is owner-only and cannot be used in account "person-b-private"/,
    );
  });

  it("rejects reused keys and a balance for an unknown account", () => {
    const txn = indexOf((e) => e.type === "transaction.created");
    reject(
      changed((e) => {
        e.push(structuredClone(e[txn] as SeedEventShape));
      }),
      /transaction key "txn-0001" is used twice/,
    );
    reject(
      changed((e) => {
        const at = indexOf((x) => x.type === "tag.created");
        e.push(structuredClone(e[at] as SeedEventShape));
      }),
      /tag key ".+" is used twice/,
    );
    reject(
      changed((e) => {
        const at = indexOf((x) => x.type === "balance.recorded");
        (e[at] as SeedEventShape).account = "ghost";
      }),
      /unknown account "ghost"/,
    );
    reject(
      changed((e) => {
        const at = indexOf((x) => x.type === "balance.recorded");
        (e[at] as SeedEventShape).asOf = "2026-02-30";
      }),
      /asOf: Expected a real calendar date/,
    );
  });

  it("rejects a hidden name in a private account, by a non-owner, or of an unknown transaction", () => {
    const privateTxn = seed.events.find(
      (e) => e.type === "transaction.created" && e.account === "person-a-private",
    ) as SeedEventShape;
    reject(
      changed((e) => {
        e.push({
          type: "transaction.name-hidden",
          module: "transfers-and-privacy",
          transaction: privateTxn.key as string,
          by: "person-a",
        });
      }),
      /a name in a private account cannot be hidden/,
    );
    const hide = indexOf((e) => e.type === "transaction.name-hidden" && e.by === "person-a");
    const hidden = seed.events[hide] as SeedEventShape;
    const target = seed.events.find(
      (e) => e.type === "transaction.created" && e.key === hidden.transaction,
    ) as SeedEventShape;
    const someone = seed.events.find(
      (e) =>
        e.type === "transaction.created" &&
        e.account === target.account &&
        !seed.events.some((h) => h.type === "transaction.name-hidden" && h.transaction === e.key),
    ) as SeedEventShape;
    reject(
      changed((e) => {
        e.push({ ...structuredClone(hidden), transaction: someone.key as string, by: "person-z" });
      }),
      /unknown person "person-z"/,
    );
    reject(
      changed((e) => {
        e.push({ ...structuredClone(hidden), transaction: "txn-9999" });
      }),
      /unknown transaction "txn-9999"/,
    );
    reject(
      changed((e) => {
        e.push(structuredClone(hidden));
      }),
      /is hidden twice/,
    );
  });

  it("rejects a transfer between the same account, of unequal amounts, twice, or as the wrong person", () => {
    const transfer = seed.events.find((e) => e.type === "transfer.grouped") as SeedEventShape;
    const [x, y] = transfer.transactions as [string, string];
    const privateTransfer = seed.events.find(
      (e) =>
        e.type === "transfer.grouped" &&
        (e.transactions as string[]).some((k) =>
          seed.events.some(
            (t) =>
              t.type === "transaction.created" && t.key === k && t.account === "person-a-private",
          ),
        ),
    ) as SeedEventShape;
    const extra = (transactions: string[], by = "person-a") => ({
      type: "transfer.grouped",
      module: "transfers-and-privacy",
      transactions,
      by,
    });
    reject(
      changed((e) => void e.push(extra([x, x]))),
      /two different transactions/,
    );
    reject(
      changed((e) => void e.push(extra([x, "txn-9999"]))),
      /unknown transaction "txn-9999"/,
    );
    reject(
      changed((e) => void e.push(extra([x, y]))),
      /already in a transfer group/,
    );
    reject(
      changed((e) => void e.push(extra(["txn-0001", "txn-0002"]))),
      /opposite amounts/,
    );
    reject(
      changed((e) => {
        (e[seed.events.indexOf(privateTransfer)] as SeedEventShape).by = "person-b";
      }),
      /cannot see the private account/,
    );
  });
});

describe("atomicity", () => {
  it("loads all of the seed or none of it: a late failure rolls back everything", () => {
    // A second payee with an existing name passes validation and fails when applied, last.
    const payee = seed.events.find((e) => e.type === "payee.created") as SeedEventShape;
    const late = { ...structuredClone(payee), key: "late-duplicate" };
    expect(() =>
      applySeed(createUnitOfWork(db), deps(), withEvents([...seed.events, late])),
    ).toThrow(/payee with this name already exists/);
    for (const table of [
      "person",
      "account",
      "institution",
      "tag",
      "payee",
      '"transaction"',
      "split",
      "balance_snapshot",
      "audit_log",
      "category_group",
    ]) {
      expect(count(table), table).toBe(0);
    }
  });
});

describe("linkSeed", () => {
  /** A person with a login, as sign-up leaves them; `n` orders them by creation time. */
  function signUp(n: number, name: string): string {
    const id = `01J000000000000000000000${n}A`;
    db.prepare(
      `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 0, 1, 'x', 'x')`,
    ).run(`user-${n}`, name, `${name}@example.com`);
    db.prepare(
      `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
       VALUES (?, ?, ?, '#2563eb', ?, ?)`,
    ).run(id, `user-${n}`, name, `2026-09-0${n}T00:00:00.000Z`, `2026-09-0${n}T00:00:00.000Z`);
    return id;
  }

  const as = (id: string, clock = systemClock("UTC")) => ({
    viewer: personViewer(id as never, clock.now()),
    clock,
    newId: createIdGenerator(),
    uow: createUnitOfWork(db),
  });
  const linked = () => {
    const alex = signUp(1, "Alex");
    const sam = signUp(2, "Sam");
    const result = linkSeed(createUnitOfWork(db), deps(), seedJson);
    return { alex, sam, result };
  };
  /** Seed transactions by key, with their account's privacy. */
  const seedTxns = () =>
    eventsOf("transaction.created").map((t) => ({
      ...t,
      acct: eventsOf("account.created").find((a) => a.key === t.account) as SeedEventShape,
    }));

  it("attaches the seed's accounts to the signed-up people by sign-up order, creating nobody", () => {
    const { alex, sam, result } = linked();
    expect(result).toMatchObject({
      accounts: eventsOf("account.created").length,
      transactions: ex("transfers-and-privacy.transactionCount"),
      people: { "person-a": alex, "person-b": sam },
    });
    expect(count("category_group")).toBe(13);
    expect(count("tax_category")).toBe(8);
    expect(count("person")).toBe(2);
    const owners = db
      .prepare(
        `SELECT a.name, o.person_id FROM account a JOIN account_owner o ON o.account_id = a.id
         WHERE a.is_private = 1 ORDER BY a.name`,
      )
      .all();
    expect(owners).toEqual([
      { name: "Person A private", person_id: alex },
      { name: "Person B private", person_id: sam },
    ]);
  });

  it("shows each partner the shared accounts plus their own private ones, as many as the seed states", () => {
    const { alex, sam } = linked();
    const counts = ex("transfers-and-privacy.visibleCounts") as Record<string, number>;
    expect(listAllTransactions(as(alex))).toHaveLength(counts["person-a"] as number);
    expect(listAllTransactions(as(sam))).toHaveLength(counts["person-b"] as number);
    const accountOfTxn = (id: string) =>
      db
        .prepare(
          'SELECT a.name FROM "transaction" t JOIN account a ON a.id = t.account_id WHERE t.id = ?',
        )
        .pluck()
        .get(id) as string;
    const names = (id: string) =>
      new Set(listAllTransactions(as(id)).map((t) => accountOfTxn(t.id)));
    expect(names(alex).has("Person A private")).toBe(true);
    expect(names(alex).has("Person B private")).toBe(false);
    expect(names(sam).has("Person B private")).toBe(true);
    expect(names(sam).has("Person A private")).toBe(false);
  });

  it("gives every seeded split its sum, with nothing remaining", () => {
    const { alex, sam } = linked();
    for (const id of [alex, sam]) {
      for (const t of listAllTransactions(as(id))) {
        expect(t.splits.length).toBeGreaterThan(0);
        expect(t.splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(t.amountCents);
        expect(t.remainingCents).toBe(0);
      }
    }
    const multi = ex("ledger-transactions.multiSplitKeys") as string[];
    expect(multi.length).toBeGreaterThan(0);
    const bySeedKey = (key: string) => {
      const seeded = seedTxns().find((t) => t.key === key) as SeedEventShape;
      return listAllTransactions(as(alex)).find(
        (t) =>
          t.descriptionRaw === seeded.description &&
          t.postedOn === seeded.postedOn &&
          t.amountCents === seeded.amountCents,
      );
    };
    const first = bySeedKey(multi[0] as string);
    expect(first?.splits.length).toBeGreaterThan(1);
    expect(first?.remainingCents).toBe(0);
  });

  it("classifies: payees, categories, tags, notes and beneficiaries come through", () => {
    const { alex } = linked();
    const all = listAllTransactions(as(alex));
    expect(all.some((t) => t.payeeName !== null)).toBe(true);
    expect(all.some((t) => t.splits.some((s) => s.categoryId !== null))).toBe(true);
    expect(all.some((t) => t.splits.some((s) => s.tags.length > 0))).toBe(true);
    expect(all.some((t) => t.notes !== null)).toBe(true);
    expect(new Set(all.flatMap((t) => t.splits.map((s) => s.beneficiary))).size).toBeGreaterThan(2);
    // Seeded fields are the user's, not a seed source (no migration adds one).
    expect(
      db
        .prepare("SELECT DISTINCT category_source FROM split WHERE category_source IS NOT NULL")
        .pluck()
        .all(),
    ).toEqual(["user"]);
  });

  it("hides a name from the other partner, never from the hider", () => {
    const { alex, sam } = linked();
    const hidden = ex("transfers-and-privacy.hidden") as {
      transaction: string;
      by: string;
      description: string;
    }[];
    expect(hidden.length).toBeGreaterThan(0);
    const viewer = { "person-a": alex, "person-b": sam } as Record<string, string>;
    for (const h of hidden) {
      const other = h.by === "person-a" ? "person-b" : "person-a";
      const seeded = seedTxns().find((t) => t.key === h.transaction) as SeedEventShape;
      const find = (who: string) =>
        listAllTransactions(as(viewer[who] as string)).find(
          (t) =>
            t.postedOn === seeded.postedOn &&
            t.amountCents === seeded.amountCents &&
            (t.descriptionRaw === h.description || t.descriptionRaw.startsWith("Hidden until ")),
        );
      expect(find(h.by)?.descriptionRaw).toBe(h.description);
      expect(find(other)?.descriptionRaw).toMatch(/^Hidden until \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    }
  });

  it("hides names until exactly 12 months from the clock's today", () => {
    const { sam } = linked();
    const labels = listAllTransactions(as(sam))
      .map((t) => t.descriptionRaw)
      .filter((d) => d.startsWith("Hidden until"));
    const until = systemClock("UTC").today().add({ months: 12 });
    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][until.month - 1];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels)
      expect(label).toBe(`Hidden until ${until.day} ${month} ${until.year}`);
  });

  it("shows owner-only tags and payees to their owner alone, and shared ones to both", () => {
    const { alex, sam } = linked();
    const names = (type: string) => {
      const byKey = new Map(eventsOf(type).map((e) => [e.key as string, e.name as string]));
      return (keys: unknown) => (keys as string[]).map((k) => byKey.get(k) as string);
    };
    const tagNames = names("tag.created");
    const payeeNames = names("payee.created");
    const ownerOnly = (kind: "Tag" | "Payee") =>
      ex(`classification.ownerOnly${kind}Keys`) as Record<string, string[]>;
    const shared = {
      tags: tagNames(ex("classification.sharedTagKeys")),
      payees: payeeNames(ex("classification.sharedPayeeKeys")),
    };
    const seen = (id: string) => ({
      tags: listTags(as(id)).map((t) => t.name),
      payees: listPayees(as(id)).map((p) => p.name),
    });
    const mine = { "person-a": seen(alex), "person-b": seen(sam) };
    for (const [person, other] of [
      ["person-a", "person-b"],
      ["person-b", "person-a"],
    ] as const) {
      const own = {
        tags: tagNames(ownerOnly("Tag")[person]),
        payees: payeeNames(ownerOnly("Payee")[person]),
      };
      const theirs = {
        tags: tagNames(ownerOnly("Tag")[other]),
        payees: payeeNames(ownerOnly("Payee")[other]),
      };
      expect(own.tags.length + own.payees.length).toBeGreaterThan(0);
      for (const kind of ["tags", "payees"] as const) {
        const visible = mine[person][kind];
        for (const name of [...shared[kind], ...own[kind]]) expect(visible).toContain(name);
        for (const name of theirs[kind]) expect(visible).not.toContain(name);
        expect(visible).toHaveLength(shared[kind].length + own[kind].length);
      }
    }
  });

  it("shows a transfer with a private counterpart as 'Transfer from/to <owner>', with no counterpart", () => {
    const { alex, sam } = linked();
    const privateKeys = new Set(ex("transfers-and-privacy.privateTransferKeys") as string[]);
    const sharedSides = seedTxns().filter(
      (t) => privateKeys.has(t.key as string) && t.acct.isPrivate === false,
    );
    expect(sharedSides.length).toBeGreaterThan(0);
    for (const side of sharedSides) {
      const owner = eventsOf("transfer.grouped").find((g) =>
        g.transactions?.includes(side.key as string),
      )?.by;
      const viewerId = owner === "person-a" ? sam : alex;
      const ownerName = owner === "person-a" ? "Alex" : "Sam";
      const row = listAllTransactions(as(viewerId)).find(
        (t) =>
          t.postedOn === side.postedOn &&
          t.amountCents === side.amountCents &&
          t.transferLabel !== null,
      );
      expect(row?.transferLabel).toBe(
        `Transfer ${(side.amountCents as number) >= 0 ? "from" : "to"} ${ownerName}`,
      );
      // The partner sees the label, not the counterpart's ID: the transaction's own group ID is
      // all there is, and the private side is not in their list.
      expect(JSON.stringify(row)).not.toContain("private");
    }
    // Both partners' own private sides are not visible to the other.
    const aPrivate = seedTxns().filter((t) => t.acct.key === "person-a-private").length;
    expect(listAllTransactions(as(sam)).length).toBe(
      (ex("transfers-and-privacy.visibleCounts") as Record<string, number>)["person-b"],
    );
    expect(aPrivate).toBeGreaterThan(0);
  });

  it("states each account's closing balance, and balanceAsOf on the seed's today agrees", () => {
    const { alex, sam } = linked();
    const clock = fixedClockAt("2026-07-15");
    const closing = ex("balance-snapshots.closingCents") as Record<string, number>;
    const accountNames = new Map(
      eventsOf("account.created").map((a) => [a.key as string, a.name as string]),
    );
    expect(Object.keys(closing)).toHaveLength(eventsOf("account.created").length);
    for (const [key, cents] of Object.entries(closing)) {
      const id = db
        .prepare("SELECT id FROM account WHERE name = ?")
        .pluck()
        .get(accountNames.get(key)) as string;
      const viewer = key === "person-b-private" ? sam : alex;
      expect(balanceAsOf(as(viewer, clock), { accountId: id, date: "2026-07-15" }), key).toBe(
        cents,
      );
    }
  });

  it("leaves the household settings alone", () => {
    signUp(1, "Alex");
    signUp(2, "Sam");
    // Differs from the seed's timezone, so applying the seed's settings event would change it.
    db.prepare("UPDATE household_settings SET timezone = 'Australia/Perth'").run();
    const before = db.prepare("SELECT * FROM household_settings").get();
    linkSeed(createUnitOfWork(db), deps(), seedJson);
    expect(db.prepare("SELECT * FROM household_settings").get()).toEqual(before);
    expect(db.prepare("SELECT timezone FROM household_settings").pluck().get()).toBe(
      "Australia/Perth",
    );
  });

  it("asks for both partners to sign up first, writing nothing", () => {
    signUp(1, "Alex");
    expect(() => linkSeed(createUnitOfWork(db), deps(), seedJson)).toThrow(/sign up both partners/);
    expect(count("account")).toBe(0);
  });

  it("refuses a ledger that has an account but no transactions, writing nothing", () => {
    signUp(1, "Alex");
    signUp(2, "Sam");
    db.prepare(
      "INSERT INTO account (id, name, type, currency, is_private, created_at, updated_at) VALUES ('01J0000000000000000000009A','x','other','AUD',0,'t','t')",
    ).run();
    const error = rejection(() => linkSeed(createUnitOfWork(db), deps(), seedJson));
    expect(error.code).toBe("Conflict");
    expect(count("account")).toBe(1);
  });

  it("refuses a second run on a ledger that already has transactions", () => {
    signUp(1, "Alex");
    signUp(2, "Sam");
    linkSeed(createUnitOfWork(db), deps(), seedJson);
    const accounts = count("account");
    const rows = [count('"transaction"'), count("audit_log"), count("tag"), count("payee")];
    const error = rejection(() => linkSeed(createUnitOfWork(db), deps(), seedJson));
    expect(error.code).toBe("Conflict");
    expect([
      count("account"),
      count('"transaction"'),
      count("audit_log"),
      count("tag"),
      count("payee"),
    ]).toEqual([accounts, ...rows]);
  });
});

describe("seedCommand", () => {
  const adminDeps = (seedFile?: string, seedEnabled = true) =>
    ({
      uow: createUnitOfWork(db),
      ...deps(),
      ...(seedFile === undefined ? {} : { seedFile }),
      seedEnabled,
    }) as AdminDeps;

  it("refuses unless the stack enables it, whatever the seed file", () => {
    const file = join(seedDir, "seed.json");
    for (const enabled of [false, undefined]) {
      const dep = { ...adminDeps(file), seedEnabled: enabled } as AdminDeps;
      expect(() => seedCommand(dep)).toThrow(SEED_DISABLED);
    }
    expect(count("person")).toBe(0);
  });

  it("refuses without a readable seed file", () => {
    expect(() => seedCommand(adminDeps())).toThrow(/no seed file/);
    expect(() => seedCommand(adminDeps(join(seedDir, "missing.json")))).toThrow(
      /could not be read/,
    );
  });

  it("takes no arguments", () => {
    expect(() => seedCommand(adminDeps(join(seedDir, "seed.json")), { path: "x" })).toThrow(
      /Invalid arguments/,
    );
  });
});
