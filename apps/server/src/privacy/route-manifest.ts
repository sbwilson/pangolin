// The privacy manifest (AD-3, AD-5, AD-18): one entry for every `/api` route the server
// registers. `privacy.test.ts` derives the route set from `createApp(deps).routes` and fails in
// both directions: a route with no entry (a new route cannot ship without a privacy decision),
// and an entry with no route (a stale entry).
//
// An entry says how the suite treats the route:
//   person   returns or changes a person's ledger or classification data. The suite replays every
//            GET as partner B in two worlds that differ only in partner A's private data and
//            requires equal bytes, and sends every id of A's private data to it and requires the
//            same 404 as for an id that never existed.
//   system   household or deployment status, no ledger data (the response never varies with a
//            person's private data).
//   identity sign-in, enrolment and recovery, handled by the identity module and better-auth.
//   exempt   deliberately not covered, with a written reason.
//   pending  a route a later epic will add (search, export, audit). It holds the name until the
//            route ships: the suite fails when a route appears under a pending entry, so the
//            entry must be replaced with a real one that carries its privacy checks.

/** The kinds of private data an id in a request can name. */
export type Entity =
  | "account"
  | "transaction"
  | "split"
  | "payee"
  | "tag"
  | "alias"
  | "activity"
  | "transferGroup"
  | "notice"
  | "institution"
  | "categoryGroup"
  | "category"
  | "taxCategory";

/** The entities partner A can own privately; the others are household-wide. */
export const PRIVATE_ENTITIES: readonly Entity[] = [
  "account",
  "transaction",
  "split",
  "payee",
  "tag",
  "alias",
  "activity",
  "transferGroup",
  "notice",
];

/**
 * Chooses the id for a slot of a request: `id("account")` is the first account slot, and
 * `id("transaction", 1)` the second transaction slot. The suite makes the slot under test name
 * A's private id (or one that does not exist) and every other slot name something B may use.
 */
export type SlotId = (entity: Entity, slot?: number) => string;

export interface KnownGap {
  readonly gap: string;
  /** Why it is accepted until a product decision is made. */
  readonly reason: string;
}

export interface PersonEntry {
  readonly kind: "person";
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly access: "read" | "write";
  /** The entity each `:param` in the path names. */
  readonly params?: Readonly<Record<string, Entity>>;
  /** The JSON body, built from the slots it names. */
  readonly body?: (id: SlotId) => unknown;
  /** The entities the body names (each one is a slot the suite can aim at A's private ids). */
  readonly bodyEntities?: readonly Entity[];
  /** Other bodies the route accepts that name different entities; each is probed on its own. */
  readonly altBodies?: readonly {
    readonly bodyEntities: readonly Entity[];
    readonly body: (id: SlotId) => unknown;
  }[];
  /** How many slots an entity fills in the request (default 1); every slot is aimed in turn. */
  readonly slots?: Partial<Record<Entity, number>>;
  /** Cross-scope effects found by the suite and left for a product decision. */
  readonly knownGaps?: readonly KnownGap[];
}

export interface SystemEntry {
  readonly kind: "system";
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly reason: string;
}

export interface IdentityEntry {
  readonly kind: "identity";
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly reason: string;
}

export interface ExemptEntry {
  readonly kind: "exempt";
  readonly method: string;
  readonly path: string;
  readonly reason: string;
}

export interface PendingEntry {
  readonly kind: "pending";
  readonly method: string;
  readonly path: string;
  readonly reason: string;
}

export type ManifestEntry = PersonEntry | SystemEntry | IdentityEntry | ExemptEntry | PendingEntry;

export const routeKey = (entry: { method: string; path: string }): string =>
  `${entry.method} ${entry.path}`;

const read = (
  path: string,
  extra: Partial<Omit<PersonEntry, "kind" | "method" | "path" | "access">> = {},
): PersonEntry => ({ kind: "person", method: "GET", path, access: "read", ...extra });

const write = (
  method: PersonEntry["method"],
  path: string,
  extra: Partial<Omit<PersonEntry, "kind" | "method" | "path" | "access">> = {},
): PersonEntry => ({ kind: "person", method, path, access: "write", ...extra });

const system = (path: string, reason: string): SystemEntry => ({
  kind: "system",
  method: "GET",
  path,
  reason,
});

const identity = (method: "GET" | "POST", path: string, reason: string): IdentityEntry => ({
  kind: "identity",
  method,
  path,
  reason,
});

const posted = "2026-07-01";

