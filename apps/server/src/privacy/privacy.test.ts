// The server-side privacy suite (AD-3, AD-4, AD-5, AD-17, AD-18): across the whole API, partner B
// cannot learn anything from partner A's private data, and no route can ship without a privacy
// entry. It runs under `pnpm test` in CI.
//
// Two worlds are built from the same seed, ids and clock; they differ only in A's private delta.
// Each assertion is a function that returns its problems, so the "deliberate leak" group can run
// the same function against a leaky app and require that it reports one.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hiddenLabel,
  listAccounts,
  listAudit,
  listReviewItems,
  redact,
  type Viewer,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import {
  A_NAMES,
  buildWorld,
  type Captured,
  DRILL_TAMPER_CENTS,
  type DrillLeak,
  type DrillOutcome,
  type DrillWorld,
  drillWorld,
  failedDrillWorld,
  type LeakMode,
  leakyDrillWorld,
  leakyWorld,
  nonexistentId,
  normaliseRequestIds,
  ORIGIN,
  slotIds,
  type Variant,
  type World,
} from "./privacy-harness.ts";
import {
  type Flavour,
  type HiddenRun,
  hiddenNameScenario,
  LEAVE_HIDDEN_NAME,
  type LeaveRun,
  leaveScenario,
  type Observe,
  type Step,
  type SwitchRun,
  switchScenario,
  type View,
} from "./privacy-scenarios.ts";
import {
  apiRoutes,
  type Entity,
  MANIFEST,
  type ManifestEntry,
  manifestProblems,
  type PersonEntry,
  PRIVATE_ENTITIES,
  personEntries,
  routeKey,
  type SlotId,
} from "./route-manifest.ts";

// Each test builds worlds and makes hundreds of in-process HTTP calls.
const SLOW_MS = 120_000;
vi.setConfig({ testTimeout: SLOW_MS, hookTimeout: SLOW_MS });

// ------------------------------------------------------------------------------ assertions

const fill = (path: string, ids: Record<string, string>): string =>
  path.replace(/:([A-Za-z]+)/g, (_, name: string) => ids[name] ?? `:${name}`);

/** The filters and paging B's transaction reads are replayed with (ids B may use in this world). */
const TRANSACTION_QUERIES = (world: World): string[] => [
  "page=1",
  "hidden=true",
  "uncategorised=true",
  "transfers=true",
  "type=in",
  "type=out",
  "minCents=1&maxCents=100000",
  "from=2000-01-01&to=2100-01-01",
  `account=${world.ok("account")}`,
  `payee=${world.ok("payee")}`,
  `tag=${world.ok("tag")}`,
  `category=${world.ok("category")}`,
];

/** Every `GET` route that returns person data, as B sees it, keyed by route and ids. */
async function readTranscript(world: World): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of personEntries().filter((e) => e.method === "GET")) {
    const params = Object.entries(entry.params ?? {});
    // An account route is replayed on a shared account, a second one and B's own private one.
    const variants = params.some(([, e]) => e === "account") ? [0, 1, 2] : [0];
    for (const slot of variants) {
      const ids = Object.fromEntries(params.map(([name, e]) => [name, world.ok(e, slot)]));
      const path = fill(entry.path, ids);
      const res = await world.request("b", "GET", path);
      out.set(`GET ${path}`, normaliseRequestIds(`${res.status} ${res.text}`));
    }
  }
  // B's filtered and paged reads of the transaction list, whose query the manifest does not carry:
  // each narrows by something A's private data could change (a hidden name, a payee or tag, a
  // type, an amount, a paging position), so the paired worlds must still read the same.
  for (const query of TRANSACTION_QUERIES(world)) {
    const path = `/api/ledger/transactions?${query}`;
    const res = await world.request("b", "GET", path);
    out.set(`GET ${path}`, normaliseRequestIds(`${res.status} ${res.text}`));
  }
  const b = world.ctx("b");
  out.set("use case listAudit(B)", normaliseRequestIds(JSON.stringify(listAudit(b))));
  out.set(
    "use case redact(listReviewItems(B))",
    normaliseRequestIds(JSON.stringify(redact(b.viewer, listReviewItems(b)))),
  );
  return out;
}

/** Differences between B's view in two worlds: any is a leak of what only A's data differs by. */
function identicalProblems(left: Map<string, string>, right: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const l = left.get(key);
    const r = right.get(key);
    if (l !== r) problems.push(`${key} differs between the worlds`);
  }
  return problems;
}

interface Body {
  readonly label: string;
  readonly entities: readonly Entity[];
  readonly body: ((id: SlotId) => unknown) | undefined;
}

/** Every body a route accepts; the first carries the path's entities too. */
function bodies(entry: PersonEntry): Body[] {
  return [
    { label: "", entities: entry.bodyEntities ?? [], body: entry.body },
    ...(entry.altBodies ?? []).map((alt, i) => ({
      label: ` (body ${i + 2})`,
      entities: alt.bodyEntities,
      body: alt.body,
    })),
  ];
}

interface AimPoint {
  readonly name: string;
  readonly entity: Entity;
  readonly slot: number;
  readonly body: Body;
}

/** Each place a route takes a private id: every slot of every private entity in each body. */
function aimPoints(entry: PersonEntry): AimPoint[] {
  const out: AimPoint[] = [];
  bodies(entry).forEach((body, i) => {
    const named = [...(i === 0 ? Object.values(entry.params ?? {}) : []), ...body.entities];
    for (const entity of new Set(named)) {
      if (!PRIVATE_ENTITIES.includes(entity)) continue;
      for (let slot = 0; slot < (entry.slots?.[entity] ?? 1); slot++) {
        const where = slot === 0 ? "" : ` #${slot + 1}`;
        out.push({
          name: `${routeKey(entry)} with ${entity}${where}${body.label}`,
          entity,
          slot,
          body,
        });
      }
    }
  });
  return out;
}

async function send(world: World, entry: PersonEntry, at: AimPoint, target: string) {
  const id = slotIds(world, at.entity, at.slot, target);
  const params = Object.fromEntries(
    Object.entries(entry.params ?? {}).map(([name, e]) => [name, id(e)]),
  );
  return world.request("b", entry.method, fill(entry.path, params), at.body.body?.(id));
}

/**
 * B aims every route at every id of A's private data, in every slot that takes one: each must
 * answer 404 with the body it gives for a well-formed id that never existed, and nothing may
 * change. `readsOnly` skips the writes. Also returns what it aimed at, so a test can require full
 * coverage in the same breath.
 */
async function notFoundProblems(
  world: World,
  readsOnly = false,
): Promise<{ problems: string[]; probed: Set<string> }> {
  const problems: string[] = [];
  const probed = new Set<string>();
  const before = world.dump();
  for (const entry of personEntries()) {
    if (readsOnly && entry.access === "write") continue;
    for (const at of aimPoints(entry)) {
      const { name } = at;
      const reference = await send(world, entry, at, nonexistentId());
      if (reference.status !== 404) {
        problems.push(`${name}: the reference request answered ${reference.status}, not 404`);
        continue;
      }
      for (const id of world.privateIds[at.entity as keyof World["privateIds"]]) {
        const res = await send(world, entry, at, id);
        probed.add(name);
        if (res.status !== 404) problems.push(`${name} ${id}: answered ${res.status}, not 404`);
        else if (res.text !== reference.text) problems.push(`${name} ${id}: 404 body differs`);
      }
    }
  }
  if (!readsOnly && world.dump() !== before) problems.push("a refused request changed the data");
  return { problems, probed };
}

/** Every aim point the writes and reads together should have reached. */
const expectedAimPoints = (readsOnly = false): string[] =>
  personEntries()
    .filter((entry) => !readsOnly || entry.access === "read")
    .flatMap((entry) => aimPoints(entry).map((at) => at.name));

const sameSet = (left: Iterable<string>, right: Iterable<string>) =>
  expect([...left].sort()).toEqual([...right].sort());

/** B's open review items, redacted, in both worlds: equal, and none of A's account or person items. */
function reviewItemProblems(w1: World, w2: World): string[] {
  const problems: string[] = [];
  const seen = (w: World) => {
    const b = w.ctx("b");
    return redact(b.viewer, listReviewItems(b));
  };
  const left = seen(w1);
  const right = seen(w2);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    problems.push("B's review items differ between the worlds");
  }
  for (const item of [...left, ...right]) {
    if (item.entityRef.startsWith("probe:a-")) {
      problems.push(`B sees A's review item ${item.entityRef}`);
    }
  }
  const refs = right.map((item) => item.entityRef).sort();
  const wanted = ["probe:b-person", "probe:b-private", "probe:household", "probe:joint"];
  if (refs.join() !== wanted.join()) problems.push(`B's review items are ${refs.join()}`);
  return problems;
}

