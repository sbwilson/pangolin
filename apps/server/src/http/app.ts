import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  AppError,
  backupStatus,
  balanceAsOf,
  type Clock,
  type CodeHasher,
  checkSignUp,
  closeAccount,
  createAccount,
  createActivity,
  createCategory,
  createCategoryGroup,
  createInstitution,
  createPayee,
  createPayeeAlias,
  createTag,
  createTaxCategory,
  createTransaction,
  createTransferGroup,
  deadJobs,
  deleteActivity,
  deleteCategory,
  deletePayee,
  deletePayeeAlias,
  deleteTag,
  deleteTransaction,
  deleteTransferGroup,
  dismissNotice,
  ERROR_CODES,
  type ErrorCode,
  enrolmentNeeds,
  getAccount,
  getActivity,
  getPayee,
  getPayeeAlias,
  getTag,
  getTransaction,
  health,
  hideTransactionName,
  type IdGenerator,
  issueInitialRecoveryCodes,
  issueReEnrolmentLink,
  issueSetupLink,
  listAccounts,
  listActivities,
  listBalanceSnapshots,
  listCategories,
  listCategoryGroups,
  listInstitutions,
  listNotices,
  listPayeeAliases,
  listPayees,
  listTags,
  listTaxCategories,
  listTransactions,
  me,
  type ReadinessOutput,
  type RecordBalanceSnapshotInput,
  type RunnerLiveness,
  readiness,
  recordBalanceSnapshot,
  recoveryBundleConfirmed,
  recoveryBundleStatus,
  reEnrolmentUrl,
  regenerateRecoveryCodes,
  rejoinAccount,
  revokeMyReEnrolmentLinks,
  type SetSplitFieldInput,
  type SystemHealthPort,
  setPrivacy,
  setSplitField,
  setSplits,
  setSplitTags,
  type TokenPort,
  type UnitOfWork,
  type UseCaseContext,
  unhideTransactionName,
  updateAccount,
  updateActivity,
  updateCategory,
  updateCategoryGroup,
  updateInstitution,
  updatePayee,
  updatePayeeAlias,
  updateTag,
  updateTaxCategory,
  updateTransaction,
} from "@pangolin/app";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { cspOnHtml, serveIndex } from "./csp.ts";
import { createErrorHandler, errorResponse, type InternalErrorLogger } from "./errors.ts";
import { originCheck } from "./origin.ts";
import { rateLimit } from "./rate-limit.ts";
import {
  type Authn,
  CLIENT_IP_HEADER,
  enrolmentIncomplete,
  type IssuedSession,
  type SessionEnv,
  sessionMiddleware,
} from "./session.ts";

export interface ApiDeps {
  readonly systemHealth: SystemHealthPort;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly tokens: TokenPort;
  /** Hashes recovery codes under the key derived from the auth secret. */
  readonly codes: CodeHasher;
  /** `PANGOLIN_PUBLIC_URL`'s origin: the only origin that may write, and the base of links. */
  readonly publicUrl: string;
  /** Live sign-in through better-auth, or demo mode's fixed viewer. */
  readonly authn: Authn;
  /** Whether a backup repository is configured (`PANGOLIN_BACKUP_REPOSITORY`); default false. */
  readonly backupConfigured?: boolean;
  /**
   * The current recovery bundle's id (`PANGOLIN_RECOVERY_BUNDLE_ID`); `/healthz` and the status
   * page warn until it is confirmed. Undefined (dev, CI, demo): nothing to confirm.
   */
  readonly bundleId?: string;
}

export interface AppDeps extends ApiDeps {
  /** Directory holding the built PWA. Omit to serve the API only. */
  readonly webRoot?: string;
  /** Receives every error answered with 500 `Internal`. Defaults to a JSON line on stderr. */
  readonly logInternalError?: InternalErrorLogger;
  /** Reverse-proxy IPs whose `X-Forwarded-For` is trusted (`PANGOLIN_TRUSTED_PROXIES`). */
  readonly trustedProxies?: readonly string[];
  /**
   * Recovery-code sign-ins and link redemptions one client may make per minute: the same
   * `PANGOLIN_AUTH_RATE_LIMIT` as password sign-in (default 10).
   */
  readonly recoveryRateLimitPerMinute?: number;
  /** What `/healthz` checks beyond the database. */
  readonly healthz: HealthzDeps;
}