export const MANIFEST: readonly ManifestEntry[] = [
  system("/api/system/health", "Schema version and writability only."),
  system("/api/system/jobs", "Job kind and failure time only, never payload or ids (AD-9)."),
  system("/api/system/backup", "Last backup and verification times; no ledger data."),
  system("/api/system/recovery-bundle", "Whether the recovery bundle is confirmed; no secrets."),

  read("/api/identity/me"),
  read("/api/identity/notices"),
  write("POST", "/api/identity/notices/:id/dismiss", { params: { id: "notice" } }),
  identity("POST", "/api/identity/setup-links", "Household setup link; carries no ledger data."),
  identity("POST", "/api/identity/sign-up", "Sign-up with a setup link."),
  identity("POST", "/api/identity/recovery-codes/initial", "The caller's own recovery codes."),
  identity("POST", "/api/identity/recovery-codes", "The caller's own recovery codes."),
  identity("POST", "/api/identity/recover", "Recovery-code sign-in."),
  identity("POST", "/api/identity/re-enrolment-links", "Partner-assisted reset link."),
  identity("POST", "/api/identity/re-enrolment-links/revoke", "The affected person's own links."),
  identity("POST", "/api/identity/re-enrol", "Re-enrolment link redemption."),
  identity("GET", "/api/auth/*", "better-auth's own routes: sessions and credentials only."),
  identity("POST", "/api/auth/*", "better-auth's own routes: sessions and credentials only."),

  read("/api/ledger/transactions"),
  write("POST", "/api/ledger/transactions", {
    bodyEntities: ["account", "payee"],
    body: (id) => ({
      accountId: id("account"),
      postedOn: posted,
      amountCents: -100,
      description: "Privacy probe",
      payeeId: id("payee"),
    }),
  }),
  read("/api/ledger/transactions/:id", { params: { id: "transaction" } }),
  write("PATCH", "/api/ledger/transactions/:id", {
    params: { id: "transaction" },
    body: () => ({ notes: "Privacy probe" }),
  }),
  write("DELETE", "/api/ledger/transactions/:id", { params: { id: "transaction" } }),
  write("PUT", "/api/ledger/transactions/:id/splits", {
    params: { id: "transaction" },
    body: () => ({ splits: [{ amountCents: -100 }] }),
  }),
  write("PATCH", "/api/ledger/transactions/:id/splits/:splitId", {
    params: { id: "transaction", splitId: "split" },
    bodyEntities: ["category"],
    body: (id) => ({ field: "category", value: id("category") }),
    altBodies: [
      {
        bodyEntities: ["activity"],
        body: (id) => ({ field: "activity", value: id("activity") }),
      },
    ],
  }),
  write("PUT", "/api/ledger/transactions/:id/splits/:splitId/tags", {
    params: { id: "transaction", splitId: "split" },
    bodyEntities: ["tag"],
    body: (id) => ({ tagIds: [id("tag")] }),
  }),
  write("PUT", "/api/ledger/transactions/:id/name-hidden", {
    params: { id: "transaction" },
    body: () => ({}),
  }),
  write("DELETE", "/api/ledger/transactions/:id/name-hidden", { params: { id: "transaction" } }),
  write("POST", "/api/ledger/transfer-groups", {
    bodyEntities: ["transaction"],
    slots: { transaction: 2 },
    body: (id) => ({ transactionIds: [id("transaction"), id("transaction", 1)] }),
  }),
  write("DELETE", "/api/ledger/transfer-groups/:id", {
    params: { id: "transferGroup" },
  }),

  read("/api/accounts/institutions"),
  write("POST", "/api/accounts/institutions", {
    body: () => ({ name: "Privacy probe bank", kind: "bank" }),
  }),
  write("PATCH", "/api/accounts/institutions/:id", {
    params: { id: "institution" },
    body: () => ({ name: "Privacy probe bank" }),
  }),
  read("/api/accounts"),
  write("POST", "/api/accounts"),
  read("/api/accounts/:id", { params: { id: "account" } }),
  write("PATCH", "/api/accounts/:id", {
    params: { id: "account" },
    body: () => ({ name: "Privacy probe account" }),
  }),
  write("POST", "/api/accounts/:id/close", { params: { id: "account" }, body: () => ({}) }),
  write("POST", "/api/accounts/:id/privacy", {
    params: { id: "account" },
    body: () => ({ isPrivate: false }),
  }),
  read("/api/accounts/:id/balance", { params: { id: "account" } }),
  read("/api/accounts/:id/snapshots", { params: { id: "account" } }),
  write("POST", "/api/accounts/:id/snapshots", {
    params: { id: "account" },
    body: () => ({ asOf: posted, balanceCents: 100 }),
  }),

  read("/api/classify/category-groups"),
  write("POST", "/api/classify/category-groups", {
    body: () => ({ name: "Privacy probe group", kind: "expense" }),
  }),
  write("PATCH", "/api/classify/category-groups/:id", {
    params: { id: "categoryGroup" },
    body: () => ({ name: "Privacy probe group" }),
  }),
  read("/api/classify/categories"),
  write("POST", "/api/classify/categories", {
    bodyEntities: ["categoryGroup"],
    body: (id) => ({ groupId: id("categoryGroup"), name: "Privacy probe category" }),
  }),
  write("PATCH", "/api/classify/categories/:id", {
    params: { id: "category" },
    body: () => ({ name: "Privacy probe category" }),
  }),
  write("DELETE", "/api/classify/categories/:id", {
    params: { id: "category" },
    knownGaps: [
      {
        gap: "Deleting a shared category clears it as the default category of every payee that used it, including a partner's owner-only payee.",
        reason:
          "Categories are household-wide, so the delete has to reach every payee that points at one. The partner learns nothing about the payee; the owner's default is lost. Whether to keep a tombstone is a product decision.",
      },
    ],
  }),
  read("/api/classify/tax-categories"),
  write("POST", "/api/classify/tax-categories", {
    body: () => ({ name: "Privacy probe tax category" }),
  }),
  write("PATCH", "/api/classify/tax-categories/:id", {
    params: { id: "taxCategory" },
    body: () => ({ name: "Privacy probe tax category" }),
  }),
  read("/api/classify/tags"),
  write("POST", "/api/classify/tags", {
    bodyEntities: ["account"],
    body: (id) => ({ name: "Privacy probe tag", originAccountId: id("account") }),
  }),
  read("/api/classify/tags/:id", { params: { id: "tag" } }),
  write("PATCH", "/api/classify/tags/:id", {
    params: { id: "tag" },
    body: () => ({ name: "Privacy probe tag" }),
  }),
  write("DELETE", "/api/classify/tags/:id", { params: { id: "tag" } }),
  read("/api/classify/payees/aliases"),
  write("POST", "/api/classify/payees/aliases", {
    bodyEntities: ["payee", "account"],
    body: (id) => ({
      payeeId: id("payee"),
      pattern: "PRIVACY PROBE",
      matchKind: "contains",
      originAccountId: id("account"),
    }),
  }),
  read("/api/classify/payees/aliases/:id", { params: { id: "alias" } }),
  write("PATCH", "/api/classify/payees/aliases/:id", {
    params: { id: "alias" },
    body: () => ({ pattern: "PRIVACY PROBE" }),
  }),
  write("DELETE", "/api/classify/payees/aliases/:id", { params: { id: "alias" } }),
  read("/api/classify/payees"),
  write("POST", "/api/classify/payees", {
    bodyEntities: ["account"],
    body: (id) => ({ name: "Privacy probe payee", originAccountId: id("account") }),
  }),
  read("/api/classify/payees/:id", { params: { id: "payee" } }),
  write("PATCH", "/api/classify/payees/:id", {
    params: { id: "payee" },
    body: () => ({ name: "Privacy probe payee" }),
  }),
  write("DELETE", "/api/classify/payees/:id", {
    params: { id: "payee" },
    knownGaps: [
      {
        gap: "Deleting a shared payee soft-deletes every alias that points at it, including a partner's owner-only aliases.",
        reason:
          "An alias cannot outlive its payee. The partner learns nothing about the alias; the owner loses it. Whether owner-only aliases should block the delete is a product decision.",
      },
    ],
  }),
  read("/api/classify/activities"),
  write("POST", "/api/classify/activities", {
    bodyEntities: ["account"],
    body: (id) => ({ name: "Privacy probe activity", originAccountId: id("account") }),
  }),
  read("/api/classify/activities/:id", { params: { id: "activity" } }),
  write("PATCH", "/api/classify/activities/:id", {
    params: { id: "activity" },
    body: () => ({ name: "Privacy probe activity" }),
  }),
  write("DELETE", "/api/classify/activities/:id", { params: { id: "activity" } }),

  // Routes epic-ledger-workspace adds. Each must replace its pending entry with a person entry
  // that carries the byte-identical and NotFound checks, through `visibleAccounts`, `visibleTxn`
  // and `redact` (AD-3, AD-4).
  {
    kind: "pending",
    method: "GET",
    path: "/api/ledger/search",
    reason: "Search (epic-ledger-workspace): FTS5 over visibleTxn, never over raw rows.",
  },
  {
    kind: "pending",
    method: "GET",
    path: "/api/ledger/export",
    reason: "Export (epic-ledger-workspace): a re-authenticated, viewer-scoped, redacted file.",
  },
  {
    kind: "pending",
    method: "GET",
    path: "/api/system/audit",
    reason: "Audit API (epic-ledger-workspace): listAudit with redact for the partner's entries.",
  },
];

