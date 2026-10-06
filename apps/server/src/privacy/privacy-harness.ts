// The privacy suite's worlds (AD-3, AD-4, AD-5, AD-18): the same seeded household built twice, the
// same ids and the same clock, differing only in partner A's private delta, which is applied last
// through the use cases. Partner B is signed in through the real HTTP app, so every route runs
// under its real middleware. Test support only.
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AccountRepo,
  type ActivityRepo,
  BACKUP_DRILL_JOB,
  type Clock,
  closeAccount,
  createAccount,
  createActivity,
  createCategory,
  createIdGenerator,
  createPayee,
  createPayeeAlias,
  createTag,
  createTransaction,
  createTransferGroup,
  defineReviewKind,
  deleteActivity,
  deletePayee,
  deletePayeeAlias,
  deleteTag,
  deleteTransaction,
  deleteTransferGroup,
  fixedClockAt,
  getTransaction,
  hideTransactionName,
  type IdGenerator,
  listAccounts,
  listCategories,
  listCategoryGroups,
  listInstitutions,
  listPayees,
  listTags,
  listTaxCategories,
  type PayeeAliasRepo,
  type PayeeRepo,
  type PersonViewer,
  personViewer,
  type ReviewItemRepo,
  raiseReviewItem,
  recordBalanceSnapshot,
  setPrivacy,
  setSplitField,
  setSplits,
  setSplitTags,
  type TagRepo,
  type TransactionRepo,
  type UnitOfWork,
  type UseCaseContext,
  updateAccount,
  updateActivity,
  updatePayee,
  updatePayeeAlias,
  updateTag,
  updateTransaction,
  type Viewer,
  type VisibleTransaction,
  write,
} from "@pangolin/app";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { applySeed, parseSeed } from "../admin/seed.ts";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { type AppDeps, createApp } from "../http/app.ts";
import type { AuthGateway } from "../http/session.ts";
import { createDrillRig } from "../testing/backup-drill.ts";
import type { Entity, SlotId } from "./route-manifest.ts";

export const ORIGIN = "http://localhost:3000";

export type Who = "a" | "b";

/** The names partner A's private data holds, which partner B then tries to take. */
export const A_NAMES = {
  account: "Delta private cash",
  renamedFrom: "Delta private savings",
  renamedTo: "Delta renamed savings",
  payee: "Delta Payee",
  tag: "Delta Tag",
  activity: "Delta Activity",
  alias: "DELTA PAYEE ALIAS",
} as const;

export const ACCOUNT_ITEM_REVIEW = defineReviewKind({
  kind: "privacy-suite.account-item",
  module: "system",
  scope: "account",
});
export const PERSON_ITEM_REVIEW = defineReviewKind({
  kind: "privacy-suite.person-item",
  module: "system",
  scope: "person",
});
export const HOUSEHOLD_ITEM_REVIEW = defineReviewKind({
  kind: "privacy-suite.household-item",
  module: "system",
  scope: "household",
});

/** A clock the tests move: `set` takes a `YYYY-MM-DD` day. */
export interface TestClock extends Clock {
  set(day: string): void;
}

export function testClock(day: string): TestClock {
  let current = fixedClockAt(day);
  return {
    now: () => current.now(),
    today: () => current.today(),
    set: (next) => {
      current = fixedClockAt(next);
    },
  };
}

/** A small deterministic generator in [0, 1) (mulberry32), so ids repeat from the same seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An id generator that gives the same ids in every world that reaches the same state. */
export function deterministicIds(startMs: number, seed: number): IdGenerator {
  return createIdGenerator({ now: () => startMs, random: seededRandom(seed) });
}

const REQUEST_IDS_AT = 1_800_000_000_000;
const REQUEST_IDS_SEED = 2;

/** The time part every id minted by B's requests starts with, whatever world they ran in. */
export const REQUEST_ID_PREFIX = deterministicIds(REQUEST_IDS_AT, REQUEST_IDS_SEED)().slice(0, 10);

/**
 * Names the ids B's requests mint by order of first appearance (`request-1`, ...). The monotonic
 * test generator hands out consecutive ids, so a hidden row minted in one world (an audit row of
 * A's alias a cascade deleted) would shift every later id; a real id is random and carries no such
 * signal. Only the opaque suffix is masked: every other byte is still compared.
 */
export function normaliseRequestIds(text: string): string {
  const names = new Map<string, string>();
  return text.replace(new RegExp(`${REQUEST_ID_PREFIX}[0-9A-HJKMNP-TV-Z]{16}`, "g"), (id) => {
    const known = names.get(id) ?? `request-${names.size + 1}`;
    names.set(id, known);
    return known;
  });
}

