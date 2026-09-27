import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  AppError,
  type Clock,
  type CodeHasher,
  checkSignUp,
  deadJobs,
  dismissNotice,
  ERROR_CODES,
  type ErrorCode,
  enrolmentNeeds,
  health,
  type IdGenerator,
  issueInitialRecoveryCodes,
  issueReEnrolmentLink,
  issueSetupLink,
  listNotices,
  me,
  type ReadinessOutput,
  type RunnerLiveness,
  readiness,
  reEnrolmentUrl,
  regenerateRecoveryCodes,
  revokeMyReEnrolmentLinks,
  type SystemHealthPort,
  type TokenPort,
  type UnitOfWork,
  type UseCaseContext,
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
  const passCookies = (c: Context, cookies: readonly string[]) => {
    for (const cookie of cookies) c.header("Set-Cookie", cookie, { append: true });
  };
  return new Hono<SessionEnv>()
    .get("/api/system/health", (c) => {
      c.header("Cache-Control", "no-store");
      const result = health({ systemHealth: deps.systemHealth }, {});
      if (result.writable) return c.json(result, 200);
      return c.json(result, 503);
    })
    .get("/api/system/jobs", (c) => {
      // Kind and failure time only: never payload, error text or IDs (AD-9).
      c.header("Cache-Control", "no-store");
      return c.json({ dead: deadJobs({ uow: deps.uow }, {}) }, 200);
    })
    .get("/api/identity/me", (c) => {
      c.header("Cache-Control", "no-store");
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
    .post("/api/identity/setup-links", (c) => {
      c.header("Cache-Control", "no-store");
      const link = issueSetupLink({ ...ctx(c), tokens: deps.tokens }, {});
      const url = `${deps.publicUrl}/setup?token=${encodeURIComponent(link.token)}`;
      return c.json({ url, expiresAt: link.expiresAt }, 201);
    })
    .post("/api/identity/sign-up", async (c) => {
      c.header("Cache-Control", "no-store");
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
      c.header("Cache-Control", "no-store");
      return c.json(issueInitialRecoveryCodes(withTokens(c), {}), 201);
    })
    .post("/api/identity/recovery-codes", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(regenerateRecoveryCodes(withTokens(c), {}), 201);
    })
    .post("/api/identity/recover", async (c) => {
      c.header("Cache-Control", "no-store");
      const gateway = liveGateway();
      const body = recoverBody.parse(await c.req.json().catch(() => undefined));
      return redeemed(c, await gateway.recover(body, c.req.raw.headers));
    })
    .post("/api/identity/re-enrolment-links", async (c) => {
      c.header("Cache-Control", "no-store");
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
      c.header("Cache-Control", "no-store");
      const gateway = liveGateway();
      const body = reEnrolBody.parse(await c.req.json().catch(() => undefined));
      return redeemed(c, await gateway.reEnrol(body, c.req.raw.headers));
    })
    .get("/api/identity/notices", (c) => {
      c.header("Cache-Control", "no-store");
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
        },
      );
      cachedReadiness = { at: now, result };
    }
    const { result } = cachedReadiness;
    return c.json(result, result.ok ? 200 : 503);
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
