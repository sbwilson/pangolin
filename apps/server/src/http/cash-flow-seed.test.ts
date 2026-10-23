// The cash-flow ticket's verify: apply the default seed, then for each partner compare the three
// figures `/api/reports/cash-flow` answers with a hand sum over the seed file's own splits,
// classed by AD-23 from the seed's accounts, categories and transfer links alone (never from the
// database), so the SQL `flowKind`, visibility and the route are checked end to end.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdGenerator, DEFAULT_CATEGORIES, fixedClockAt } from "@pangolin/app";
import { fakeAttachmentStore } from "@pangolin/app/testing/attachment-store";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { linkSeed } from "../admin/seed.ts";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { type AppDeps, createApp } from "./app.ts";
import type { AuthGateway } from "./session.ts";

interface SeedSplit {
  amountCents: number;
  category?: { group: string; name: string };
}
interface SeedEvent {
  type: string;
  key?: string;
  accountType?: string;
  isPrivate?: boolean;
  owners?: { person: string }[];
  account?: string;
  postedOn?: string;
  amountCents?: number;
  category?: { group: string; name: string };
  splits?: SeedSplit[];
  transactions?: [string, string];
}

let dir: string;
let db: Db;
let seed: { today: string; events: SeedEvent[] };
let people: Record<string, string>;

const MIGRATIONS = loadMigrations(packageMigrationsDir).length;

/** Two logins, `user-a` and `user-b`, each enrolled, sent as `session=<user>`. */
function addLogins(target: Db): void {
  for (const [user, name, at] of [
    ["user-a", "Alex", "2026-01-01T00:00:00.000Z"],
    ["user-b", "Sam", "2026-01-02T00:00:00.000Z"],
  ] as const) {
    target
      .prepare(
        `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 0, 1, 'x', 'x')`,
      )
      .run(user, name, `${user}@example.com`);
    target
      .prepare(
        `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
         VALUES (?, ?, 'k', ?, 0, 'singleDevice', 0)`,
      )
      .run(`pk-${user}`, user, `c-${user}`);
    target
      .prepare(
        `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
         VALUES (?, ?, ?, '#2563eb', ?, ?)`,
      )
      .run(`01J00000000000000000000${user === "user-a" ? "00A" : "00B"}`, user, name, at, at);
  }
}

function gateway(): AuthGateway {
  return {
    handler: async () => new Response("auth"),
    getSession: async (headers) => {
      const user = /^session=(user-[ab])$/.exec(headers.get("cookie") ?? "")?.[1];
      return {
        session: user === undefined ? null : { userId: user, createdAt: new Date() },
        setCookies: [],
      };
    },
    signUp: async () => {
      throw new Error("not used");
    },
    recover: async () => {
      throw new Error("not used");
    },
    reEnrol: async () => {
      throw new Error("not used");
    },
  };
}