export interface Captured {
  readonly status: number;
  readonly text: string;
}

/** The ids of partner A's private data, in one world. Deleted rows are included. */
export interface PrivateIds {
  readonly account: string[];
  readonly transaction: string[];
  readonly split: string[];
  readonly payee: string[];
  readonly tag: string[];
  readonly alias: string[];
  readonly activity: string[];
  readonly transferGroup: string[];
  readonly notice: string[];
}

export interface World {
  readonly variant: Variant;
  readonly db: Db;
  readonly uow: UnitOfWork;
  readonly clock: TestClock;
  readonly people: Readonly<Record<Who, PersonViewer["personId"]>>;
  /** Partner A's private data. */
  readonly privateIds: PrivateIds;
  /** The first id of each kind that partner B may use, and a second where a route needs two. */
  readonly ok: (entity: Entity, slot?: number) => string;
  readonly ctx: (who: Who) => UseCaseContext;
  /** Switch to the ids B's own writes use: the same in every world. */
  readonly startRequestIds: () => void;
  readonly request: (who: Who, method: string, path: string, body?: unknown) => Promise<Captured>;
  /** Every table's rows as text, to prove a refused request changed nothing. */
  readonly dump: () => string;
  readonly app: ReturnType<typeof createApp>;
  readonly deps: AppDeps;
  readonly close: () => void;
}

export type Variant = "base" | "delta";

const NEVER_EXISTED = "01J0000000000000000000ZZZZ";
/** A well-formed id that names nothing. */
export const nonexistentId = (): string => NEVER_EXISTED;