/** How long one `/healthz` answer is reused, by the injected clock. */
export const HEALTHZ_CACHE_MS = 1000;

export interface HealthzDeps {
  /** The number of migrations this build ships; the database must have applied them all. */
  readonly expectedSchemaVersion: number;
  /**
   * The job runner's liveness, read per request (undefined until it has started), or `"skip"`
   * in demo mode, which runs no jobs.
   */
  readonly runner: (() => RunnerLiveness | undefined) | "skip";
  /** Test builds only: make `/healthz` fail (PANGOLIN_TEST_FORCE_UNHEALTHY). */
  readonly forceUnhealthy?: boolean;
}

const signUpBody = z
  .object({
    token: z.string().min(1).max(200),
    email: z.email().max(320),
    password: z.string().min(1).max(256),
    displayName: z.string().trim().min(1, { message: "Enter a name" }).max(100),
    colour: z.string().regex(/^#[0-9a-f]{6}$/i, { message: "Expected a #RRGGBB colour" }),
  })
  .strict();

const recoverBody = z
  .object({
    email: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(256),
    code: z.string().min(1).max(100),
  })
  .strict();

const reEnrolBody = z
  .object({
    token: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(12, { message: "Use at least 12 characters" })
      .max(256, { message: "Use at most 256 characters" }),
  })
  .strict();

const reEnrolmentLinkBody = z.object({ personId: z.string().min(1).max(100) }).strict();

const STATUS_CODES: Readonly<Record<number, ErrorCode>> = {
  400: "Validation",
  401: "Unauthenticated",
  404: "NotFound",
  409: "Conflict",
  422: "Validation",
  429: "RateLimited",
};

/** better-auth's error response (`{ code?, message? }`) as an `AppError`, for our own routes. */
async function authError(response: Response): Promise<AppError> {
  const body = (await response.json().catch(() => ({}))) as { code?: unknown; message?: unknown };
  const known = ERROR_CODES.find((code) => code === body.code);
  const code = known ?? STATUS_CODES[response.status];
  const message = typeof body.message === "string" ? body.message : "Sign-up failed";
  if (code === undefined) throw new Error(`better-auth sign-up failed with ${response.status}`);
  return new AppError(code, message);
}

function setCookies(from: Headers): string[] {
  return from.getSetCookie();
}

/** The typed `/api/*` routes. `AppType` is derived from this for the Hono RPC client. */
export function createApi(deps: ApiDeps) {
  const ctx = (c: Context<SessionEnv>): UseCaseContext => ({
    viewer: c.get("viewer"),
    clock: deps.clock,
    newId: deps.newId,
    uow: deps.uow,
  });
  const withTokens = (c: Context<SessionEnv>) => ({
    ...ctx(c),
    tokens: deps.tokens,
    codes: deps.codes,
  });
  /** The answer to a redemption: signed in (with what must still be enrolled), or not. */
  const redeemed = (c: Context, session: IssuedSession) => {
    passCookies(c, session.setCookies);
    if (!session.signedIn) return c.json({ signedIn: false as const }, 200);
    return c.json({ signedIn: true as const, needs: enrolmentNeeds(deps, session.userId) }, 200);
  };
  /** The live sign-in gateway; demo mode is read-only. */
  const liveGateway = () => {
    const { authn } = deps;
    if (authn.kind === "demo") throw new AppError("Conflict", "Demo mode is read-only");
    return authn.gateway;
  };
  /** Demo mode is read-only: every account write calls this first. */
  const writable = () => {
    if (deps.authn.kind === "demo") throw new AppError("Conflict", "Demo mode is read-only");
  };
  /** A JSON object body; an empty body counts as `{}` when `optional`, else `Validation`. */
  const jsonObject = async (c: Context, optional = false): Promise<Record<string, unknown>> => {
    const text = await c.req.text();
    let body: unknown;
    if (text.trim() === "" && optional) body = {};
    else {
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError("Validation", "Expected a JSON body");
      }
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AppError("Validation", "Expected a JSON object");
    }
    return Object.fromEntries(Object.entries(body));
  };
  /**
   * `body` merged under `fixed` (so a client cannot supply its own `:id`), as the use case's
   * input type `T`. The one place the untrusted body is trusted to be `T`: the use case's Zod
   * schema is the check, and answers `Validation` for anything else.
   */
  const asInput = <T extends object>(
    body: Record<string, unknown>,
    fixed: Record<string, string | undefined>,
  ): T => ({ ...body, ...fixed }) as T;
  const objectBody = async <T extends object>(
    c: Context,
    fixed: Record<string, string> = {},
    optional = false,
  ): Promise<T> => asInput<T>(await jsonObject(c, optional), fixed);
  const passCookies = (c: Context, cookies: readonly string[]) => {
    for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
  };
  return new Hono<SessionEnv>()
    .get("/api/system/health", (c) => {
      const result = health({ systemHealth: deps.systemHealth }, {});
      if (result.writable) return c.json(result, 200);
      return c.json(result, 503);
    })
    .get("/api/system/jobs", (c) => {
      // Kind and failure time only: never payload, error text or IDs (AD-9).
      return c.json({ dead: deadJobs({ uow: deps.uow }, {}) }, 200);
    })
    .get("/api/system/backup", (c) => {
      // The last pushed backup (time and restic ID), the stale warning and the latest check and
      // drill, read from `backup_snapshot` and `backup_verification` (AD-9).
      return c.json(backupStatus(deps, deps.backupConfigured ?? false), 200);
    })
    .get("/api/system/recovery-bundle", (c) => {
      // Whether the current recovery bundle is confirmed stored safely, and its id (never a
      // secret: the bundle itself stays off the server).
      return c.json(recoveryBundleStatus(deps.uow, deps.bundleId), 200);
    })
    .get("/api/identity/me", (c) => {
      const needs = c.get("needs");
      return c.json(
        {
          ...me(ctx(c), {}),
          demo: deps.authn.kind === "demo",
          enrolment: needs.length === 0 ? ("complete" as const) : ("incomplete" as const),
          needs,
        },
        200,
      );
    })
    .get("/api/ledger/transactions", (c) => {
      // Per viewer (AD-3): shared accounts plus the viewer's own private ones. Never cached.
      return c.json({ transactions: listTransactions(ctx(c), {}) }, 200);
    })
    .post("/api/ledger/transactions", async (c) => {
      writable();
      const id = createTransaction(ctx(c), await objectBody(c));
      return c.json({ transaction: getTransaction(ctx(c), { id }) }, 201);
    })
    .get("/api/ledger/transactions/:id", (c) => {
      return c.json({ transaction: getTransaction(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .patch("/api/ledger/transactions/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ transaction: updateTransaction(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .put("/api/ledger/transactions/:id/splits", async (c) => {
      writable();
      const transactionId = c.req.param("id");
      return c.json(
        { transaction: setSplits(ctx(c), await objectBody(c, { transactionId })) },
        200,
      );
    })
    .patch("/api/ledger/transactions/:id/splits/:splitId", async (c) => {
      writable();
      const fixed = { transactionId: c.req.param("id"), splitId: c.req.param("splitId") };
      const body = await jsonObject(c);
      // The source is never the client's to choose: rule, payee, activity and llm are internal.
      if ("source" in body) throw new AppError("Validation", "A source cannot be supplied");
      const result = setSplitField(
        ctx(c),
        asInput<SetSplitFieldInput>(body, { ...fixed, source: "user" }),
      );
      return c.json(result, 200);
    })
    .put("/api/ledger/transactions/:id/splits/:splitId/tags", async (c) => {
      writable();
      const fixed = { transactionId: c.req.param("id"), splitId: c.req.param("splitId") };
      return c.json({ transaction: setSplitTags(ctx(c), await objectBody(c, fixed)) }, 200);
    })
    .delete("/api/ledger/transactions/:id", (c) => {
      writable();
      deleteTransaction(ctx(c), { id: c.req.param("id") });
      return c.body(null, 204);
    })
    .put("/api/ledger/transactions/:id/name-hidden", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json(
        { transaction: hideTransactionName(ctx(c), await objectBody(c, { id }, true)) },
        200,
      );
    })
    .delete("/api/ledger/transactions/:id/name-hidden", (c) => {
      writable();
      return c.json({ transaction: unhideTransactionName(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .post("/api/ledger/transfer-groups", async (c) => {
      writable();
      return c.json({ transactions: createTransferGroup(ctx(c), await objectBody(c)) }, 201);
    })
    .delete("/api/ledger/transfer-groups/:id", (c) => {
      writable();
      deleteTransferGroup(ctx(c), { id: c.req.param("id") });
      return c.body(null, 204);
    })
    .get("/api/accounts/institutions", (c) => {
      return c.json({ institutions: listInstitutions(ctx(c), {}) }, 200);
    })
    .post("/api/accounts/institutions", async (c) => {
      writable();
      const institution = createInstitution(ctx(c), await objectBody(c));
      return c.json({ institution }, 201);
    })
    .patch("/api/accounts/institutions/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ institution: updateInstitution(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .get("/api/accounts", (c) => {
      // Per viewer (AD-3, AD-5): another person's private account is absent. Never cached.
      return c.json({ accounts: listAccounts(ctx(c), {}) }, 200);
    })
    .post("/api/accounts", async (c) => {
      writable();
      const id = createAccount(ctx(c), await objectBody(c));
      return c.json({ account: getAccount(ctx(c), { id }) }, 201);
    })
    .get("/api/accounts/:id", (c) => {
      return c.json({ account: getAccount(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .patch("/api/accounts/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ account: updateAccount(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .post("/api/accounts/:id/rejoin", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ account: rejoinAccount(ctx(c), await objectBody(c, { id }, true)) }, 200);
    })
    .post("/api/accounts/:id/close", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ account: closeAccount(ctx(c), await objectBody(c, { id }, true)) }, 200);
    })
    .post("/api/accounts/:id/privacy", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ account: setPrivacy(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .get("/api/accounts/:id/balance", (c) => {
      const accountId = c.req.param("id");
      const date = c.req.query("asOf") ?? deps.clock.today().toString();
      const balanceCents = balanceAsOf(ctx(c), { accountId, date });
      return c.json({ asOf: date, balanceCents }, 200);
    })
    .get("/api/accounts/:id/snapshots", (c) => {
      const snapshots = listBalanceSnapshots(ctx(c), { accountId: c.req.param("id") });
      return c.json({ snapshots }, 200);
    })
    .post("/api/accounts/:id/snapshots", async (c) => {
      writable();
      const accountId = c.req.param("id");
      // Statement and connector snapshots come from imports, never from a client.
      const body = await jsonObject(c);
      const snapshot = recordBalanceSnapshot(
        ctx(c),
        asInput<RecordBalanceSnapshotInput>(body, { accountId, source: undefined }),
      );
      return c.json({ snapshot }, 201);
    })
    .get("/api/classify/category-groups", (c) => {
      return c.json({ categoryGroups: listCategoryGroups(ctx(c), {}) }, 200);
    })
    .post("/api/classify/category-groups", async (c) => {
      writable();
      return c.json({ categoryGroup: createCategoryGroup(ctx(c), await objectBody(c)) }, 201);
    })
    .patch("/api/classify/category-groups/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json(
        { categoryGroup: updateCategoryGroup(ctx(c), await objectBody(c, { id })) },
        200,
      );
    })
    .get("/api/classify/categories", (c) => {
      return c.json({ categories: listCategories(ctx(c), {}) }, 200);
    })
    .post("/api/classify/categories", async (c) => {
      writable();
      return c.json({ category: createCategory(ctx(c), await objectBody(c)) }, 201);
    })
    .patch("/api/classify/categories/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ category: updateCategory(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .delete("/api/classify/categories/:id", (c) => {
      writable();
      const id = c.req.param("id");
      deleteCategory(ctx(c), { id });
      return c.json({ id }, 200);
    })
    .get("/api/classify/tax-categories", (c) => {
      return c.json({ taxCategories: listTaxCategories(ctx(c), {}) }, 200);
    })
    .post("/api/classify/tax-categories", async (c) => {
      writable();
      return c.json({ taxCategory: createTaxCategory(ctx(c), await objectBody(c)) }, 201);
    })
    .patch("/api/classify/tax-categories/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ taxCategory: updateTaxCategory(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .get("/api/classify/tags", (c) => {
      return c.json({ tags: listTags(ctx(c), {}) }, 200);
    })
    .post("/api/classify/tags", async (c) => {
      writable();
      return c.json({ tag: createTag(ctx(c), await objectBody(c)) }, 201);
    })
    .get("/api/classify/tags/:id", (c) => {
      return c.json({ tag: getTag(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .patch("/api/classify/tags/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ tag: updateTag(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .delete("/api/classify/tags/:id", (c) => {
      writable();
      const id = c.req.param("id");
      deleteTag(ctx(c), { id });
      return c.json({ id }, 200);
    })
    .get("/api/classify/payees/aliases", (c) => {
      return c.json({ aliases: listPayeeAliases(ctx(c), {}) }, 200);
    })
    .post("/api/classify/payees/aliases", async (c) => {
      writable();
      return c.json({ alias: createPayeeAlias(ctx(c), await objectBody(c)) }, 201);
    })
    .get("/api/classify/payees/aliases/:id", (c) => {
      return c.json({ alias: getPayeeAlias(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .patch("/api/classify/payees/aliases/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ alias: updatePayeeAlias(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .delete("/api/classify/payees/aliases/:id", (c) => {
      writable();
      const id = c.req.param("id");
      deletePayeeAlias(ctx(c), { id });
      return c.json({ id }, 200);
    })
    .get("/api/classify/payees", (c) => {
      return c.json({ payees: listPayees(ctx(c), {}) }, 200);
    })
    .post("/api/classify/payees", async (c) => {
      writable();
      return c.json({ payee: createPayee(ctx(c), await objectBody(c)) }, 201);
    })
    .get("/api/classify/payees/:id", (c) => {
      return c.json({ payee: getPayee(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .patch("/api/classify/payees/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ payee: updatePayee(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .delete("/api/classify/payees/:id", (c) => {
      writable();
      const id = c.req.param("id");
      deletePayee(ctx(c), { id });
      return c.json({ id }, 200);
    })
    .get("/api/classify/activities", (c) => {
      return c.json({ activities: listActivities(ctx(c), {}) }, 200);
    })
    .post("/api/classify/activities", async (c) => {
      writable();
      return c.json({ activity: createActivity(ctx(c), await objectBody(c)) }, 201);
    })
    .get("/api/classify/activities/:id", (c) => {
      return c.json({ activity: getActivity(ctx(c), { id: c.req.param("id") }) }, 200);
    })
    .patch("/api/classify/activities/:id", async (c) => {
      writable();
      const id = c.req.param("id");
      return c.json({ activity: updateActivity(ctx(c), await objectBody(c, { id })) }, 200);
    })
    .delete("/api/classify/activities/:id", (c) => {
      writable();
      const id = c.req.param("id");
      deleteActivity(ctx(c), { id });
      return c.json({ id }, 200);
    })
    .post("/api/identity/setup-links", (c) => {
      const link = issueSetupLink({ ...ctx(c), tokens: deps.tokens }, {});
      const url = `${deps.publicUrl}/setup?token=${encodeURIComponent(link.token)}`;
      return c.json({ url, expiresAt: link.expiresAt }, 201);
    })
    .post("/api/identity/sign-up", async (c) => {
      const { authn } = deps;
      if (authn.kind === "demo") throw new AppError("Conflict", "Demo mode is read-only");
      const body = signUpBody.parse(await c.req.json().catch(() => undefined));
      // Refuse early, in our own error shape; better-auth's user-create hook checks again.
      checkSignUp(
        { clock: deps.clock, newId: deps.newId, uow: deps.uow, tokens: deps.tokens },
        { token: body.token },
      );
      const { response, personId } = await authn.gateway.signUp(body, c.req.raw.headers);
      if (!response.ok || personId === undefined) throw await authError(response);
      for (const cookie of setCookies(response.headers))
        c.header("Set-Cookie", cookie, { append: true });
      return c.json({ personId }, 201);
    })
    .post("/api/identity/recovery-codes/initial", (c) => {
      // Shown once, right after enrolment first completes: never cache the response.
      return c.json(issueInitialRecoveryCodes(withTokens(c), {}), 201);
    })
    .post("/api/identity/recovery-codes", (c) => {
      return c.json(regenerateRecoveryCodes(withTokens(c), {}), 201);
    })
    .post("/api/identity/recover", async (c) => {
      const gateway = liveGateway();
      const body = recoverBody.parse(await c.req.json().catch(() => undefined));
      return redeemed(c, await gateway.recover(body, c.req.raw.headers));
    })
    .post("/api/identity/re-enrolment-links", async (c) => {
      const body = reEnrolmentLinkBody.parse(await c.req.json().catch(() => undefined));
      const link = issueReEnrolmentLink(withTokens(c), body);
      return c.json(
        { url: reEnrolmentUrl(deps.publicUrl, link.token), expiresAt: link.expiresAt },
        201,
      );
    })
    .post("/api/identity/re-enrolment-links/revoke", (c) => {
      // The affected person ends every unused link issued against them.
      return c.json(revokeMyReEnrolmentLinks(ctx(c), {}), 200);
    })
    .post("/api/identity/re-enrol", async (c) => {
      const gateway = liveGateway();
      const body = reEnrolBody.parse(await c.req.json().catch(() => undefined));
      return redeemed(c, await gateway.reEnrol(body, c.req.raw.headers));
    })
    .get("/api/identity/notices", (c) => {
      return c.json({ notices: listNotices(ctx(c), {}) }, 200);
    })
    .post("/api/identity/notices/:id/dismiss", (c) => {
      dismissNotice(ctx(c), { id: c.req.param("id") });
      return c.body(null, 204);
    });
}

export type AppType = ReturnType<typeof createApi>;

const notFound = (c: Context) => errorResponse(c, new AppError("NotFound", "Not found"));

/** An address as better-auth and config spell it: IPv4-mapped IPv6 as plain IPv4. */
function normalizeIp(address: string): string {
  const trimmed = address.trim();
  return trimmed.toLowerCase().startsWith("::ffff:") && trimmed.includes(".")
    ? trimmed.slice(7)
    : trimmed;
}

/**
 * The client's address: the socket's, unless the socket is a trusted proxy; then the right-most
 * `X-Forwarded-For` entry that is not itself a trusted proxy (entries left of it are
 * client-supplied and could be anything).
 */
export function clientAddress(
  socket: string | undefined,
  forwardedFor: string | undefined,
  trustedProxies: readonly string[],
): string | undefined {
  if (socket === undefined) return undefined;
  const trusted = new Set(trustedProxies.map(normalizeIp));
  const peer = normalizeIp(socket);
  if (!trusted.has(peer) || forwardedFor === undefined) return peer;
  const hops = forwardedFor
    .split(",")
    .map(normalizeIp)
    .filter((hop) => hop !== "");
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i];
    if (hop !== undefined && !trusted.has(hop)) return hop;
  }
  return hops[0] ?? peer;
}

/**
 * better-auth's request with the client's address (see `clientAddress`) in `CLIENT_IP_HEADER`,
 * replacing any value the client sent.
 */
/** The request's client address (`clientAddress`), or undefined without a socket. */
function clientOf(c: Context, trustedProxies: readonly string[]): string | undefined {
  let socket: string | undefined;
  try {
    socket = getConnInfo(c).remote.address;
  } catch {
    // No socket (an in-process test request): callers fall back to one shared bucket.
  }
  return clientAddress(socket, c.req.header("X-Forwarded-For"), trustedProxies);
}

function withClientIp(c: Context, trustedProxies: readonly string[]): Request {
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_IP_HEADER);
  const address = clientOf(c, trustedProxies);
  if (address !== undefined) headers.set(CLIENT_IP_HEADER, address);
  return new Request(c.req.raw, { headers });
}

/**
 * better-auth paths that stay off: its own sign-up (ours checks the setup link), its backup
 * codes (our recovery codes, which also need the password, replace them) and OTP (no sender).
 */
const DISABLED_AUTH_PATHS = [
  "/api/auth/sign-up/*",
  "/api/auth/two-factor/verify-backup-code",
  "/api/auth/two-factor/generate-backup-codes",
  "/api/auth/two-factor/send-otp",
  "/api/auth/two-factor/verify-otp",
];

/** better-auth paths a login that has not finished enrolling may still use. */
const ENROLMENT_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/api/auth/get-session",
  "/api/auth/sign-out",
  "/api/auth/sign-in/email",
  "/api/auth/passkey/generate-authenticate-options",
  "/api/auth/passkey/verify-authentication",
  "/api/auth/passkey/generate-register-options",
  "/api/auth/passkey/verify-registration",
  "/api/auth/two-factor/enable",
  "/api/auth/two-factor/verify-totp",
]);

/** Whether the backup is stale; a read that fails counts as not stale (readiness says so). */
function backupStale(deps: AppDeps): boolean {
  try {
    return backupStatus(deps, deps.backupConfigured ?? false).stale;
  } catch {
    return false;
  }
}

/** Whether the recovery bundle is unconfirmed; a read that fails counts as unconfirmed. */
function bundleUnconfirmed(deps: AppDeps): boolean {
  try {
    return !recoveryBundleConfirmed(deps.uow, deps.bundleId);
  } catch {
    return deps.bundleId !== undefined;
  }
}

/**
 * The whole HTTP surface: the Origin check and session on `/api/*`, better-auth under
 * `/api/auth/*`, the API, then the static PWA with an SPA fallback to the page shell, which is
 * served with a per-request CSP nonce.
 */
export function createApp(deps: AppDeps): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();
  app.onError(createErrorHandler(deps.logInternalError));
  app.use("*", cspOnHtml);
  // Outside /api, so the Origin check and session never apply: NPM, Docker and upgrades probe
  // it anonymously. It reveals only the names of the failing checks.
  // The probe writes to SQLite, so a flood of anonymous requests costs one probe per second.
  let cachedReadiness: { readonly at: number; readonly result: ReadinessOutput } | undefined;
  app.get("/healthz", (c) => {
    c.header("Cache-Control", "no-store");
    const now = deps.clock.now().epochMilliseconds;
    if (cachedReadiness === undefined || now - cachedReadiness.at >= HEALTHZ_CACHE_MS) {
      const { runner } = deps.healthz;
      const result = readiness(
        { systemHealth: deps.systemHealth, clock: deps.clock },
        {
          expectedSchemaVersion: deps.healthz.expectedSchemaVersion,
          runner: runner === "skip" ? "skip" : (runner() ?? null),
          forceUnhealthy: deps.healthz.forceUnhealthy === true,
          // A stale backup is a warning in the body, never a failing check.
          backupStale: backupStale(deps),
          // So is an unconfirmed recovery bundle (AD-27).
          bundleUnconfirmed: bundleUnconfirmed(deps),
        },
      );
      cachedReadiness = { at: now, result };
    }
    const { result } = cachedReadiness;
    return c.json(result, result.ok ? 200 : 503);
  });
  // Every /api response is per viewer or a secret: never cached (AD-3).
  // Set after `next()` on the response itself: Hono drops a header set before it when a handler
  // (better-auth) returns a raw `Response`.
  app.use("/api/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });
  app.use("/api/*", originCheck(deps.publicUrl));
  app.use("/api/*", sessionMiddleware(deps));
  // Our public sign-in routes get the same per-client limit as better-auth's sign-in, one
  // budget per route like its per-path rules.
  for (const path of ["/api/identity/recover", "/api/identity/re-enrol"]) {
    const limit = deps.recoveryRateLimitPerMinute ?? 10;
    app.use(
      path,
      rateLimit(limit, (c) => clientOf(c, deps.trustedProxies ?? [])),
    );
  }
  const { authn } = deps;
  if (authn.kind === "live") {
    // Sign-up goes only through /api/identity/sign-up, which checks the setup link first.
    for (const path of DISABLED_AUTH_PATHS) app.all(path, notFound);
    const trustedProxies = deps.trustedProxies ?? [];
    app.on(["GET", "POST"], "/api/auth/*", async (c) => {
      if (!ENROLMENT_AUTH_PATHS.has(c.req.path)) {
        const { session } = await authn.gateway.getSession(c.req.raw.headers);
        const needs = session === null ? [] : enrolmentNeeds(deps, session.userId);
        if (needs.length > 0) return errorResponse(c, enrolmentIncomplete(needs));
      }
      return authn.gateway.handler(withClientIp(c, trustedProxies));
    });
  }
  app.route("/", createApi(deps));
  app.all("/api/*", notFound);
  if (deps.webRoot !== undefined) {
    const root = deps.webRoot;
    const index = serveIndex(readFileSync(join(root, "index.html"), "utf8"));
    app.get("/", index);
    app.get("/index.html", index);
    // Hashed assets never change; everything else (the service worker, the manifest) revalidates.
    app.use("*", async (c, next) => {
      const immutable = c.req.path.startsWith("/assets/");
      c.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      await next();
    });
    app.use("*", serveStatic({ root }));
    // A missing hashed asset is a 404, never the page shell, and must not be cached.
    app.get("/assets/*", (c) => {
      c.header("Cache-Control", "no-store");
      return notFound(c);
    });
    app.get("*", index);
  }
  return app;
}