/** What `redact` is when it does nothing. */
const identityRedact: typeof redact = (_viewer, rows) => [...rows];

/** Responses with the opaque ids B's own requests minted named by order (see the harness). */
const sameBytes = (responses: Captured[]) =>
  responses.map((r) => ({ status: r.status, text: normaliseRequestIds(r.text) }));

/** Whether a `Captured` body holds `text`. */
const has = (res: Captured, text: string): boolean => res.text.includes(text);

/**
 * A hides a shared transaction's name on the test clock. B sees "Hidden until <date>", and no real
 * text, until the day before; on the date B sees the real name. Re-hiding restarts the clock.
 */
async function hiddenNameProblems(
  world: World,
  redactRows: typeof redact = redact,
): Promise<string[]> {
  const problems: string[] = [];
  const id = world.ok("transaction");
  const path = `/api/ledger/transactions/${id}`;
  const real = "Shared probe one";
  const start = world.clock.today().toString();
  const until = world.clock.today().add({ days: 30 }).toString();
  const hid = await world.request("a", "PUT", `${path}/name-hidden`, { until });
  if (hid.status !== 200) return [`A could not hide the name: ${hid.status} ${hid.text}`];
  let label = hiddenLabel(until);

  /** What B sees of the transaction on `day`: its name as text, from the read and from the list. */
  const check = async (day: string, shows: "label" | "real") => {
    world.clock.set(day);
    for (const url of [path, "/api/ledger/transactions"]) {
      const res = await world.request("b", "GET", url);
      const where = `${url} on ${day}`;
      let body: {
        transaction?: { descriptionRaw: string | null };
        transactions?: { id: string; descriptionRaw: string | null }[];
      };
      try {
        if (res.status !== 200) throw new Error(`status ${res.status}`);
        body = JSON.parse(res.text);
      } catch (error) {
        problems.push(`${where}: B's read failed (${String(error)}): ${res.text.slice(0, 80)}`);
        continue;
      }
      const seen = (body.transaction ?? body.transactions?.find((t) => t.id === id))
        ?.descriptionRaw;
      if (shows === "label") {
        if (seen !== label)
          problems.push(`${where}: B does not see "${label}", but ${JSON.stringify(seen)}`);
        if (has(res, real)) problems.push(`${where}: B sees the real name`);
      } else if (seen !== real) {
        problems.push(
          `${where}: B does not see the real name on the lift day, but ${JSON.stringify(seen)}`,
        );
      }
    }
    if (shows === "label") {
      const b = world.ctx("b");
      const rows = b.uow.read((repos) => repos.audit.listVisible(b.viewer, day));
      const audit = JSON.stringify(redactRows(b.viewer as Viewer, rows));
      if (audit.includes(real)) problems.push(`audit log on ${day}: B sees the real name`);
      if (!audit.includes(label)) problems.push(`audit log on ${day}: B does not see "${label}"`);
    }
  };
  await check(start, "label");
  await check(prior(until), "label");
  await check(until, "real");

  // Re-hiding restarts the clock: from the lift day, hide again for the 12-month maximum.
  world.clock.set(until);
  const again = await world.request("a", "PUT", `${path}/name-hidden`, {});
  if (again.status !== 200) return [...problems, `A could not re-hide: ${again.status}`];
  let max: string;
  try {
    max = JSON.parse(again.text).transaction.nameHiddenUntil as string;
  } catch {
    return [...problems, `the re-hide answered something unreadable: ${again.text.slice(0, 80)}`];
  }
  const expectedMax = world.clock.today().add({ months: 12 }).toString();
  if (max.slice(0, 10) !== expectedMax) problems.push(`re-hiding ends ${max}, not ${expectedMax}`);
  label = hiddenLabel(expectedMax);
  await check(until, "label");
  await check(prior(expectedMax), "label");
  await check(expectedMax, "real");
  return problems;
}

/** The day before a `YYYY-MM-DD` day. */
function prior(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Account-scoped entities must carry the `accountId` of the account they belong to in every audit
 * row, and a scoped classification row must carry its person (and its private origin account).
 */
/** Entities that belong to an account: every audit row of one must carry its `accountId`. */
const ACCOUNT_SCOPED = [
  "account",
  "transaction",
  "balance_snapshot",
  "split",
  "split_tag",
  "transfer_group",
];
/** Entities the worlds write audit rows for, so checking them cannot pass vacuously. */
const AUDITED = [
  "account",
  "transaction",
  "balance_snapshot",
  "review_item",
  "payee",
  "tag",
  "payee_alias",
  "activity",
];

function auditProblems(world: World): string[] {
  const problems: string[] = [];
  const rows = world.db.prepare("SELECT * FROM audit_log ORDER BY rowid").all() as {
    id: string;
    entity: string;
    entity_id: string;
    account_id: string | null;
    person_id: string | null;
    before: string | null;
    after: string | null;
  }[];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.entity, (counts.get(row.entity) ?? 0) + 1);
  for (const entity of AUDITED) {
    if (!counts.get(entity))
      problems.push(`no audit rows for ${entity}: the check would be vacuous`);
  }
  const accountOf = (sql: string, id: string): string | null | undefined =>
    (world.db.prepare(sql).pluck().get(id) as string | null | undefined) ?? undefined;
  const state = (row: (typeof rows)[number]) =>
    JSON.parse(row.after ?? row.before ?? "{}") as Record<string, unknown>;
  for (const row of rows) {
    const where = `audit ${row.entity} ${row.entity_id} (${row.id})`;
    if (ACCOUNT_SCOPED.includes(row.entity)) {
      if (row.account_id === null) problems.push(`${where} has no accountId`);
    }
    if (row.entity === "transaction" && row.account_id !== null) {
      const account = accountOf('SELECT account_id FROM "transaction" WHERE id = ?', row.entity_id);
      if (account !== undefined && account !== row.account_id) {
        problems.push(`${where} carries another account's id`);
      }
    }
    if (row.entity === "account" && row.account_id !== row.entity_id) {
      problems.push(`${where} carries another account's id`);
    }
    if (row.entity === "review_item" && state(row).accountId != null && row.account_id === null) {
      problems.push(`${where} has no accountId`);
    }
    if (["payee", "tag", "activity", "payee_alias"].includes(row.entity)) {
      if (state(row).scopePersonId != null && row.person_id === null) {
        problems.push(`${where} is owner-only but carries no personId`);
      }
      const origin = accountOf(
        `SELECT origin_account_id FROM ${row.entity} WHERE id = ?`,
        row.entity_id,
      );
      if (origin != null && row.account_id !== origin) {
        problems.push(`${where} has a private origin account but carries no accountId`);
      }
    }
  }
  return problems;
}

// ------------------------------------------------------------------------------------ worlds

let seedDir: string;
let seedJson: string;
const worlds: World[] = [];

function world(variant: Variant): World {
  const built = buildWorld(seedJson, variant);
  worlds.push(built);
  return built;
}

beforeAll(() => {
  seedDir = mkdtempSync(join(tmpdir(), "pangolin-privacy-"));
  const file = join(seedDir, "seed.json");
  generateSeedFile(file);
  seedJson = readFileSync(file, "utf8");
});