/** Entries that name a person's data, which the suite replays. */
export const personEntries = (): PersonEntry[] =>
  MANIFEST.filter((entry): entry is PersonEntry => entry.kind === "person");

/** Routes that need no entry: middleware, the probe and the static PWA. Anything else must have one. */
export const UNMANIFESTED_ROUTES: ReadonlySet<string> = new Set([
  "ALL /*", // CSP and cache headers
  "ALL /api/*", // Origin check, session, and the /api 404
  "ALL /api/identity/recover", // rate limit
  "ALL /api/identity/re-enrol", // rate limit
  "ALL /api/auth/sign-up/*", // better-auth paths kept off
  "ALL /api/auth/two-factor/verify-backup-code",
  "ALL /api/auth/two-factor/generate-backup-codes",
  "ALL /api/auth/two-factor/send-otp",
  "ALL /api/auth/two-factor/verify-otp",
  "GET /healthz", // anonymous readiness, check names only
  "GET /",
  "GET /index.html",
  "GET /assets/*",
  "GET *",
  "ALL *",
]);

const isOurs = (route: { method: string; path: string }): boolean =>
  route.method !== "ALL" && route.path.startsWith("/api");

/** The routes the app registers that are ours: `/api`, one entry per method, no middleware. */
export function apiRoutes(
  routes: readonly { readonly method: string; readonly path: string }[],
): { method: string; path: string }[] {
  const seen = new Set<string>();
  const out: { method: string; path: string }[] = [];
  for (const route of routes) {
    if (!isOurs(route)) continue;
    const key = routeKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: route.method, path: route.path });
  }
  return out;
}

