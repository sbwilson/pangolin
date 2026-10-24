// The cash-flow ticket's verify: apply the default seed, then for each partner compare the three
// figures `/api/reports/cash-flow` answers with a hand sum over the seed file's own splits,
// classed by AD-23 from the seed's accounts, categories and transfer links alone (never from the
// database), so the SQL `flowKind`, visibility and the route are checked end to end. Story 4.2
// does the same for P&L (by group and category), spending and merchants, with each split's payee
// projected from the seed's payee scopes and hidden names.
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
  payee?: string;
  name?: string;
  origin?: string | null;
  transaction?: string;
  by?: string;
}

/** One split a person sees, as the hand sum classes it. */
interface HandSplit {
  kind: "income" | "expense" | "transfer" | "investing";
  group: string | null;
  category: string | null;
  /** The seed key of the payee this person sees, or null (none, hidden, or another's scoped). */
  payee: string | null;
  amountCents: number;
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
  /** Payee key → whether this person may see it (shared, or scoped to them by origin). */
  const payeeVisible = new Map<string, boolean>();
  /** Transaction key → the person who hid its name. */
  const hiddenBy = new Map<string, string>();
  const ownerOf = new Map<string, string | undefined>();
  for (const e of seed.events) {
    if (e.type === "account.created") {
      const mine = (e.owners ?? []).some((o) => o.person === personKey);
      accounts.set(e.key as string, {
        type: e.accountType as string,
        visible: e.isPrivate !== true || mine,
      });
      ownerOf.set(e.key as string, e.isPrivate === true ? e.owners?.[0]?.person : undefined);
    } else if (e.type === "payee.created") {
      const origin = e.origin ?? null;
      const scope = origin === null ? undefined : ownerOf.get(origin);
      payeeVisible.set(e.key as string, scope === undefined || scope === personKey);
    } else if (e.type === "transaction.name-hidden") {
      hiddenBy.set(e.transaction as string, e.by as string);
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
  const splitsSeen: HandSplit[] = [];
  for (const [key, t] of txns) {
    const account = accounts.get(t.account as string);
    if (account === undefined || !account.visible) continue;
    const day = t.postedOn as string;
    if (day < from || day > to) continue;
    const other = counterpartOf.get(key);
    const otherAccount =
      other === undefined ? undefined : accounts.get(txns.get(other)?.account as string);
    const by = hiddenBy.get(key);
    const payee =
      t.payee === undefined || (by !== undefined && by !== personKey) || !payeeVisible.get(t.payee)
        ? null
        : t.payee;
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
      splitsSeen.push({
        kind,
        group: s.category?.group ?? null,
        category: s.category?.name ?? null,
        payee,
        amountCents: s.amountCents,
      });
      if (kind === "income") moneyIn += s.amountCents;
      if (kind === "expense") moneyOut -= s.amountCents;
    }
  }
  return { moneyIn, moneyOut, counted, kinds, hiddenTransfer, splits: splitsSeen };
}

/** The hand sum of one person's qualifying merchant leaks over `from`..`to`, by AD-23 from the seed alone. */
function handLeaks(personKey: string, from: string, to: string) {
  const groupKind = new Map(DEFAULT_CATEGORIES.map((g) => [g.name, g.kind as string]));
  const accounts = new Map<string, { type: string; visible: boolean }>();
  const txns = new Map<string, SeedEvent>();
  const counterpartOf = new Map<string, string>();
  const payeeVisible = new Map<string, boolean>();
  const hiddenBy = new Map<string, string>();
  const ownerOf = new Map<string, string | undefined>();
  const payeeNameMap = new Map<string, string>();

  for (const e of seed.events) {
    if (e.type === "account.created") {
      const mine = (e.owners ?? []).some((o) => o.person === personKey);
      accounts.set(e.key as string, {
        type: e.accountType as string,
        visible: e.isPrivate !== true || mine,
      });
      ownerOf.set(e.key as string, e.isPrivate === true ? e.owners?.[0]?.person : undefined);
    } else if (e.type === "payee.created") {
      const origin = e.origin ?? null;
      const scope = origin === null ? undefined : ownerOf.get(origin);
      payeeVisible.set(e.key as string, scope === undefined || scope === personKey);
      payeeNameMap.set(e.key as string, e.name as string);
    } else if (e.type === "transaction.name-hidden") {
      hiddenBy.set(e.transaction as string, e.by as string);
    } else if (e.type === "transaction.created") {
      txns.set(e.key as string, e);
    } else if (e.type === "transfer.grouped") {
      const [x, y] = e.transactions as [string, string];
      counterpartOf.set(x, y);
      counterpartOf.set(y, x);
    }
  }

  const merchantTxns = new Map<string, number[]>();
  for (const [key, t] of txns) {
    const account = accounts.get(t.account as string);
    if (account === undefined || !account.visible) continue;
    const day = t.postedOn as string;
    if (day < from || day > to) continue;
    const by = hiddenBy.get(key);
    const payee =
      t.payee === undefined || (by !== undefined && by !== personKey) || !payeeVisible.get(t.payee)
        ? null
        : t.payee;
    if (payee === null) continue;

    const other = counterpartOf.get(key);
    const otherAccount =
      other === undefined ? undefined : accounts.get(txns.get(other)?.account as string);
    const splits: SeedSplit[] = t.splits ?? [
      { amountCents: t.amountCents as number, ...(t.category ? { category: t.category } : {}) },
    ];
    let txnSpend = 0;
    for (const s of splits) {
      let kind: "income" | "expense" | "transfer" | "investing";
      if (otherAccount !== undefined && !otherAccount.visible) {
        kind = "transfer";
      } else if (
        otherAccount !== undefined &&
        ["transaction", "savings", "offset", "credit_card"].includes(otherAccount.type)
      ) {
        kind = "transfer";
      } else if (otherAccount?.type === "home_loan") {
        kind = s.amountCents < 0 ? "expense" : "transfer";
      } else if (otherAccount !== undefined && ["brokerage", "super"].includes(otherAccount.type)) {
        kind = "investing";
      } else if (s.category !== undefined && groupKind.get(s.category.group) === "transfer") {
        kind = "transfer";
      } else {
        kind = s.amountCents > 0 ? "income" : "expense";
      }
      if (kind === "expense" && s.amountCents < 0) {
        txnSpend += -s.amountCents;
      }
    }
    if (txnSpend > 0) {
      const list = merchantTxns.get(payee) ?? [];
      list.push(txnSpend);
      merchantTxns.set(payee, list);
    }
  }

  const results: { payee: string; count: number; totalCents: number; medianCents: number }[] = [];
  for (const [payee, amounts] of merchantTxns) {
    if (amounts.length < 4) continue;
    amounts.sort((a, b) => a - b);
    const count = amounts.length;
    const totalCents = amounts.reduce((a, b) => a + b, 0);
    const medianCents =
      count % 2 === 1
        ? (amounts[Math.floor(count / 2)] as number)
        : Math.round(((amounts[count / 2 - 1] as number) + (amounts[count / 2] as number)) / 2);
    if (medianCents <= 2500) {
      results.push({ payee, count, totalCents, medianCents });
    }
  }

  const byText = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  results.sort((a, b) => {
    if (b.totalCents !== a.totalCents) return b.totalCents - a.totalCents;
    const nameA = payeeNameMap.get(a.payee) ?? "";
    const nameB = payeeNameMap.get(b.payee) ?? "";
    return byText(nameA, nameB) || byText(a.payee, b.payee);
  });

  return results.slice(0, 5);
}

/** Positive cents per label for one kind of the hand-summed splits, as sorted [label, cents]. */
function handRows(
  splits: readonly HandSplit[],
  kind: "income" | "expense",
  label: (s: HandSplit) => string,
): [string, number][] {
  const sums = new Map<string, number>();
  for (const s of splits) {
    if (s.kind !== kind) continue;
    const cents = kind === "income" ? s.amountCents : -s.amountCents;
    sums.set(label(s), (sums.get(label(s)) ?? 0) + cents);
  }
  return [...sums].sort(compareRows);
}

const compareRows = (x: [string, number], y: [string, number]) =>
  x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1];