afterAll(() => {
  for (const built of worlds.splice(0)) built.close();
  rmSync(seedDir, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------- tests

describe("the route manifest", () => {
  let w: World;
  beforeAll(() => {
    w = world("base");
  });

  it("has an entry for every registered /api route and no stale entry", () => {
    expect(manifestProblems(w.app.routes)).toEqual([]);
  });

  it("reads the routes from the app, expanding app.on and dropping middleware", () => {
    const keys = apiRoutes(w.app.routes).map(routeKey);
    expect(keys).toContain("GET /api/auth/*");
    expect(keys).toContain("POST /api/auth/*");
    expect(keys).toContain("PUT /api/ledger/transactions/:id/name-hidden");
    expect(keys.some((key) => key.startsWith("ALL "))).toBe(false);
    expect(keys.some((key) => key.includes("/healthz"))).toBe(false);
  });

  it("fails naming a route added without an entry", () => {
    const routes = [...w.app.routes, { method: "GET", path: "/api/ledger/new-thing" }];
    expect(manifestProblems(routes)).toEqual([
      "Route GET /api/ledger/new-thing has no privacy manifest entry",
    ]);
  });

  it("fails on an entry that has no route", () => {
    const stale: ManifestEntry = {
      kind: "exempt",
      method: "GET",
      path: "/api/gone",
      reason: "Removed.",
    };
    expect(manifestProblems(w.app.routes, [...MANIFEST, stale])).toEqual([
      "Manifest entry GET /api/gone has no route (stale)",
    ]);
  });

  it("fails when a route ships under a pending entry, so search, export and audit need real ones", () => {
    const pending = MANIFEST.filter((entry) => entry.kind === "pending");
    expect(pending.map(routeKey).sort()).toEqual([
      "GET /api/ledger/export",
      "GET /api/system/audit",
    ]);
    for (const entry of pending) {
      const routes = [...w.app.routes, { method: entry.method, path: entry.path }];
      expect(manifestProblems(routes)).toEqual([
        expect.stringContaining(`${routeKey(entry)} is registered`),
      ]);
    }
  });

  it("fails on an app.all or a data route that the manifest would drop", () => {
    for (const route of [
      { method: "ALL", path: "/api/ledger/sneaky" },
      { method: "GET", path: "/data/export" },
    ]) {
      expect(manifestProblems([...w.app.routes, route])).toEqual([
        expect.stringContaining(`${route.method} ${route.path} is dropped`),
      ]);
    }
  });

  it("fails on a person entry whose path params and declared params differ", () => {
    const entry = (path: string, params?: Record<string, Entity>): ManifestEntry => ({
      kind: "person",
      method: "GET",
      path,
      access: "read",
      ...(params === undefined ? {} : { params }),
    });
    const route = (path: string) => [{ method: "GET", path }];
    expect(manifestProblems(route("/api/x/:id"), [entry("/api/x/:id")])).toEqual([
      "GET /api/x/:id: path params (id) do not match declared params ()",
    ]);
    expect(manifestProblems(route("/api/x"), [entry("/api/x", { id: "account" })])).toEqual([
      "GET /api/x: path params () do not match declared params (id)",
    ]);
  });

  it("needs a written reason on every exemption, pending entry and known gap", () => {
    const blankIdentity: ManifestEntry = {
      kind: "identity",
      method: "POST",
      path: "/api/y",
      reason: "",
    };
    expect(manifestProblems([{ method: "POST", path: "/api/y" }], [blankIdentity])).toEqual([
      "POST /api/y: identity entries need a written reason",
    ]);
    const blank: ManifestEntry = { kind: "exempt", method: "GET", path: "/api/x", reason: " " };
    expect(manifestProblems([{ method: "GET", path: "/api/x" }], [blank])).toEqual([
      "GET /api/x: exempt entries need a written reason",
    ]);
    const gaps = personEntries().flatMap((entry) => entry.knownGaps ?? []);
    expect(gaps).toHaveLength(2);
  });
});

describe("partner B against partner A's private data", () => {
  let w1: World;
  let w2: World;
  beforeAll(() => {
    w1 = world("base");
    w2 = world("delta");
  });

  it("builds worlds that differ only in A's private data", () => {
    expect(w1.privateIds.account.length).toBeLessThan(w2.privateIds.account.length);
    expect(w2.privateIds.account.length).toBeGreaterThanOrEqual(5);
    for (const key of Object.keys(w2.privateIds) as (keyof World["privateIds"])[]) {
      expect(w2.privateIds[key].length, key).toBeGreaterThanOrEqual(w1.privateIds[key].length);
    }
    expect(w2.privateIds.payee.length).toBeGreaterThan(w1.privateIds.payee.length);
    expect(w1.dump()).not.toBe(w2.dump());
  });

  it("answers B's GET routes with identical bytes when only A's private data changes", async () => {
    const left = await readTranscript(w1);
    const right = await readTranscript(w2);
    expect(left.size).toBeGreaterThan(20);
    expect(identicalProblems(left, right)).toEqual([]);
    // The probe would be empty if B could not see anything.
    expect(left.get("GET /api/accounts")).toContain("Joint everyday");
  });

  it("gives B the same response in both worlds for writes that collide with A's names", async () => {
    w1.startRequestIds();
    w2.startRequestIds();
    // Every name here is one A holds in the delta world: live, renamed, old, or freed by a delete.
    const cases = (w: World) =>
      [
        [
          "rename onto A's renamed payee name",
          "PATCH",
          `/api/classify/payees/${w.ok("payee", 1)}`,
          { name: "Delta Payee two renamed" },
          200,
        ],
        [
          "payee with A's scoped payee name",
          "POST",
          "/api/classify/payees",
          { name: A_NAMES.payee },
          201,
        ],
        [
          "payee with A's soft-deleted payee name",
          "POST",
          "/api/classify/payees",
          { name: "Delta Payee two" },
          201,
        ],
        [
          "tag with A's soft-deleted tag name",
          "POST",
          "/api/classify/tags",
          { name: "Delta Tag two" },
          201,
        ],
        [
          "tag with A's renamed tag name",
          "POST",
          "/api/classify/tags",
          { name: "Delta Tag two renamed" },
          201,
        ],
        [
          "activity with A's soft-deleted activity name",
          "POST",
          "/api/classify/activities",
          { name: "Delta Activity two" },
          201,
        ],
        [
          "rename onto A's scoped tag",
          "PATCH",
          `/api/classify/tags/${w.ok("tag")}`,
          { name: A_NAMES.tag },
          200,
        ],
        [
          "rename onto A's scoped activity",
          "PATCH",
          `/api/classify/activities/${w.ok("activity")}`,
          { name: A_NAMES.activity },
          200,
        ],
        [
          "alias with A's alias pattern",
          "POST",
          "/api/classify/payees/aliases",
          { payeeId: w.ok("payee"), pattern: A_NAMES.alias, matchKind: "contains" },
          201,
        ],
        [
          "alias with A's payee name as pattern",
          "POST",
          "/api/classify/payees/aliases",
          { payeeId: w.ok("payee"), pattern: A_NAMES.payee, matchKind: "contains" },
          201,
        ],
        ...[A_NAMES.account, A_NAMES.renamedFrom, A_NAMES.renamedTo].map((name) => [
          `account named ${name}`,
          "POST",
          "/api/accounts",
          {
            name,
            type: "transaction",
            currency: "AUD",
            isPrivate: true,
            owners: [{ personId: w.people.b, shareBp: 10_000 }],
          },
          201,
        ]),
      ] as [string, string, string, unknown, number][];
    const results: Captured[][] = [];
    for (const w of [w1, w2]) {
      const out: Captured[] = [];
      for (const [, method, path, body] of cases(w))
        out.push(await w.request("b", method, path, body));
      results.push(out);
    }
    const [left, right] = results as [Captured[], Captured[]];
    cases(w1).forEach(([name, , , , status], i) => {
      expect(left[i]?.status, `${name} (world 1)`).toBe(status);
      expect(right[i]?.status, `${name} (world 2)`).toBe(status);
    });
    expect(sameBytes(right)).toEqual(sameBytes(left));
    // After the writes B's reads are still identical to each other.
    expect(identicalProblems(await readTranscript(w1), await readTranscript(w2))).toEqual([]);
  });

  it("lists nothing, the same as for an id that never existed, when B filters by A's private ids", async () => {
    const w = w2;
    const aimed = {
      account: w.privateIds.account,
      payee: w.privateIds.payee,
      tag: w.privateIds.tag,
    };
    expect(aimed.account.length).toBeGreaterThan(0);
    expect(aimed.payee.length).toBeGreaterThan(0);
    expect(aimed.tag.length).toBeGreaterThan(0);
    for (const [param, ids] of Object.entries(aimed)) {
      const reference = await w.request(
        "b",
        "GET",
        `/api/ledger/transactions?${param}=${nonexistentId()}`,
      );
      expect(reference.status).toBe(200);
      expect(JSON.parse(reference.text).page.total).toBe(0);
      for (const id of ids) {
        const res = await w.request("b", "GET", `/api/ledger/transactions?${param}=${id}`);
        expect(`${param} ${res.status} ${res.text}`).toBe(
          `${param} ${reference.status} ${reference.text}`,
        );
      }
    }
  });

  it("answers 404, the same as for a nonexistent id, for every id of A's private data", async () => {
    for (const w of [w2, w1]) {
      const { problems, probed } = await notFoundProblems(w);
      expect(problems).toEqual([]);
      // The delta world holds every kind of private data, so every route that takes an id was
      // aimed at every private kind and slot it names; the base world has fewer kinds.
      if (w === w2) {
        expect(expectedAimPoints().length).toBeGreaterThan(30);
        sameSet(probed, expectedAimPoints());
      }
    }
  });

  it("has an id of every private kind to aim at", () => {
    for (const entity of PRIVATE_ENTITIES) {
      expect(w2.privateIds[entity as keyof World["privateIds"]].length, entity).toBeGreaterThan(0);
    }
  });

  it("shows B the same review items in both worlds, with A's account and person items absent", () => {
    expect(reviewItemProblems(w1, w2)).toEqual([]);
    // A sees its own, so the difference is real.
    const a2 = listReviewItems(w2.ctx("a")).map((item) => item.entityRef);
    expect(a2).toEqual(
      expect.arrayContaining(["probe:a-private", "probe:a-person", "probe:household"]),
    );
  });

  it("keeps a private account closed with a balance to A: B's accounts, reviews and responses are unchanged", async () => {
    // A's delta closes a private account holding -100: a warning on its view and an open item.
    const aItems = listReviewItems(w2.ctx("a")).filter(
      (item) => item.kind === "accounts.closing-balance",
    );
    expect(aItems).toHaveLength(1);
    const accountId = aItems[0]?.accountId as string;
    expect(aItems[0]?.entityRef).toBe(`account:${accountId}`);
    const mine = listAccounts(w2.ctx("a"), { includeClosed: true }).find(
      (row) => row.id === accountId,
    );
    expect(mine?.warning).toEqual({ kind: "closing-balance", balanceCents: -100 });
    // B sees neither the item, the account nor a warning, and the two worlds answer alike.
    for (const w of [w1, w2]) {
      const b = w.ctx("b");
      expect(listReviewItems(b).filter((item) => item.kind === "accounts.closing-balance")).toEqual(
        [],
      );
      for (const includeClosed of [false, true]) {
        expect(listAccounts(b, { includeClosed }).some((row) => row.id === accountId)).toBe(false);
        expect(listAccounts(b, { includeClosed }).some((row) => row.warning !== undefined)).toBe(
          false,
        );
      }
    }
    for (const includeClosed of [false, true]) {
      expect(JSON.stringify(listAccounts(w2.ctx("b"), { includeClosed }))).toBe(
        JSON.stringify(listAccounts(w1.ctx("b"), { includeClosed })),
      );
    }
    for (const path of ["/api/accounts", "/api/accounts?includeClosed=true"]) {
      const [l1, l2] = [await w1.request("b", "GET", path), await w2.request("b", "GET", path)];
      expect(l1.status, path).toBe(200);
      expect(l2.status, path).toBe(200);
      expect(l2.text, path).toBe(l1.text);
      expect(l2.text, path).not.toContain(accountId);
    }
    const get = (w: World) => w.request("b", "GET", `/api/accounts/${accountId}`);
    const [r1, r2] = [await get(w1), await get(w2)];
    expect(r2.status).toBe(404);
    expect(r1.status).toBe(r2.status);
    expect(r1.text).toBe(r2.text);
  });

  it("writes an accountId on every audit row of an account-scoped entity", () => {
    expect(auditProblems(w1)).toEqual([]);
    expect(auditProblems(w2)).toEqual([]);
  });

  it("reports an audit row that has no accountId", () => {
    const w = world("delta");
    const txn = w.privateIds.transaction[0] as string;
    w.db
      .prepare(
        "UPDATE audit_log SET account_id = NULL WHERE entity = 'transaction' AND entity_id = ?",
      )
      .run(txn);
    expect(auditProblems(w).some((p) => p.includes("has no accountId"))).toBe(true);
  });
});

describe("hidden names", () => {
  it("lifts on the test clock: a placeholder until the day before, the real name on the day", async () => {
    const w = world("base");
    expect(await hiddenNameProblems(w)).toEqual([]);
  });

  it("refuses a hiding longer than 12 months", async () => {
    const w = world("base");
    const path = `/api/ledger/transactions/${w.ok("transaction")}/name-hidden`;
    const tooLong = w.clock.today().add({ months: 12, days: 1 }).toString();
    expect((await w.request("a", "PUT", path, { until: tooLong })).status).toBe(400);
  });
});

describe("a deliberate leak", () => {
  let w1: World;
  let w2: World;
  beforeAll(() => {
    w1 = world("base");
    w2 = world("delta");
  });

  const leaky = (w: World, mode: LeakMode) => leakyWorld(w, mode);

  it("is caught as a list leak: B's lists differ between the worlds", async () => {
    const left = await readTranscript(leaky(w1, "list"));
    const right = await readTranscript(leaky(w2, "list"));
    const problems = identicalProblems(left, right);
    expect(problems).toContain("GET /api/accounts differs between the worlds");
    expect(problems).toContain("GET /api/ledger/transactions differs between the worlds");
  });

  it("is caught as a by-id leak: B reads an id of A's private data", async () => {
    const { problems } = await notFoundProblems(leaky(w2, "by-id"), true);
    expect(problems.some((p) => p.startsWith("GET /api/accounts/:id with account"))).toBe(true);
    expect(
      problems.some((p) => p.startsWith("GET /api/ledger/transactions/:id with transaction")),
    ).toBe(true);
  });

  it("is caught as a by-id write leak: B's write on A's id succeeds and the data changes", async () => {
    const { problems } = await notFoundProblems(leaky(world("delta"), "by-id-write"));
    expect(
      problems.some((p) =>
        /^DELETE \/api\/ledger\/transactions\/:id with transaction .*not 404$/.test(p),
      ),
    ).toBe(true);
    expect(problems).toContain("a refused request changed the data");
  });

  it("is caught as a scoped classification list leak: B's payees and tags differ", async () => {
    const left = await readTranscript(leaky(w1, "classification"));
    const right = await readTranscript(leaky(w2, "classification"));
    const problems = identicalProblems(left, right);
    expect(problems).toContain("GET /api/classify/payees differs between the worlds");
    expect(problems).toContain("GET /api/classify/tags differs between the worlds");
  });

  it("is caught as a review-item leak: A's account-scoped items reach B", () => {
    const problems = reviewItemProblems(leaky(w1, "review-items"), leaky(w2, "review-items"));
    expect(problems).toContain("B sees A's review item probe:a-private");
    expect(problems).toContain("B sees A's review item probe:a-person");
    expect(problems).toContain("B's review items differ between the worlds");
  });

  it("is caught as a hidden-name leak: B sees the real name", async () => {
    const problems = await hiddenNameProblems(leaky(world("base"), "hidden-name"));
    expect(problems.some((p) => p.endsWith("B sees the real name"))).toBe(true);
  });

  it("is caught when a hidden flag is never rendered: B sees null, not the placeholder", async () => {
    const problems = await hiddenNameProblems(leaky(world("base"), "redact-identity"));
    expect(problems.some((p) => /does not see "Hidden until [^"]+", but null$/.test(p))).toBe(true);
  });

  it("is caught when redact is the identity on audit rows: the placeholder is missing", async () => {
    const problems = await hiddenNameProblems(world("base"), identityRedact);
    expect(
      problems.some((p) => /^audit log on .*: B does not see "Hidden until [^"]+"$/.test(p)),
    ).toBe(true);
  });

  it("passes the same assertions on the real app", async () => {
    expect(identicalProblems(await readTranscript(w1), await readTranscript(w2))).toEqual([]);
    expect((await notFoundProblems(w2, true)).problems).toEqual([]);
    expect(reviewItemProblems(w1, w2)).toEqual([]);
  });
});

describe("cross-scope cascades left for a product decision, and the closed transfer-group route", () => {
  let w1: World;
  let w2: World;
  beforeAll(() => {
    w1 = world("base");
    w2 = world("delta");
  });

  it("show B nothing of A's private data, though they reach A's rows", async () => {
    const results: Captured[][] = [];
    for (const w of [w1, w2]) {
      w.startRequestIds();
      const out: Captured[] = [];
      out.push(await w.request("b", "DELETE", `/api/classify/payees/${w.ok("payee", 1)}`));
      out.push(await w.request("b", "DELETE", `/api/classify/categories/${w.ok("category", 1)}`));
      out.push(
        await w.request("b", "DELETE", `/api/ledger/transfer-groups/${w.ok("transferGroup", 1)}`),
      );
      out.push(
        await w.request(
          "b",
          "PUT",
          `/api/ledger/transactions/${w.ok("transaction", 1)}/name-hidden`,
          {},
        ),
      );
      results.push(out);
    }
    const [left, right] = results as [Captured[], Captured[]];
    // The transfer-group delete is refused (NotFound): the group reaches A's private account.
    expect(left.map((r) => r.status)).toEqual([200, 200, 404, 200]);
    expect(sameBytes(right)).toEqual(sameBytes(left));
    expect(identicalProblems(await readTranscript(w1), await readTranscript(w2))).toEqual([]);
    expect(auditProblems(w2)).toEqual([]);
    // The refused group delete left A's private side linked.
    const stillLinked = w2.db
      .prepare(
        `SELECT COUNT(*) FROM "transaction" t JOIN account a ON a.id = t.account_id
         WHERE a.is_private = 1 AND t.transfer_group_id = ?`,
      )
      .pluck()
      .get(w2.ok("transferGroup", 1));
    expect(stillLinked).toBeGreaterThan(0);
    // The remaining gaps are real: A's alias on the shared payee went with it, and A's payee lost its default.
    const aliasGone = w2.db
      .prepare("SELECT deleted_at FROM payee_alias WHERE pattern = 'DELTA ON SHARED'")
      .pluck()
      .get();
    expect(aliasGone).toEqual(expect.any(String));
    const defaultCleared = w2.db
      .prepare(
        "SELECT default_category_id FROM payee WHERE name = 'Delta Payee with shared default'",
      )
      .pluck()
      .get();
    expect(defaultCleared).toBeNull();
  });
});

// ------------------------------------------------------------------------- paired scenarios
//
// Each scenario runs in two worlds that differ in one thing B must never learn (the `Flavour`):
// at every checkpoint B's reads (every GET route, the transaction as the repository gives it, the
// audit log) must be byte-identical, and the steps must answer the same in both worlds. The
// assertions after that name what a revert of a fix would break.

type Seen = Map<string, Map<string, string>>;

/** Everything B can read at a checkpoint: all GET routes, the `view`'s paths and the repo rows. */
async function viewOf(world: World, view: View): Promise<Map<string, string>> {
  const out = await readTranscript(world);
  for (const path of view.paths) {
    const res = await world.request("b", "GET", path);
    out.set(`GET ${path}`, normaliseRequestIds(`${res.status} ${res.text}`));
  }
  const b = world.ctx("b");
  const today = world.clock.today().toString();
  for (const id of view.transactionIds) {
    const row = b.uow.read((repos) => repos.transactions.findVisible(b.viewer, id, today));
    out.set(`repo findVisible(B, ${id})`, normaliseRequestIds(JSON.stringify(row ?? null)));
  }
  return out;
}

const FLAVOURS: readonly Flavour[] = ["one", "two"];

interface Pair<R> {
  readonly worlds: [World, World];
  readonly seen: [Seen, Seen];
  readonly runs: [R, R];
}

/** Builds two worlds and runs `scenario` in each, one flavour apiece, recording B's checkpoints. */
async function runPair<R>(
  scenario: (world: World, flavour: Flavour, observe: Observe) => Promise<R>,
  build: (variant: Variant) => World = world,
): Promise<Pair<R>> {
  const worlds: [World, World] = [build("base"), build("base")];
  const seen: [Seen, Seen] = [new Map(), new Map()];
  const runs: R[] = [];
  for (const i of [0, 1] as const) {
    const w = worlds[i];
    runs.push(
      await scenario(w, FLAVOURS[i] as Flavour, async (label, view) => {
        seen[i].set(label, await viewOf(w, view));
      }),
    );
  }
  return { worlds, seen, runs: runs as [R, R] };
}

/** Differences in what B read at each checkpoint of the two worlds. */
function checkpointProblems(seen: [Seen, Seen]): string[] {
  const [left, right] = seen;
  const labels = new Set([...left.keys(), ...right.keys()]);
  return [...labels].flatMap((label) => {
    const l = left.get(label);
    const r = right.get(label);
    if (l === undefined || r === undefined) return [`${label}: missing in one world`];
    return identicalProblems(l, r).map((problem) => `${label}: ${problem}`);
  });
}

/** What a step answered: its status and body, with B's own minted ids named by order. */
const outcomes = (steps: Step[]) =>
  steps.map((s) => ({ name: s.name, status: s.status, text: normaliseRequestIds(s.text) }));

/** The audit rows B may read, as `listAudit(B)` returns them (redacted). */
function auditSeenByB(w: World) {
  return listAudit(w.ctx("b"));
}

describe("a hidden description and payee on a shared imported transaction", () => {
  let pair: Pair<HiddenRun>;
  beforeAll(async () => {
    pair = await runPair(hiddenNameScenario);
  });

  it("gives B the same reads in both worlds, before and after B edits, splits, tags and deletes it", () => {
    expect([...pair.seen[0].keys()]).toEqual([
      "hidden row, before B writes",
      "hidden row, after B's edits",
      "hidden row, after B's delete",
    ]);
    expect(checkpointProblems(pair.seen)).toEqual([]);
    // The probe is not empty: B reads the hidden row, as a placeholder.
    const before = pair.seen[0].get("hidden row, before B writes");
    const key = `GET /api/ledger/transactions/${pair.runs[0].ids.transactionId}`;
    expect(before?.get(key)).toContain("Hidden until");
  });

  it("answers B's writes on the hidden row the same way in both worlds", () => {
    const [left, right] = pair.runs;
    expect(outcomes(right.steps)).toEqual(outcomes(left.steps));
    expect(left.steps.map((s) => [s.name, s.status])).toEqual([
      ["B edits the notes", 200],
      ["B splits it", 200],
      ["B sets a category", 200],
      ["B tags a split", 200],
      ["B deletes it", 204],
    ]);
  });

  it("never shows B the description, payee, fingerprint or external ID of the row", () => {
    pair.runs.forEach((run, i) => {
      const { ids } = run;
      for (const [label, reads] of pair.seen[i] as Seen) {
        // The audit branch below is keyed by name: a rename must not silently skip it.
        expect(reads.has("use case listAudit(B)"), `${label}: listAudit(B) is in the reads`).toBe(
          true,
        );
        for (const [key, text] of reads) {
          // The payee list is shared, so a payee's name and id are fair game there.
          const about = key.startsWith("GET /api/ledger") || key.startsWith("repo findVisible");
          const secrets = [ids.description, ids.fingerprint, ids.externalId];
          if (about) secrets.push(ids.payeeId);
          if (key === "use case listAudit(B)") {
            // Other audit rows (the payee's own creation) name the payee; this row's must not.
            const rows = auditSeenByB(pair.worlds[i] as World).filter(
              (r) => r.entity === "transaction" && r.entityId === ids.transactionId,
            );
            expect(JSON.stringify(rows), `${label}: ${key}`).not.toContain(ids.payeeId);
          }
          for (const secret of secrets) {
            expect(text.includes(secret), `${label}: ${key} holds ${secret}`).toBe(false);
          }
        }
      }
    });
  });

  it("keeps the stored description and payee in the audit row of every write on it, B's included", () => {
    pair.runs.forEach((run, i) => {
      const w = pair.worlds[i] as World;
      const { ids } = run;
      const rows = w.db
        .prepare(
          "SELECT actor, action, before, after FROM audit_log WHERE entity = 'transaction' AND entity_id = ? ORDER BY rowid",
        )
        .all(ids.transactionId) as {
        actor: string;
        action: string;
        before: string | null;
        after: string | null;
      }[];
      const problems: string[] = [];
      let named = 0;
      for (const row of rows) {
        for (const json of [row.before, row.after]) {
          if (json === null) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch {
            continue;
          }
          if (typeof parsed !== "object" || parsed === null || !("descriptionRaw" in parsed)) {
            continue;
          }
          const state = parsed as { descriptionRaw: unknown; payeeId: unknown };
          named++;
          if (state.descriptionRaw !== ids.description) {
            problems.push(
              `${row.actor} ${row.action}: description ${String(state.descriptionRaw)}`,
            );
          }
          if (state.payeeId !== ids.payeeId) {
            problems.push(`${row.actor} ${row.action}: payee ${String(state.payeeId)}`);
          }
        }
      }
      // create, hide, B's four edits and the delete each carry a state; B wrote five of them.
      expect(named).toBeGreaterThanOrEqual(12);
      expect(rows.filter((r) => r.actor === `person:${w.people.b}`).length).toBeGreaterThanOrEqual(
        5,
      );
      expect(problems).toEqual([]);
    });
  });

  it("fails closed on audit rows of unusual shape: no key added, nothing raw passed through", () => {
    pair.runs.forEach((run, i) => {
      const w = pair.worlds[i] as World;
      const { ids } = run;
      const label = hiddenLabel(w.clock.today().add({ days: 90 }).toString());
      const rows = auditSeenByB(w).filter(
        (r) => r.entity === "transaction" && r.entityId === ids.transactionId,
      );
      // A bare string and an array holding the description come back as the placeholder, never
      // as themselves.
      expect(rows.filter((r) => r.before === null && r.after === label)).toHaveLength(2);
      // An object with no name keys is not given one.
      expect(rows.some((r) => r.after === '{"unrelated":1}')).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(ids.description);
    });
  });
});

describe("a deliberate leak in the hidden-row worlds", () => {
  it("is caught: with the hidden names lifted, B's reads differ between the worlds", async () => {
    const pair = await runPair(hiddenNameScenario, (variant) =>
      leakyWorld(world(variant), "hidden-name"),
    );
    const problems = checkpointProblems(pair.seen);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes("repo findVisible"))).toBe(true);
  });
});

describe("owner changes and privacy switches", () => {
  let pair: Pair<SwitchRun>;
  beforeAll(async () => {
    pair = await runPair(switchScenario);
  });

  it("gives B the same reads in both worlds at every checkpoint", () => {
    expect(pair.seen[0].size).toBe(11);
    expect(checkpointProblems(pair.seen)).toEqual([]);
  });

  it("answers each step as the rules say, and the same in both worlds", () => {
    const [left, right] = pair.runs;
    expect(outcomes(right.steps).map(({ name, status }) => ({ name, status }))).toEqual(
      outcomes(left.steps).map(({ name, status }) => ({ name, status })),
    );
    expect(left.steps.map((s) => [s.name, s.status])).toEqual([
      ["B strips A from the joint account", 200],
      ["A tries to take it back", 400],
      ["A rejoins it", 200],
      ["A removes themself from it", 200],
      ["A joins it again", 200],
      ["B removes A again", 200],
      ["B takes the split", 200],
      ["B makes it private", 200],
      ["B makes it public", 200],
      ["A makes the private account public while it uses a private activity", 409],
      ["A clears the activity", 200],
      ["A makes the private account public", 200],
      ["A puts a private activity on a public split", 409],
      ["A sets a private activity through setSplits", 409],
      ["B hides a name on an account B does not own", 400],
      ["A makes it private while a split is shared", 409],
      ["A gives the split to B", 200],
      ["A makes it private while a split is B's", 409],
      ["A takes the split", 200],
      ["A makes it private", 200],
      ["A makes it public", 200],
    ]);
  });

  it("keeps a hidden name hidden through owner changes and a switch to private and back", () => {
    pair.runs.forEach((run, i) => {
      const id = run.ids.hiddenTransaction;
      for (const checkpoint of ["joint account private", "joint account public again"]) {
        const reads = (pair.seen[i] as Seen).get(checkpoint) as Map<string, string>;
        for (const key of [`GET /api/ledger/transactions/${id}`, `repo findVisible(B, ${id})`]) {
          const text = reads.get(key) ?? "";
          // The route renders the placeholder; the repository gives the flag and a null name.
          const hidden = key.startsWith("GET") ? "Hidden until" : '"nameHidden":true';
          expect(text, `${checkpoint}: ${key}`).toContain(hidden);
          expect(text, `${checkpoint}: ${key}`).not.toContain("Switch probe one hidden");
          expect(text, `${checkpoint}: ${key}`).not.toContain("Switch probe two hidden");
        }
      }
    });
  });

  it("scopes the private era's audit rows to their owner and leaves the joint era's to both", () => {
    pair.runs.forEach((run, i) => {
      const w = pair.worlds[i] as World;
      const { ids } = run;
      const tuple = (r: { entity: string; entityId: string; action: string }) =>
        `${r.entity} ${r.entityId} ${r.action}`;
      const forB = auditSeenByB(w);
      // The private account was created private: B reads its switch to public, nothing before.
      expect(
        forB.filter((r) => r.accountId === ids.privateAccount).map(tuple),
        "private account",
      ).toEqual([`account ${ids.privateAccount} set_privacy`]);
      // The public account's joint era stays visible; its private era does not.
      expect(forB.filter((r) => r.accountId === ids.flipped).map(tuple), "flipped account").toEqual(
        [
          `account ${ids.flipped} create`,
          `transaction ${ids.flippedTransaction} create`,
          `transaction ${ids.flippedTransaction} update`,
          `transaction ${ids.flippedTransaction} update`,
          `account ${ids.flipped} set_privacy`,
          `account ${ids.flipped} set_privacy`,
        ],
      );
      expect(JSON.stringify(forB)).not.toContain(ids.privateEraTransaction);
      expect(JSON.stringify(forB)).not.toContain("private era");
      // A reads all of it, so the difference is real.
      const forA = listAudit(w.ctx("a"));
      expect(forA.filter((r) => r.entityId === ids.privateEraTransaction).length).toBeGreaterThan(
        0,
      );
      expect(forA.filter((r) => r.accountId === ids.privateAccount).length).toBeGreaterThan(1);
    });
  });
});

/**
 * The restic snapshot id is readable by decision (recorded in the epic file, 2026-10-06: the id
 * stays readable so a backup can be chosen to restore), and restic makes it random, so it differs
 * between the worlds. It is an accepted exposure: masked here by name, only the ids this world stored (a 64-hex id, and the
 * 8-character short id the drill's summary names). Every other byte is compared, so a digest or
 * any other hex string put back stays visible.
 */
function maskResticIds(w: World, text: string): string {
  let out = normaliseRequestIds(text);
  const ids = w.db.prepare("SELECT restic_snapshot_id FROM backup_snapshot").pluck().all();
  for (const id of ids as (string | null)[]) {
    if (id === null || id.length < 8) continue;
    out = out
      .replaceAll(id, "<restic id>")
      .replaceAll(`snapshot ${id.slice(0, 8)}`, "snapshot <id>");
  }
  return out;
}

/** The raw backup audit rows, as stored. */
const backupAuditRows = (w: World) =>
  w.db
    .prepare(
      "SELECT actor, entity, action, account_id, person_id, before, after FROM audit_log WHERE entity LIKE 'backup%' ORDER BY rowid",
    )
    .all();

/** B's reads and the backup's stored verdicts, rows, audit rows and review items, ids masked. */
async function drillView(w: DrillWorld): Promise<Map<string, string>> {
  const out = new Map(
    [...(await readTranscript(w))].map(([key, text]) => [key, maskResticIds(w, text)]),
  );
  const backup = await w.request("b", "GET", "/api/system/backup");
  out.set("GET /api/system/backup", maskResticIds(w, `${backup.status} ${backup.text}`));
  out.set("stored verdicts", maskResticIds(w, JSON.stringify(w.verifications())));
  out.set(
    "stored backups",
    maskResticIds(w, JSON.stringify(w.db.prepare("SELECT * FROM backup_snapshot").all())),
  );
  out.set("backup audit rows", maskResticIds(w, JSON.stringify(backupAuditRows(w))));
  const b = w.ctx("b");
  out.set("review items", maskResticIds(w, JSON.stringify(redact(b.viewer, listReviewItems(b)))));
  return out;
}

/**
 * The only words a drill's stored verdict, in a row or an audit row, may say: the checks the
 * product can name, and the snapshot's 8-character short id. (No world here runs the repository
 * check, so its success words are not listed.)
 */
const VERDICT_SUMMARIES = [
  /^restored snapshot [0-9a-f]{8} and verified the restore$/,
  /^the (manifest|integrity|schema|restore|repository) check failed( on snapshot [0-9a-f]{8})?$/,
];

/**
 * Where a count or a digest of the whole database has been put back in what B reads of the backup:
 * a figure-shaped key or word, a verdict that says more than the fixed words, or a 64-hex string
 * that is not a stored restic snapshot id.
 */
async function drillFigureProblems(w: DrillWorld): Promise<string[]> {
  const problems: string[] = [];
  const b = w.ctx("b");
  const rows = listAudit(b).filter((r) => r.entity.startsWith("backup"));
  const backup = await w.request("b", "GET", "/api/system/backup");
  const stored = w.db.prepare("SELECT * FROM backup_snapshot").all();
  const read = JSON.stringify([rows, backup.text, stored, w.verifications(), backupAuditRows(w)]);
  if (/table_?count|row_?count|manifest_?sha256|\btables?\b|\brows\b/i.test(read)) {
    problems.push("a count or digest key is stored where B reads the backup");
  }
  const ids = new Set(w.db.prepare("SELECT restic_snapshot_id FROM backup_snapshot").pluck().all());
  for (const hex of read.match(/\b[0-9a-f]{64}\b/g) ?? []) {
    if (!ids.has(hex)) problems.push(`${hex} is not a restic snapshot id`);
  }
  const audited = w.db
    .prepare(
      "SELECT json_extract(after, '$.summary') FROM audit_log WHERE entity = 'backup_verification'",
    )
    .pluck()
    .all() as string[];
  const summaries = [...w.verifications().map((v) => v.summary), ...audited];
  for (const summary of summaries) {
    if (!VERDICT_SUMMARIES.some((pattern) => pattern.test(summary))) {
      problems.push(`the verdict "${summary}" says more than the fixed words`);
    }
  }
  return problems;
}

describe("a failed restore drill", () => {
  let dir: string;
  let drills: [DrillWorld, DrillWorld];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-privacy-drill-"));
    drills = [
      await failedDrillWorld(seedJson, "one", dir, systemViewer("cli:backup")),
      await failedDrillWorld(seedJson, "two", dir, systemViewer("cli:backup")),
    ];
    for (const d of drills) worlds.push(d);
  }, SLOW_MS); // builds several worlds, each seeded and backed up: slow on a busy runner

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails the manifest check in both worlds, and the stored summary names only the check", () => {
    for (const d of drills) {
      const [verdict, ...rest] = d.verifications();
      expect(rest).toEqual([]);
      expect(verdict?.kind).toBe("drill");
      expect(verdict?.ok).toBe(0);
      expect(maskResticIds(d, verdict?.summary ?? "")).toBe(
        "the manifest check failed on snapshot <id>",
      );
    }
  });

  it("shows B the same stored verdict, /api/system/backup, audit rows and reads in both worlds", async () => {
    const [left, right] = [await drillView(drills[0]), await drillView(drills[1])];
    expect(left.get("GET /api/system/backup")).toContain("the manifest check failed");
    expect(identicalProblems(left, right)).toEqual([]);
  });

  it("stores no row or table count and no manifest digest where B reads the backup", async () => {
    for (const d of drills) {
      const b = d.ctx("b");
      const rows = listAudit(b).filter((r) => r.entity.startsWith("backup"));
      expect(rows.length).toBeGreaterThan(0);
      const backup = await d.request("b", "GET", "/api/system/backup");
      const stored = d.db.prepare("SELECT * FROM backup_snapshot").all();
      const read = JSON.stringify([rows, backup.text, stored, d.verifications()]);
      expect(read).not.toMatch(/table_?count|row_?count|manifest_?sha256|\btables?\b|\brows\b/i);
      // Every 64-hex string is a restic snapshot id.
      const ids = new Set(
        d.db.prepare("SELECT restic_snapshot_id FROM backup_snapshot").pluck().all(),
      );
      for (const hex of read.match(/\b[0-9a-f]{64}\b/g) ?? []) expect(ids.has(hex)).toBe(true);
    }
  });

  it("keeps the private account's id and figures out of every place the verdict reaches", async () => {
    for (const [i, d] of drills.entries()) {
      const account = d.db
        .prepare("SELECT id FROM account WHERE name = 'Drill probe private'")
        .pluck()
        .get() as string;
      const reads = await drillView(d);
      // The verdict's own places: the backup status, the stored rows, the audit rows, the inbox.
      const verdict = [...reads]
        .filter(([key]) => !key.startsWith("GET /api/") || key === "GET /api/system/backup")
        .filter(([key]) => !key.startsWith("use case"))
        .map(([, text]) => text)
        .join("\n");
      // Every private amount, their sum, and the sums the tampered copy holds.
      const amounts = d.db
        .prepare('SELECT amount_cents FROM "transaction" WHERE account_id = ?')
        .pluck()
        .all(account) as number[];
      const sum = amounts.reduce((total, cents) => total + cents, 0);
      const tampered = sum + DRILL_TAMPER_CENTS * amounts.length;
      const figures = [
        ...amounts,
        sum,
        tampered,
        DRILL_TAMPER_CENTS,
        DRILL_TAMPER_CENTS - Math.abs(sum),
      ].map((cents) => Math.abs(cents));
      expect(amounts.length, `world ${i + 1} private rows`).toBe(i === 0 ? 1 : 5);
      for (const figure of figures) {
        expect(verdict.includes(String(figure)), `world ${i + 1} shows ${figure}`).toBe(false);
      }
      expect(verdict.includes(" cents"), `world ${i + 1} shows cents`).toBe(false);
      // The account's id appears nowhere B reads, the audit log included.
      const everything = [...reads.values()].join("\n");
      expect(everything.includes(account), `world ${i + 1} shows ${account}`).toBe(false);
    }
  });
});

