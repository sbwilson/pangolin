import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  AppError,
  type Clock,
  checkSignUp,
  deadJobs,
  ERROR_CODES,
  type ErrorCode,
  enrolmentNeeds,
  health,
  type IdGenerator,
  issueSetupLink,
  me,
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
import {
  type Authn,
  CLIENT_IP_HEADER,
  enrolmentIncomplete,
  type SessionEnv,
  sessionMiddleware,
} from "./session.ts";

export interface ApiDeps {
  readonly systemHealth: SystemHealthPort;
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly tokens: TokenPort;
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
function withClientIp(c: Context, trustedProxies: readonly string[]): Request {
  const headers = new Headers(c.req.raw.headers);
  headers.delete(CLIENT_IP_HEADER);
  let socket: string | undefined;
  try {
    socket = getConnInfo(c).remote.address;
  } catch {
    // No socket (an in-process test request): better-auth falls back to one shared bucket.
  }
  const address = clientAddress(socket, c.req.header("X-Forwarded-For"), trustedProxies);
  if (address !== undefined) headers.set(CLIENT_IP_HEADER, address);
  return new Request(c.req.raw, { headers });
}

/** better-auth paths off in this story: recovery codes are story 1.6; OTP has no sender. */
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
  app.use("/api/*", originCheck(deps.publicUrl));
  app.use("/api/*", sessionMiddleware(deps));
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