interface ApiRow {
  id?: string | null;
  name?: string | null;
  groupName?: string | null;
  payeeId?: string | null;
  payeeName?: string | null;
  cents: number;
}

/** Route rows as sorted [label, cents], after checking they are in amount-descending order. */
function apiRows(rows: readonly ApiRow[], label: (r: ApiRow) => string): [string, number][] {
  for (let i = 1; i < rows.length; i++) {
    expect((rows[i - 1] as ApiRow).cents).toBeGreaterThanOrEqual((rows[i] as ApiRow).cents);
  }
  return rows.map((r): [string, number] => [label(r), r.cents]).sort(compareRows);
}

const NONE = "(none)";

describe("GET /api/reports/{pnl,spending,merchants} on the default seed", () => {
  it("answers each partner's hand sums per group, category and visible payee", async () => {
    const app = createApp(appDeps());
    const cookieOf: Record<string, string> = {
      "01J0000000000000000000000A": "session=user-a",
      "01J0000000000000000000000B": "session=user-b",
    };
    const payeeName = new Map(
      seed.events.flatMap((e) =>
        e.type === "payee.created" ? [[e.key as string, e.name as string] as const] : [],
      ),
    );
    const days = seed.events.flatMap((e) => (e.postedOn === undefined ? [] : [e.postedOn])).sort();
    const ranges = [
      { from: days[0] as string, to: days[days.length - 1] as string },
      { from: "2026-04-01", to: "2026-06-30" },
      { from: "2026-07-01", to: "2026-07-15" },
    ];
    // biome-ignore lint/suspicious/noExplicitAny: the route bodies are checked field by field.
    const get = async (cookie: string, path: string): Promise<any> => {
      const res = await app.request(path, { headers: { Cookie: cookie } });
      expect(res.status, path).toBe(200);
      return res.json();
    };
    let namedPayees = 0;
    let nullPayees = 0;
    let foundLeaks = 0;
    for (const personKey of Object.keys(people)) {
      const cookie = cookieOf[people[personKey] as string] as string;
      for (const range of ranges) {
        const at = `${personKey} ${range.from}..${range.to}`;
        const q = `from=${range.from}&to=${range.to}`;
        const sum = handSum(personKey, range.from, range.to);
        const byGroup = (s: HandSplit) => s.group ?? NONE;
        const byCategory = (s: HandSplit) => (s.group === null ? NONE : `${s.group}/${s.category}`);
        const apiGroup = (r: ApiRow) => r.name ?? NONE;
        const apiCategory = (r: ApiRow) => (r.id === null ? NONE : `${r.groupName}/${r.name}`);
        const uncategorised = (kind: "income" | "expense") =>
          handRows(sum.splits, kind, byGroup).find(([label]) => label === NONE)?.[1] ?? 0;

        for (const [by, hand, api] of [
          ["group", byGroup, apiGroup],
          ["category", byCategory, apiCategory],
        ] as const) {
          const pnl = await get(cookie, `/api/reports/pnl?${q}&by=${by}`);
          expect(pnl.income.totalCents, at).toBe(sum.moneyIn);
          expect(pnl.expense.totalCents, at).toBe(sum.moneyOut);
          expect(apiRows(pnl.income.rows, api), `${at} P&L income by ${by}`).toEqual(
            handRows(sum.splits, "income", hand),
          );
          expect(apiRows(pnl.expense.rows, api), `${at} P&L expense by ${by}`).toEqual(
            handRows(sum.splits, "expense", hand),
          );
          expect(pnl.uncategorised, at).toEqual({
            inCents: uncategorised("income"),
            outCents: uncategorised("expense"),
          });
          const spend = await get(cookie, `/api/reports/spending?${q}&by=${by}`);
          expect(spend.totalCents, at).toBe(sum.moneyOut);
          expect(spend.rows, `${at} spending by ${by}`).toEqual(pnl.expense.rows);
        }

        for (const flow of ["income", "expense"] as const) {
          const body = await get(cookie, `/api/reports/merchants?${q}&flow=${flow}`);
          expect(body.totalCents, at).toBe(flow === "income" ? sum.moneyIn : sum.moneyOut);
          for (const r of body.rows as ApiRow[]) {
            if (r.payeeId === null) {
              expect(r.payeeName, at).toBeNull();
              nullPayees++;
            } else namedPayees++;
          }
          expect(
            apiRows(body.rows, (r) => r.payeeName ?? NONE),
            `${at} merchants ${flow}`,
          ).toEqual(
            handRows(sum.splits, flow, (s) =>
              s.payee === null ? NONE : (payeeName.get(s.payee) as string),
            ),
          );
        }

        const leaksBody = await get(cookie, `/api/reports/leaks?${q}`);
        expect(leaksBody.from, at).toBe(range.from);
        expect(leaksBody.to, at).toBe(range.to);
        const expectedLeaks = handLeaks(personKey, range.from, range.to);
        expect(
          (
            leaksBody.rows as {
              payeeName: string;
              count: number;
              totalCents: number;
              medianCents: number;
            }[]
          ).map((r) => ({
            payeeName: r.payeeName,
            count: r.count,
            totalCents: r.totalCents,
            medianCents: r.medianCents,
          })),
          `${at} leaks`,
        ).toEqual(
          expectedLeaks.map((l) => ({
            payeeName: payeeName.get(l.payee) as string,
            count: l.count,
            totalCents: l.totalCents,
            medianCents: l.medianCents,
          })),
        );
        if (expectedLeaks.length > 0) foundLeaks++;
      }
    }
    expect(foundLeaks).toBeGreaterThan(0);
    // The seed exercises both named merchants and the null bucket.
    expect(namedPayees).toBeGreaterThan(0);
    expect(nullPayees).toBeGreaterThan(0);
    // The seed's hidden names carry no payee, so the hidden-payee bucket is proven by the parity,
    // use-case and privacy suites; the projection here still follows the seed's hidings.
  });
});

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
          savingsRatePermille:
            sum.moneyIn > 0
              ? Math.sign(sum.moneyIn - sum.moneyOut) *
                  Math.round((Math.abs(sum.moneyIn - sum.moneyOut) * 1000) / sum.moneyIn) || 0
              : null,
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