// A drill world pair per outcome. The private account holds one transaction in one world and five
// in the other, of different amounts, so a count or digest of the whole database differs.
const DRILL_PAIRS: readonly DrillOutcome[] = ["backup only", "passed", "passed then failed"];

describe("backup status after a backup, a passing drill, and a pass then a fail", () => {
  let dir: string;
  const pairs = new Map<DrillOutcome, [DrillWorld, DrillWorld]>();
  const pair = (outcome: DrillOutcome): [DrillWorld, DrillWorld] => {
    const found = pairs.get(outcome);
    if (found === undefined) throw new Error(`no drill pair for ${outcome}`);
    return found;
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-privacy-passed-drill-"));
    for (const [i, outcome] of DRILL_PAIRS.entries()) {
      const viewer = systemViewer("cli:backup");
      const made: [DrillWorld, DrillWorld] = [
        await drillWorld(seedJson, "one", join(dir, String(i)), viewer, outcome),
        await drillWorld(seedJson, "two", join(dir, String(i)), viewer, outcome),
      ];
      pairs.set(outcome, made);
      for (const d of made) worlds.push(d);
    }
  }, SLOW_MS); // builds several worlds, each seeded and backed up: slow on a busy runner

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives A's private account one transaction in one world and five in the other", () => {
    for (const outcome of DRILL_PAIRS) {
      const counts = pair(outcome).map((d) =>
        d.db
          .prepare(
            "SELECT count(*) FROM \"transaction\" WHERE account_id = (SELECT id FROM account WHERE name = 'Drill probe private')",
          )
          .pluck()
          .get(),
      );
      expect(counts, outcome).toEqual([1, 5]);
    }
  });

  it("stores a passed drill's verdict as the fixed words, with the snapshot's short id", () => {
    for (const outcome of ["passed", "passed then failed"] as const) {
      for (const d of pair(outcome)) {
        const [first, ...rest] = d.verifications().map((v) => ({
          ...v,
          summary: maskResticIds(d, v.summary),
        }));
        expect(first, outcome).toEqual({
          kind: "drill",
          ok: 1,
          summary: "restored snapshot <id> and verified the restore",
        });
        expect(
          rest.map((v) => [v.ok, v.summary]),
          outcome,
        ).toEqual(outcome === "passed" ? [] : [[0, "the manifest check failed on snapshot <id>"]]);
      }
    }
    for (const d of pair("backup only")) expect(d.verifications()).toEqual([]);
  });

  for (const outcome of DRILL_PAIRS) {
    it(`shows B the same /api/system/backup, audit rows, stored rows, verdicts and reads in both worlds: ${outcome}`, async () => {
      const [left, right] = pair(outcome);
      const [l, r] = [await drillView(left), await drillView(right)];
      expect(l.get("GET /api/system/backup")).toContain("200");
      expect(l.get("backup audit rows")).toContain("backup_snapshot");
      expect(identicalProblems(l, r)).toEqual([]);
    });

    it(`stores no count and no digest where B reads the backup: ${outcome}`, async () => {
      for (const d of pair(outcome)) expect(await drillFigureProblems(d)).toEqual([]);
    });
  }

  it("reads the drill's success in /api/system/backup", async () => {
    const backup = await pair("passed")[0].request("b", "GET", "/api/system/backup");
    expect(backup.text).toContain("verified the restore");
  });
});