function gateway(clock: Clock, users: Record<string, string>): AuthGateway {
  return {
    handler: async (request) => new Response(`auth:${new URL(request.url).pathname}`),
    getSession: async (headers) => {
      const cookie = headers.get("cookie") ?? "";
      const userId = users[cookie];
      return {
        session:
          userId === undefined
            ? null
            : { userId, createdAt: new Date(clock.now().epochMilliseconds) },
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

const COOKIES: Record<Who, string> = { a: "session=user-a", b: "session=user-b" };

/** Links a login with a passkey and TOTP to a seeded person, so its session resolves to them. */
function linkLogin(db: Db, userId: string, personId: string, name: string): void {
  db.prepare(
    `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, 'x', 'x')`,
  ).run(userId, name, `${userId}@example.com`);
  db.prepare(
    `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
     VALUES (?, ?, 'k', ?, 0, 'singleDevice', 0)`,
  ).run(`pk-${userId}`, userId, `c-${userId}`);
  db.prepare(
    `INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES (?, ?, ?, 'credential', 'old-hash', 'x', 'x')`,
  ).run(`acc-${userId}`, userId, userId);
  db.prepare(
    `INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', 'x', 'x')`,
  ).run(`s-${userId}`, userId, `t-${userId}`);
  db.prepare("UPDATE person SET user_id = ? WHERE id = ?").run(userId, personId);
}

function column(db: Db, sql: string, ...args: unknown[]): string[] {
  return db
    .prepare(sql)
    .pluck()
    .all(...args) as string[];
}

/** Partner A's private data, read straight from the tables (deleted rows included). */
function collectPrivateIds(db: Db, a: string): PrivateIds {
  const accounts = column(
    db,
    `SELECT a.id FROM account a WHERE a.is_private = 1
       AND EXISTS (SELECT 1 FROM account_owner o WHERE o.account_id = a.id AND o.person_id = ?)
     ORDER BY a.id`,
    a,
  );
  const inAccounts = accounts.map(() => "?").join(",");
  const none = accounts.length === 0;
  const transactions = none
    ? []
    : column(
        db,
        `SELECT id FROM "transaction" WHERE account_id IN (${inAccounts}) ORDER BY id`,
        ...accounts,
      );
  const splits = none
    ? []
    : column(
        db,
        `SELECT s.id FROM split s JOIN "transaction" t ON t.id = s.transaction_id
          WHERE t.account_id IN (${inAccounts}) ORDER BY s.id`,
        ...accounts,
      );
  const members = db
    .prepare(
      `SELECT transfer_group_id AS g, account_id AS acc FROM "transaction"
        WHERE transfer_group_id IS NOT NULL AND deleted_at IS NULL`,
    )
    .all() as { g: string; acc: string }[];
  const groups = new Map<string, boolean>();
  for (const { g, acc } of members) {
    groups.set(g, (groups.get(g) ?? true) && accounts.includes(acc));
  }
  return {
    account: accounts,
    transaction: transactions,
    split: splits,
    payee: column(db, "SELECT id FROM payee WHERE scope_person_id = ? ORDER BY id", a),
    tag: column(db, "SELECT id FROM tag WHERE scope_person_id = ? ORDER BY id", a),
    alias: column(db, "SELECT id FROM payee_alias WHERE scope_person_id = ? ORDER BY id", a),
    activity: column(db, "SELECT id FROM activity WHERE scope_person_id = ? ORDER BY id", a),
    transferGroup: [...groups].filter(([, allPrivate]) => allPrivate).map(([g]) => g),
    notice: column(
      db,
      "SELECT id FROM review_item WHERE person_id = ? AND resolved_at IS NULL ORDER BY id",
      a,
    ),
  };
}

/**
 * Builds a world from the demo seed. `base` stops at the shared household; `delta` then lets
 * partner A add, rename, close and delete private accounts and the classification, snapshots,
 * transactions, splits, transfers, review items and audit rows that go with them. `dbFile` keeps
 * the database in a file instead of memory.
 */
export function buildWorld(
  seedJson: string,
  variant: Variant,
  options: { readonly dbFile?: string } = {},
): World {
  const seedToday = parseSeed(seedJson).today;
  const clock = testClock(seedToday);
  // In memory unless a test needs the database as a file (the backup jobs open it by path).
  const db = openDatabase(options.dbFile ?? ":memory:");
  migrate(db, loadMigrations(packageMigrationsDir));
  const uow = createUnitOfWork(db);
  const buildIds = deterministicIds(1_700_000_000_000, 1);
  let current: IdGenerator = buildIds;
  const newId: IdGenerator = <B extends string>() => current<B>();

  const applied = applySeed(uow, { clock, newId }, seedJson);
  const people = {
    a: applied.people["person-a"] as PersonViewer["personId"],
    b: applied.people["person-b"] as PersonViewer["personId"],
  };
  linkLogin(db, "user-a", people.a, "A");
  linkLogin(db, "user-b", people.b, "B");

  const ctx = (who: Who): UseCaseContext => ({
    viewer: personViewer(people[who], clock.now()),
    clock,
    newId,
    uow,
  });

  // Shared data both partners see; identical in every world.
  const b = ctx("b");
  const shared = sharedProbeData(db, b, people.a);

  if (variant === "delta") applyDelta(db, ctx("a"), people.a, shared);

  const deps: AppDeps = {
    systemHealth: createSystemHealthRepo(db),
    uow,
    clock,
    newId,
    tokens: nodeTokens,
    codes: recoveryCodeHasher("privacy-suite-secret"),
    publicUrl: ORIGIN,
    authn: {
      kind: "live",
      gateway: gateway(clock, { "session=user-a": "user-a", "session=user-b": "user-b" }),
    },
    healthz: {
      expectedSchemaVersion: loadMigrations(packageMigrationsDir).length,
      runner: "skip",
    },
  };
  const app = createApp(deps);
  const privateIds = collectPrivateIds(db, people.a);

  const ok = (entity: Entity, slot = 0): string => {
    const id = shared[entity]?.[slot];
    if (id === undefined) throw new Error(`The harness has no ${entity} (slot ${slot}) for B`);
    return id;
  };

  return {
    variant,
    db,
    uow,
    clock,
    people,
    privateIds,
    ok,
    ctx,
    startRequestIds: () => {
      current = deterministicIds(REQUEST_IDS_AT, REQUEST_IDS_SEED);
    },
    request: (who, method, path, body) => requestVia(app, who, method, path, body),
    dump: () => dumpTables(db),
    app,
    deps,
    close: () => db.close(),
  };
}

/** The leaks the deliberate-leak group injects. */
export type LeakMode =
  | "list"
  | "by-id"
  | "by-id-write"
  | "hidden-name"
  | "redact-identity"
  | "classification"
  | "review-items"
  | "leave-hidings";

type Repos = {
  accounts: Pick<AccountRepo, "findVisible" | "list">;
  transactions: Pick<TransactionRepo, "findVisible" | "listVisible">;
  payees: Pick<PayeeRepo, "list">;
  tags: Pick<TagRepo, "list">;
  payeeAliases: Pick<PayeeAliasRepo, "list">;
  activities: Pick<ActivityRepo, "list">;
  reviewItems: Pick<ReviewItemRepo, "listOpenFor">;
};

/**
 * Wraps repositories so partner B is served as if the privacy filter were missing. A read for B
 * is answered as partner A (the same as dropping `visibleAccounts`, `visibleScope` or
 * `visibleReviewItems`):
 *   list            account and transaction lists
 *   by-id           account and transaction reads by id
 *   by-id-write     by-id, and the transaction writes too, so B's write on A's id succeeds
 *   hidden-name     transaction reads, so A's hidden names are not projected away
 *   classification  payee, tag, alias and activity lists
 *   review-items    the review inbox
 *   redact-identity a hidden flag is never rendered (the placeholder is missing)
 *   leave-hidings   the household leave does not lift the leaver's hidings
 * Test support: it exists to prove the suite fails on each.
 */
function tamperRepos<R extends Repos>(repos: R, mode: LeakMode, a: PersonViewer): R {
  const lift = (viewer: Viewer): Viewer =>
    viewer.kind === "person" && viewer.personId !== a.personId ? a : viewer;
  const when = (...modes: LeakMode[]) => modes.includes(mode);
  const unrendered = (row: VisibleTransaction): VisibleTransaction => ({
    ...row,
    nameHidden: false,
  });
  const accounts: Repos["accounts"] = {
    ...repos.accounts,
    list: (viewer) => repos.accounts.list(when("list") ? lift(viewer) : viewer),
    findVisible: (viewer, id) =>
      repos.accounts.findVisible(when("by-id", "by-id-write") ? lift(viewer) : viewer, id),
  };
  const writes: Partial<TransactionRepo> = {};
  const inner = repos.transactions as Partial<TransactionRepo>;
  if (when("by-id-write") && inner.softDelete && inner.update && inner.setNameHidden) {
    const { softDelete, update, setNameHidden } = inner;
    writes.softDelete = (viewer, id, at) => softDelete(lift(viewer), id, at);
    writes.update = (viewer, row) => update(lift(viewer), row);
    writes.setNameHidden = (viewer, ...rest) => setNameHidden(lift(viewer), ...rest);
  }
  if (when("leave-hidings") && inner.clearNameHidden) writes.clearNameHidden = () => 0;
  const transactions = {
    ...repos.transactions,
    ...writes,
    listVisible: (viewer: Viewer, today: string) => {
      if (when("list", "hidden-name")) return repos.transactions.listVisible(lift(viewer), today);
      const rows = repos.transactions.listVisible(viewer, today);
      return mode === "redact-identity" ? rows.map(unrendered) : rows;
    },
    findVisible: (viewer: Viewer, id: string, today: string) => {
      if (when("by-id", "by-id-write", "hidden-name")) {
        return repos.transactions.findVisible(lift(viewer), id, today);
      }
      const row = repos.transactions.findVisible(viewer, id, today);
      return mode === "redact-identity" && row !== undefined ? unrendered(row) : row;
    },
  };
  const scoped = (viewer: Viewer) => (when("classification") ? lift(viewer) : viewer);
  return {
    ...repos,
    accounts,
    transactions,
    payees: { ...repos.payees, list: (v: Viewer) => repos.payees.list(scoped(v)) },
    tags: { ...repos.tags, list: (v: Viewer) => repos.tags.list(scoped(v)) },
    payeeAliases: {
      ...repos.payeeAliases,
      list: (v: Viewer) => repos.payeeAliases.list(scoped(v)),
    },
    activities: { ...repos.activities, list: (v: Viewer) => repos.activities.list(scoped(v)) },
    reviewItems: {
      ...repos.reviewItems,
      listOpenFor: (v: Viewer) => repos.reviewItems.listOpenFor(when("review-items") ? lift(v) : v),
    },
  } as R;
}

function tamperUow(uow: UnitOfWork, mode: LeakMode, a: PersonViewer): UnitOfWork {
  return {
    transaction: (fn) => uow.transaction((tx) => fn(tamperRepos(tx, mode, a))),
    read: (fn) => uow.read((repos) => fn(tamperRepos(repos, mode, a))),
  };
}

/**
 * The same world served through a deliberately leaky app and use-case context. It shares the
 * world's database, so a leak that writes changes the real data.
 */
export function leakyWorld(world: World, mode: LeakMode): World {
  const viewerA = personViewer(world.people.a, world.clock.now());
  const uow = tamperUow(world.uow, mode, viewerA);
  const deps: AppDeps = { ...world.deps, uow };
  const app = createApp(deps);
  return {
    ...world,
    app,
    deps,
    ctx: (who) => ({ ...world.ctx(who), uow }),
    request: (who, method, path, body) => requestVia(app, who, method, path, body),
  };
}

async function requestVia(
  app: ReturnType<typeof createApp>,
  who: Who,
  method: string,
  path: string,
  body?: unknown,
): Promise<Captured> {
  const response = await app.request(path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: COOKIES[who] },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, text: await response.text() };
}

/** Every table's rows in rowid order, as one string. */
export function dumpTables(db: Db): string {
  const tables = column(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return tables
    .map((name) => {
      const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
      return `${name}: ${JSON.stringify(rows)}`;
    })
    .join("\n");
}

type Shared = Partial<Record<Entity, string[]>>;

/** What B may use in requests: shared rows, B's own private rows and household settings. */
function sharedProbeData(db: Db, b: UseCaseContext, aId: string): Shared {
  const accounts = listAccounts(b);
  const joint = accounts.find((account) => account.name === "Joint everyday");
  const jointSavings = accounts.find((account) => account.name === "Joint savings");
  if (joint === undefined || jointSavings === undefined)
    throw new Error("The seed has no joint accounts");
  const first = createTransaction(b, {
    accountId: joint.id,
    postedOn: "2026-07-10",
    amountCents: -5000,
    description: "Shared probe one",
  });
  const second = createTransaction(b, {
    accountId: jointSavings.id,
    postedOn: "2026-07-10",
    amountCents: 5000,
    description: "Shared probe two",
  });
  const view = setSplits(b, {
    transactionId: first,
    splits: [{ amountCents: -3000 }, { amountCents: -2000 }],
  });
  const group = createTransferGroup(b, { transactionIds: [first, second] });
  const woolworths = listPayees(b).find((payee) => payee.name === "Woolworths");
  const holiday = listTags(b).find((tag) => tag.name === "Holiday");
  if (woolworths === undefined || holiday === undefined)
    throw new Error("The seed lacks its payee");
  const alias = createPayeeAlias(b, {
    payeeId: woolworths.id,
    pattern: "WOOLIES",
    matchKind: "contains",
  });
  const activity = createActivity(b, { name: "Shared probe activity" });
  // Shared rows A's private data later points at, for the cross-scope cascades.
  const gapPayee = createPayee(b, { name: "Gap probe payee" });
  const gapCategory = createCategory(b, {
    groupId: listCategoryGroups(b)[0]?.id as string,
    name: "Gap probe category",
  });
  const privateB = accounts.find((account) => account.isPrivate);
  if (privateB === undefined) throw new Error("B has no private account");
  const categories = listCategories(b);
  const bPrivateTxn = createTransaction(b, {
    accountId: privateB.id,
    postedOn: "2026-07-10",
    amountCents: -700,
    description: "B private probe",
  });
  setSplitField(b, {
    transactionId: bPrivateTxn,
    splitId: (getTransaction(b, { id: bPrivateTxn }).splits[0] as { id: string }).id,
    field: "category",
    value: categories[0]?.id as string,
  });
  raiseItems(b, joint.id, privateB.id);
  const groupId = group[0].transferGroupId;
  const notice = b.uow.read((repos) =>
    repos.reviewItems
      .listOpenFor(b.viewer)
      .find((item) => item.personId === privateB.owners[0]?.personId),
  );
  return {
    account: [joint.id, jointSavings.id, privateB.id],
    transaction: [first, second],
    split: [view.splits[0]?.id as string],
    payee: [woolworths.id, gapPayee.id],
    tag: [holiday.id],
    alias: [alias.id],
    activity: [activity.id],
    transferGroup: [groupId as string, mixedGroup(db, aId)],
    category: [categories[0]?.id as string, gapCategory.id],
    categoryGroup: [listCategoryGroups(b)[0]?.id as string],
    taxCategory: [listTaxCategories(b)[0]?.id as string],
    institution: [listInstitutions(b)[0]?.id as string],
    notice: [notice?.id as string],
  };
}

/** A transfer group seeded between a shared account and a private account of `a`. */
function mixedGroup(db: Db, a: string): string {
  const id = db
    .prepare(
      `SELECT t.transfer_group_id FROM "transaction" t
         JOIN account acc ON acc.id = t.account_id
         JOIN "transaction" o ON o.transfer_group_id = t.transfer_group_id AND o.id <> t.id
         JOIN account oacc ON oacc.id = o.account_id
        WHERE acc.is_private = 0 AND oacc.is_private = 1 AND t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM account_owner w WHERE w.account_id = oacc.id AND w.person_id = ?)
        ORDER BY t.transfer_group_id LIMIT 1`,
    )
    .pluck()
    .get(a) as string | undefined;
  if (id === undefined)
    throw new Error("The seed has no transfer between a shared account and A's private one");
  return id;
}

function raiseItems(b: UseCaseContext, jointId: string, privateId: string): void {
  write(b, (tx, audit) => {
    raiseReviewItem(tx, audit, b, {
      kind: HOUSEHOLD_ITEM_REVIEW,
      entityRef: "probe:household",
      dedupeKey: "privacy-suite:household",
    });
    raiseReviewItem(tx, audit, b, {
      kind: ACCOUNT_ITEM_REVIEW,
      entityRef: "probe:joint",
      dedupeKey: "privacy-suite:joint",
      accountId: jointId,
    });
    raiseReviewItem(tx, audit, b, {
      kind: ACCOUNT_ITEM_REVIEW,
      entityRef: "probe:b-private",
      dedupeKey: "privacy-suite:b-private",
      accountId: privateId,
    });
    raiseReviewItem(tx, audit, b, {
      kind: PERSON_ITEM_REVIEW,
      entityRef: "probe:b-person",
      dedupeKey: "privacy-suite:b-person",
      personId: (b.viewer as { personId: string }).personId,
    });
  });
}

/** Partner A's private delta: nothing in it is visible to B. */
function applyDelta(db: Db, a: UseCaseContext, aId: string, shared: Shared) {
  const owner = [{ personId: aId, shareBp: 10_000 }];
  const make = (name: string, type: "transaction" | "savings") =>
    createAccount(a, { name, type, currency: "AUD", isPrivate: true, owners: owner });
  const cash = make(A_NAMES.account, "transaction");
  const savings = make(A_NAMES.renamedFrom, "savings");
  const closed = make("Delta closed private", "transaction");
  const deleted = make("Delta deleted private", "transaction");

  const tag = createTag(a, { name: A_NAMES.tag, originAccountId: cash });
  const payee = createPayee(a, { name: A_NAMES.payee, originAccountId: cash });
  createPayeeAlias(a, {
    payeeId: payee.id,
    pattern: A_NAMES.alias,
    matchKind: "contains",
    originAccountId: cash,
  });
  createActivity(a, { name: A_NAMES.activity, originAccountId: cash });
  const category = listCategories(a)[0]?.id as string;
  // A's private rows that point at shared ones: an owner-only alias on a shared payee, and an
  // owner-only payee whose default is a shared category.
  createPayeeAlias(a, {
    payeeId: shared.payee?.[1] as string,
    pattern: "DELTA ON SHARED",
    matchKind: "contains",
    originAccountId: cash,
  });
  createPayee(a, {
    name: "Delta Payee with shared default",
    defaultCategoryId: shared.category?.[1] as string,
    originAccountId: cash,
  });

  const line = (accountId: string, amountCents: number, description: string, payeeId?: string) =>
    createTransaction(a, {
      accountId,
      postedOn: "2026-07-12",
      amountCents,
      description,
      ...(payeeId === undefined ? {} : { payeeId }),
    });
  const t1 = line(cash, -4200, "Delta secret one", payee.id);
  const t2 = line(cash, -1800, "Delta secret two");
  const t3 = line(savings, 4200, "Delta secret three");
  line(closed, -100, "Delta secret closed");
  line(deleted, -900, "Delta secret deleted account");
  const view = setSplits(a, {
    transactionId: t1,
    splits: [{ amountCents: -2000, categoryId: category }, { amountCents: -2200 }],
  });
  setSplitTags(a, {
    transactionId: t1,
    splitId: view.splits[0]?.id as string,
    tagIds: [tag.id],
  });
  createTransferGroup(a, { transactionIds: [t1, t3] });
  recordBalanceSnapshot(a, { accountId: cash, asOf: "2026-07-01", balanceCents: 123_456 });
  recordBalanceSnapshot(a, { accountId: savings, asOf: "2026-07-01", balanceCents: 654_321 });
  updateAccount(a, { id: savings, name: A_NAMES.renamedTo });
  updateAccount(a, { id: closed, closedOn: "2026-07-13" });
  deleteTransaction(a, { id: t2 });

  // Every other write a person can make on private data, so each one's audit row is checked.
  setSplitField(a, {
    transactionId: t1,
    splitId: view.splits[1]?.id as string,
    field: "category",
    value: category,
  });
  updateTransaction(a, { id: t1, notes: "Delta note" });
  const t6 = line(cash, -300, "Delta secret six");
  const t7 = line(savings, 300, "Delta secret seven");
  const second = createTransferGroup(a, { transactionIds: [t6, t7] });
  deleteTransferGroup(a, { id: second[0].transferGroupId as string });
  const flip = make("Delta flipped private", "transaction");
  setPrivacy(a, { id: flip, isPrivate: false });
  setPrivacy(a, { id: flip, isPrivate: true });
  closeAccount(a, { id: flip, closedOn: "2026-07-13" });
  const tagTwo = createTag(a, { name: "Delta Tag two", originAccountId: cash });
  updateTag(a, { id: tagTwo.id, name: "Delta Tag two renamed" });
  deleteTag(a, { id: tagTwo.id });
  const payeeTwo = createPayee(a, { name: "Delta Payee two", originAccountId: cash });
  updatePayee(a, { id: payeeTwo.id, name: "Delta Payee two renamed", defaultCategoryId: category });
  const aliasTwo = createPayeeAlias(a, {
    payeeId: payeeTwo.id,
    pattern: "DELTA TWO",
    matchKind: "exact",
    originAccountId: cash,
  });
  updatePayeeAlias(a, { id: aliasTwo.id, pattern: "DELTA TWO RENAMED" });
  const aliasThree = createPayeeAlias(a, {
    payeeId: payeeTwo.id,
    pattern: "DELTA THREE",
    matchKind: "exact",
    originAccountId: cash,
  });
  deletePayeeAlias(a, { id: aliasThree.id });
  deletePayee(a, { id: payeeTwo.id });
  const activityTwo = createActivity(a, { name: "Delta Activity two", originAccountId: cash });
  updateActivity(a, { id: activityTwo.id, name: "Delta Activity two renamed" });
  deleteActivity(a, { id: activityTwo.id });
  // A hiding of A's, on a public account of A's alone that then turned private: B never saw the
  // account's rows, and the hiding outlives the switch (AD-4).
  const hiding = createAccount(a, {
    name: "Delta hiding account",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: owner,
  });
  const hidden = createTransaction(a, {
    accountId: hiding,
    postedOn: "2026-07-12",
    amountCents: -250,
    description: "Delta secret hidden",
  });
  hideTransactionName(a, { id: hidden, until: a.clock.today().add({ days: 90 }).toString() });
  // A private account has no split for anyone else: the split is A's.
  setSplitField(a, {
    transactionId: hidden,
    splitId: getTransaction(a, { id: hidden }).splits[0]?.id as string,
    field: "beneficiary",
    value: aId,
  });
  setPrivacy(a, { id: hiding, isPrivate: true });
  db.prepare("UPDATE account SET deleted_at = ?, updated_at = ? WHERE id = ?").run(
    "2026-07-14T00:00:00.000Z",
    "2026-07-14T00:00:00.000Z",
    deleted,
  );
  write(a, (tx, audit) => {
    raiseReviewItem(tx, audit, a, {
      kind: ACCOUNT_ITEM_REVIEW,
      entityRef: "probe:a-private",
      dedupeKey: "privacy-suite:a-private",
      accountId: cash,
    });
    raiseReviewItem(tx, audit, a, {
      kind: PERSON_ITEM_REVIEW,
      entityRef: "probe:a-person",
      dedupeKey: "privacy-suite:a-person",
      personId: aId,
    });
  });
  return { cash, savings, closed, deleted };
}

/** The ids a request names: the slot under test gets `target`, every other slot something B may use. */
export function slotIds(
  world: World,
  entity: Entity | undefined,
  aimedSlot: number,
  target: string,
): SlotId {
  return (wanted, slot = 0) =>
    wanted === entity && slot === aimedSlot ? target : world.ok(wanted, slot);
}

/** What a drill world ran after its backup: nothing, a drill that passes, one that fails, or both. */
export type DrillOutcome = "backup only" | "passed" | "failed" | "passed then failed";

/** A world with a backup and, per its outcome, restore drills, on a private account of A's. */
export interface DrillWorld extends World {
  /** The restic snapshot the backup stored; a drill restored it. */
  readonly snapshotId: string;
  /** The drill's stored verdicts, oldest first. */
  readonly verifications: () => { kind: string; ok: number; summary: string }[];
}

/** The amounts of the private account's transactions in each flavour: one row, or five. */
const DRILL_AMOUNTS = {
  one: [-1000],
  two: [-778_777, -2501, -3502, -4503, -5504],
} as const;
/** What the stored copy's private account is altered by, so its sum no longer matches. */
export const DRILL_TAMPER_CENTS = 3_131_313;

/**
 * Builds a world on a database file, gives A a private account whose transactions (their number
 * and amounts) depend on `flavour`, backs the database up to a stub restic repository and then
 * runs what `outcome` says. A failing drill follows the stored copy's private account being
 * altered, so its manifest check fails. The returned world's app has the backup configured, so
 * `/api/system/backup` reports the verdict. `viewer` is the system viewer the backup request runs
 * as (`systemViewer("cli:backup")`); the caller builds it, as only the jobs, the admin entry and
 * tests may (AD-6). `dir` plus `flavour` must be a new directory for each world.
 */
export async function drillWorld(
  seedJson: string,
  flavour: "one" | "two",
  dir: string,
  viewer: Viewer,
  outcome: DrillOutcome,
): Promise<DrillWorld> {
  const root = join(dir, flavour);
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const world = buildWorld(seedJson, "base", { dbFile: join(dataDir, "pangolin.sqlite") });
  // The private rows mint their ids from a generator of their own. The world's generator is a
  // monotonic counter, so five rows in one world and one in the other would shift every id the
  // backup mints after them; a real id is random and carries no such signal (see
  // `normaliseRequestIds`). Only the number of rows differs between the worlds, not the ids B reads.
  const a = { ...world.ctx("a"), newId: deterministicIds(1_750_000_000_000, 3) };
  const owner = [{ personId: world.people.a, shareBp: 10_000 }];
  const account = createAccount(a, {
    name: "Drill probe private",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    owners: owner,
  });
  for (const amountCents of DRILL_AMOUNTS[flavour]) {
    createTransaction(a, {
      accountId: account,
      postedOn: "2026-07-12",
      amountCents,
      description: "Drill probe",
    });
  }
  const rig = createDrillRig({
    dataDir,
    stubDir: join(root, "stub"),
    uow: world.uow,
    clock: world.clock,
    newId: world.ctx("a").newId,
    viewer,
  });
  const runner = rig.runner();
  const snapshotId = await rig.backUp(runner);
  if (outcome === "passed" || outcome === "passed then failed") {
    await rig.run(runner, BACKUP_DRILL_JOB);
  }
  if (outcome === "failed" || outcome === "passed then failed") {
    const stored = openDatabase(rig.storedDatabase(snapshotId));
    stored
      .prepare('UPDATE "transaction" SET amount_cents = amount_cents + ? WHERE account_id = ?')
      .run(DRILL_TAMPER_CENTS, account);
    stored.close();
    await rig.run(runner, BACKUP_DRILL_JOB);
  }
  const deps: AppDeps = { ...world.deps, backupConfigured: true };
  const app = createApp(deps);
  return {
    ...world,
    app,
    deps,
    snapshotId,
    request: (who, method, path, body) => requestVia(app, who, method, path, body),
    verifications: () =>
      world.db
        .prepare("SELECT kind, ok, summary FROM backup_verification ORDER BY at, rowid")
        .all() as { kind: string; ok: number; summary: string }[],
  };
}

/** A world whose restore drill failed: the entry 17 world. */
export const failedDrillWorld = (
  seedJson: string,
  flavour: "one" | "two",
  dir: string,
  viewer: Viewer,
): Promise<DrillWorld> => drillWorld(seedJson, flavour, dir, viewer, "failed");

/** Where a stand-in drill world puts a figure of the whole database back. */
export type DrillLeak = "summary-count" | "audit-digest";

/**
 * A stand-in for a product that stores a figure of the whole database again: a row count in the
 * success summary (stored verdict and its audit row), or the digest of the transactions in a
 * `backup_snapshot` audit row. It writes through the world's own database, as a product bug would
 * through the job, so every place B reads the backup shows it.
 */
export function leakyDrillWorld(world: DrillWorld, leak: DrillLeak): DrillWorld {
  const db = world.db;
  if (leak === "summary-count") {
    const rows = db.prepare('SELECT count(*) FROM "transaction"').pluck().get() as number;
    const add = `, ${rows} transactions`;
    db.prepare("UPDATE backup_verification SET summary = summary || ?").run(add);
    db.prepare(
      "UPDATE audit_log SET after = json_set(after, '$.summary', json_extract(after, '$.summary') || ?) WHERE entity = 'backup_verification'",
    ).run(add);
  } else {
    const digest = createHash("sha256")
      .update(JSON.stringify(db.prepare('SELECT * FROM "transaction" ORDER BY rowid').all()))
      .digest("hex");
    db.prepare(
      "UPDATE audit_log SET after = json_set(after, '$.manifestSha256', ?) WHERE entity = 'backup_snapshot'",
    ).run(digest);
  }
  return world;
}