function appDeps(): AppDeps {
  return {
    systemHealth: createSystemHealthRepo(db),
    uow: createUnitOfWork(db),
    clock: fixedClockAt(seed.today),
    newId: createIdGenerator(),
    tokens: nodeTokens,
    codes: recoveryCodeHasher("test-secret"),
    attachments: fakeAttachmentStore(),
    publicUrl: "http://localhost:3000",
    authn: { kind: "live", gateway: gateway() },
    healthz: { expectedSchemaVersion: MIGRATIONS, runner: () => undefined },
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-cash-flow-seed-"));
  const file = join(dir, "seed.json");
  generateSeedFile(file);
  const seedJson = readFileSync(file, "utf8");
  seed = JSON.parse(seedJson);
  db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  addLogins(db);
  people = linkSeed(
    createUnitOfWork(db),
    { clock: fixedClockAt(seed.today), newId: createIdGenerator() },
    seedJson,
  ).people;
}, 120_000);

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The hand sum of one person's visible splits over `from`..`to`, by AD-23 from the seed alone. */
function handSum(personKey: string, from: string, to: string) {
  const groupKind = new Map(DEFAULT_CATEGORIES.map((g) => [g.name, g.kind as string]));
  const accounts = new Map<string, { type: string; visible: boolean }>();
  const txns = new Map<string, SeedEvent>();
  const counterpartOf = new Map<string, string>();
  for (const e of seed.events) {
    if (e.type === "account.created") {
      const mine = (e.owners ?? []).some((o) => o.person === personKey);
      accounts.set(e.key as string, {
        type: e.accountType as string,
        visible: e.isPrivate !== true || mine,
      });
    } else if (e.type === "transaction.created") {
      txns.set(e.key as string, e);
    } else if (e.type === "transfer.grouped") {
      const [x, y] = e.transactions as [string, string];
      counterpartOf.set(x, y);
      counterpartOf.set(y, x);
    }
  }
  let moneyIn = 0;
  let moneyOut = 0;
  let counted = 0;
  const kinds = { income: 0, expense: 0, transfer: 0, investing: 0 };
  /** Splits classed as `transfer` because their counterpart is hidden from this person. */
  let hiddenTransfer = 0;
  for (const [key, t] of txns) {
    const account = accounts.get(t.account as string);
    if (account === undefined || !account.visible) continue;
    const day = t.postedOn as string;
    if (day < from || day > to) continue;
    const other = counterpartOf.get(key);
    const otherAccount =
      other === undefined ? undefined : accounts.get(txns.get(other)?.account as string);
    const splits: SeedSplit[] = t.splits ?? [
      { amountCents: t.amountCents as number, ...(t.category ? { category: t.category } : {}) },
    ];
    for (const s of splits) {
      let kind: keyof typeof kinds;
      if (otherAccount !== undefined && !otherAccount.visible) {
        kind = "transfer";
        hiddenTransfer++;
      } else if (
        otherAccount !== undefined &&
        ["transaction", "savings", "offset", "credit_card"].includes(otherAccount.type)
      )
        kind = "transfer";
      else if (otherAccount?.type === "home_loan") {
        kind = s.amountCents < 0 ? "expense" : "transfer";
      } else if (otherAccount !== undefined && ["brokerage", "super"].includes(otherAccount.type))
        kind = "investing";
      else if (s.category !== undefined && groupKind.get(s.category.group) === "transfer")
        kind = "transfer";
      else kind = s.amountCents > 0 ? "income" : "expense";
      kinds[kind]++;
      counted++;
      if (kind === "income") moneyIn += s.amountCents;
      if (kind === "expense") moneyOut -= s.amountCents;
    }
  }
  return { moneyIn, moneyOut, counted, kinds, hiddenTransfer };
}

describe("GET /api/reports/cash-flow on the default seed", () => {
  it("answers each partner's hand sum of their visible splits by AD-23", async () => {
    const app = createApp(appDeps());
    const cookieOf: Record<string, string> = {
      "01J0000000000000000000000A": "session=user-a",
      "01J0000000000000000000000B": "session=user-b",
    };
    const days = seed.events.flatMap((e) => (e.postedOn === undefined ? [] : [e.postedOn])).sort();
    const first = days[0] as string;
    const last = days[days.length - 1] as string;
    const ranges = [
      { from: first, to: last },
      { from: "2026-04-01", to: "2026-06-30" },
      { from: "2026-07-01", to: "2026-07-15" },
    ];
    const keys = Object.keys(people);
    expect(keys).toHaveLength(2);
    const totals: Record<string, string> = {};
    let hiddenTransfers = 0;
    for (const personKey of keys) {
      const cookie = cookieOf[people[personKey] as string] as string;
      for (const range of ranges) {
        const sum = handSum(personKey, range.from, range.to);
        const res = await app.request(`/api/reports/cash-flow?from=${range.from}&to=${range.to}`, {
          headers: { Cookie: cookie },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body, `${personKey} ${range.from}..${range.to}`).toEqual({
          ...range,
          moneyInCents: sum.moneyIn,
          moneyOutCents: sum.moneyOut,
          keptCents: sum.moneyIn - sum.moneyOut,
        });
        totals[`${personKey} ${range.from}`] = JSON.stringify(body);
      }
      // The whole seed exercises income, spending and transfers for each partner.
      const whole = handSum(personKey, first, last);
      expect(whole.kinds.income, personKey).toBeGreaterThan(0);
      expect(whole.kinds.expense, personKey).toBeGreaterThan(0);
      expect(whole.kinds.transfer, personKey).toBeGreaterThan(0);
      hiddenTransfers += whole.hiddenTransfer;
    }
    // A partner's shared row linked to the other's private account is a transfer for them.
    expect(hiddenTransfers).toBeGreaterThan(0);
    // Household totals are per viewer: with private accounts in the seed they differ.
    const [one, two] = keys as [string, string];
    expect(totals[`${one} ${first}`]).not.toBe(totals[`${two} ${first}`]);
  });
});