describe("a deliberate leak of a figure of the whole database into the backup", () => {
  let dir: string;
  const leaked = new Map<DrillLeak, [DrillWorld, DrillWorld]>();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-privacy-leaky-drill-"));
    for (const [i, leak] of (["summary-count", "audit-digest"] as const).entries()) {
      const viewer = systemViewer("cli:backup");
      const made: [DrillWorld, DrillWorld] = [
        leakyDrillWorld(
          await drillWorld(seedJson, "one", join(dir, String(i)), viewer, "passed"),
          leak,
        ),
        leakyDrillWorld(
          await drillWorld(seedJson, "two", join(dir, String(i)), viewer, "passed"),
          leak,
        ),
      ];
      leaked.set(leak, made);
      for (const d of made) worlds.push(d);
    }
  }, SLOW_MS); // builds several worlds, each seeded and backed up: slow on a busy runner

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is caught when a count is put back in the success summary: B's reads differ", async () => {
    const [left, right] = leaked.get("summary-count") as [DrillWorld, DrillWorld];
    const problems = identicalProblems(await drillView(left), await drillView(right));
    expect(problems).toContain("GET /api/system/backup differs between the worlds");
    expect(problems).toContain("stored verdicts differs between the worlds");
    expect(problems).toContain("backup audit rows differs between the worlds");
  });

  it("is caught when a count is put back in the success summary: the verdict says more than the fixed words", async () => {
    for (const d of leaked.get("summary-count") as [DrillWorld, DrillWorld]) {
      const problems = await drillFigureProblems(d);
      expect(problems.some((p) => p.includes("says more than the fixed words"))).toBe(true);
    }
  });

  it("is caught when the digest is put back in a backup_snapshot audit row: B's audit rows differ", async () => {
    const [left, right] = leaked.get("audit-digest") as [DrillWorld, DrillWorld];
    const problems = identicalProblems(await drillView(left), await drillView(right));
    expect(problems).toContain("backup audit rows differs between the worlds");
  });

  it("is caught when the digest is put back in a backup_snapshot audit row: a 64-hex string that is no snapshot id", async () => {
    for (const d of leaked.get("audit-digest") as [DrillWorld, DrillWorld]) {
      const problems = await drillFigureProblems(d);
      expect(problems.some((p) => p.endsWith("is not a restic snapshot id"))).toBe(true);
    }
  });
});