const pathParams = (path: string): string[] =>
  [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string);

/** The two-way comparison of registered routes and manifest entries. */
export function manifestProblems(
  routes: readonly { readonly method: string; readonly path: string }[],
  manifest: readonly ManifestEntry[] = MANIFEST,
): string[] {
  const registered = new Map(apiRoutes(routes).map((route) => [routeKey(route), route]));
  const entries = new Map<string, ManifestEntry>();
  const problems: string[] = [];
  for (const route of routes) {
    if (!isOurs(route) && !UNMANIFESTED_ROUTES.has(routeKey(route))) {
      problems.push(
        `Route ${routeKey(route)} is dropped from the manifest but is not an allowed middleware or static route`,
      );
    }
  }
  for (const entry of manifest) {
    const key = routeKey(entry);
    if (entries.has(key)) problems.push(`Duplicate manifest entry for ${key}`);
    entries.set(key, entry);
    if (entry.kind !== "person" && entry.reason.trim() === "") {
      problems.push(`${key}: ${entry.kind} entries need a written reason`);
    }
    if (entry.kind === "person") {
      for (const gap of entry.knownGaps ?? []) {
        if (gap.gap.trim() === "" || gap.reason.trim() === "") {
          problems.push(`${key}: a known gap needs a description and a reason`);
        }
      }
      const inPath = pathParams(entry.path).sort().join(",");
      const declared = Object.keys(entry.params ?? {})
        .sort()
        .join(",");
      if (inPath !== declared) {
        problems.push(`${key}: path params (${inPath}) do not match declared params (${declared})`);
      }
    }
  }
  for (const key of registered.keys()) {
    const entry = entries.get(key);
    if (entry === undefined) problems.push(`Route ${key} has no privacy manifest entry`);
    else if (entry.kind === "pending") {
      problems.push(
        `Route ${key} is registered but its manifest entry is still pending: replace it with a person entry that carries its privacy checks`,
      );
    }
  }
  for (const [key, entry] of entries) {
    if (entry.kind !== "pending" && !registered.has(key)) {
      problems.push(`Manifest entry ${key} has no route (stale)`);
    }
  }
  return problems;
}