// ----------------------------------------------------------------------- A leaves the household

const LEAVE_PATH = "/api/accounts/leave-household";

/** The count a query returns, from a world's database. */
const countIn = (w: World, sql: string, ...args: unknown[]): number =>
  w.db
    .prepare(sql)
    .pluck()
    .get(...args) as number;

/**
 * What a leave must have done, read from the worlds of `leaveScenario`: B reads the formerly
 * hidden name in both worlds (the hiding is lifted) and its columns are clear.
 */
function leaveProblems(pair: Pair<LeaveRun>): string[] {
  const problems: string[] = [];
  pair.worlds.forEach((w, i) => {
    const { hidden } = (pair.runs[i] as LeaveRun).ids;
    const seen = (pair.seen[i] as Seen).get("after A left");
    const read = seen?.get(`GET /api/ledger/transactions/${hidden}`) ?? "";
    if (!read.includes(LEAVE_HIDDEN_NAME)) problems.push(`world ${i + 1}: B cannot read the name`);
    if (read.includes("Hidden until"))
      problems.push(`world ${i + 1}: B still sees the placeholder`);
    if (countIn(w, 'SELECT count(*) FROM "transaction" WHERE name_hidden_by = ?', w.people.a) > 0) {
      problems.push(`world ${i + 1}: a hiding is still stored`);
    }
  });
  return problems;
}

describe("A leaves the household", () => {
  let pair: Pair<LeaveRun>;
  beforeAll(async () => {
    pair = await runPair(leaveScenario);
  });

  it("gives B the same reads in both worlds before A leaves, after, and after B writes on what A handed over", () => {
    expect([...pair.seen[0].keys()]).toEqual([
      "before A leaves",
      "after A left",
      "after B's writes",
    ]);
    expect(checkpointProblems(pair.seen)).toEqual([]);
    // The probe is not empty: B reads A's former joint account, now B's alone.
    const left = pair.seen[0].get("after A left");
    expect(left?.get("GET /api/accounts")).toContain("Leave probe joint");
    expect(left?.get("GET /api/accounts")).toContain("Leave probe sole");
  });

  it("answers each step the same in both worlds: A leaves, B writes, A is out", () => {
    const [left, right] = pair.runs;
    expect(outcomes(right.steps)).toEqual(outcomes(left.steps));
    expect(left.steps.map((s) => [s.name, s.status])).toEqual([
      ["A leaves", 200],
      ["B renames the joint account", 200],
      ["B edits the formerly hidden entry", 200],
      ["B closes the account A owned alone", 200],
      ["A tries again", 401],
    ]);
  });

  it("lifts A's hiding: B reads the real name where B read a placeholder", () => {
    expect(leaveProblems(pair)).toEqual([]);
    const before = pair.seen[0].get("before A leaves");
    const id = pair.runs[0].ids.hidden;
    expect(before?.get(`GET /api/ledger/transactions/${id}`)).toContain("Hidden until");
    expect(before?.get(`GET /api/ledger/transactions/${id}`)).not.toContain(LEAVE_HIDDEN_NAME);
  });

  it("deletes A's private data, scoped rows and audit rows, and keeps the shared accounts with B", () => {
    pair.worlds.forEach((w, i) => {
      const { ids } = pair.runs[i] as LeaveRun;
      const a = w.people.a;
      const b = w.people.b;
      for (const id of ids.privateAccounts) {
        expect(countIn(w, "SELECT count(*) FROM account WHERE id = ?", id)).toBe(0);
        expect(countIn(w, 'SELECT count(*) FROM "transaction" WHERE account_id = ?', id)).toBe(0);
        expect(countIn(w, "SELECT count(*) FROM balance_snapshot WHERE account_id = ?", id)).toBe(
          0,
        );
        expect(countIn(w, "SELECT count(*) FROM audit_log WHERE account_id = ?", id)).toBe(0);
      }
      for (const [table, id] of [
        ["payee", ids.payee],
        ["payee_alias", ids.alias],
        ["tag", ids.tag],
        ["activity", ids.activity],
      ] as const) {
        if (id !== undefined) {
          expect(countIn(w, `SELECT count(*) FROM ${table} WHERE id = ?`, id), table).toBe(0);
          expect(countIn(w, "SELECT count(*) FROM audit_log WHERE entity_id = ?", id), table).toBe(
            0,
          );
        }
      }
      expect(countIn(w, "SELECT count(*) FROM audit_log WHERE person_id = ?", a)).toBe(0);
      expect(countIn(w, "SELECT count(*) FROM review_item WHERE person_id = ?", a)).toBe(0);
      // A's rows in every account the seed gave them are gone too.
      expect(
        countIn(
          w,
          `SELECT count(*) FROM account acc JOIN account_owner o ON o.account_id = acc.id
            WHERE acc.is_private = 1 AND o.person_id = ?`,
          a,
        ),
      ).toBe(0);
      expect(countIn(w, "SELECT count(*) FROM account_owner WHERE person_id = ?", a)).toBe(0);
      for (const id of [ids.joint, ids.sole]) {
        expect(
          w.db
            .prepare("SELECT person_id, share_bp FROM account_owner WHERE account_id = ?")
            .all(id),
        ).toEqual([{ person_id: b, share_bp: 10_000 }]);
      }
      for (const id of [ids.hidden, ids.soleTransaction]) {
        expect(countIn(w, 'SELECT count(*) FROM "transaction" WHERE id = ?', id)).toBe(1);
      }
      // A is marked left, with no session, passkey or usable password.
      expect(
        countIn(w, "SELECT count(*) FROM person WHERE id = ? AND deleted_at IS NOT NULL", a),
      ).toBe(1);
      expect(countIn(w, "SELECT count(*) FROM auth_session WHERE user_id = 'user-a'")).toBe(0);
      expect(countIn(w, "SELECT count(*) FROM auth_passkey WHERE user_id = 'user-a'")).toBe(0);
      expect(
        countIn(
          w,
          "SELECT count(*) FROM auth_account WHERE user_id = 'user-a' AND password = 'old-hash'",
        ),
      ).toBe(0);
      // B's login is untouched.
      expect(countIn(w, "SELECT count(*) FROM auth_session WHERE user_id = 'user-b'")).toBe(1);
    });
    // The worlds differ: only the first held private data before the leave.
    expect(pair.runs[0].ids.privateAccounts).toHaveLength(2);
    expect(pair.runs[1].ids.privateAccounts).toHaveLength(0);
  });

  it("clears the session cookie in the response", async () => {
    const w = world("base");
    w.startRequestIds();
    const res = await w.app.request(LEAVE_PATH, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: "session=user-a" },
      body: JSON.stringify({ confirm: true }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().map((c) => c.split(";")[0])).toEqual([
      "pangolin.session_token=",
      "pangolin.session_data=",
    ]);
  });
});

describe("a leaver with private data and one with none", () => {
  it("leave B the same bytes on every GET route", async () => {
    const [none, held] = [world("base"), world("delta")];
    for (const w of [none, held]) {
      w.startRequestIds();
      const res = await w.request("a", "POST", LEAVE_PATH, { confirm: true });
      expect(res.status, res.text).toBe(200);
    }
    const left = await readTranscript(none);
    const right = await readTranscript(held);
    expect(left.size).toBeGreaterThan(20);
    expect(identicalProblems(left, right)).toEqual([]);
    expect(left.get("GET /api/accounts")).toContain("Joint everyday");
    // The delta world held a hiding, private accounts and scoped rows; all of it is gone.
    expect(held.privateIds.account.length).toBeGreaterThanOrEqual(6);
    for (const [table, ids] of [
      ["account", held.privateIds.account],
      ["payee", held.privateIds.payee],
      ["tag", held.privateIds.tag],
      ["payee_alias", held.privateIds.alias],
      ["activity", held.privateIds.activity],
    ] as const) {
      for (const id of ids) {
        expect(
          countIn(held, `SELECT count(*) FROM ${table} WHERE id = ?`, id),
          `${table} ${id}`,
        ).toBe(0);
      }
    }
    for (const id of held.privateIds.transaction) {
      expect(countIn(held, 'SELECT count(*) FROM "transaction" WHERE id = ?', id), id).toBe(0);
    }
    expect(countIn(held, "SELECT count(*) FROM audit_log WHERE person_id = ?", held.people.a)).toBe(
      0,
    );
    expect(
      countIn(held, 'SELECT count(*) FROM "transaction" WHERE name_hidden_by = ?', held.people.a),
    ).toBe(0);
  });
});

describe("a deliberate leak in the leave worlds", () => {
  it("is caught: with the hidings not lifted, B still reads the placeholder", async () => {
    const pair = await runPair(leaveScenario, (variant) =>
      leakyWorld(world(variant), "leave-hidings"),
    );
    const problems = leaveProblems(pair);
    expect(problems).toContain("world 1: B still sees the placeholder");
    expect(problems).toContain("world 1: a hiding is still stored");
    expect(problems).toContain("world 2: B still sees the placeholder");
  });
});
