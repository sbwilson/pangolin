// Session → viewer (story 1.5). Every `/api/*` route except the public ones resolves the
// session cookie to `personViewer(personId, authAt)` or answers 401 `Unauthenticated`.
import {
  AppError,
  demoViewer,
  type EnrolmentStep,
  enrolmentNeeds,
  type PersonViewer,
  sessionViewer,
  type UnitOfWork,
  type UseCaseContext,
} from "@pangolin/app";
import type { MiddlewareHandler } from "hono";
import { errorResponse } from "./errors.ts";

/**
 * The header the HTTP entry puts the client's socket address in (replacing any value the client
 * sent) before handing a request to better-auth, whose rate limit keys on it.
 */
export const CLIENT_IP_HEADER = "x-pangolin-client-ip";

/** A better-auth session, as much of it as the HTTP entry needs. */
export interface AuthSession {
  readonly userId: string;
  /** When the session was created: the last full authentication. */
  readonly createdAt: Date;
}

/** What our sign-up endpoint hands to better-auth, after `identity.checkSignUp` passed. */
export interface SignUpRequest {
  readonly token: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly colour: string;
}

/** Recovery-code sign-in (story 1.6): all three are required, and checked together. */
export interface RecoverRequest {
  readonly email: string;
  readonly password: string;
  readonly code: string;
}

/** Redeeming a re-enrolment link (story 1.6) with the person's new password. */
export interface ReEnrolRequest {
  readonly token: string;
  readonly newPassword: string;
}

/** A session issued outside better-auth's own sign-in routes. */
export interface IssuedSession {
  /** The login it belongs to. */
  readonly userId: string;
  /**
   * False when the redemption committed but no session could be started: the person then
   * signs in normally. `setCookies` is empty then.
   */
  readonly signedIn: boolean;
  /** The session cookie, with the same strict attributes as every other sign-in. */
  readonly setCookies: string[];
}

/**
 * The sign-in machinery the HTTP entry uses, implemented over better-auth in `auth/auth.ts`.
 * Kept as an interface so `http/` does not depend on better-auth's types.
 */
export interface AuthGateway {
  /** better-auth's own routes, under `/api/auth/*`. */
  handler(request: Request): Promise<Response>;
  /**
   * The session for the request's cookies, or null. `setCookies` carries a refreshed session
   * cookie (sliding idle timeout) to pass on to the response.
   */
  getSession(headers: Headers): Promise<{ session: AuthSession | null; setCookies: string[] }>;
  /**
   * Creates the login, the person and the used link, and signs in. Resolves with better-auth's
   * response (its `Set-Cookie` headers carry the session) and, on success, the new person.
   */
  signUp(
    input: SignUpRequest,
    headers: Headers,
  ): Promise<{ response: Response; personId: string | undefined }>;
  /**
   * Signs in with email, password and a recovery code: refused with `RateLimited` while the
   * email is locked out, and with one `Unauthenticated` for any wrong part (each counted toward
   * the lockout). On success the login's passkeys and sessions are gone and the new session can
   * reach only passkey enrolment.
   */
  recover(input: RecoverRequest, headers: Headers): Promise<IssuedSession>;
  /**
   * Redeems a re-enrolment link: sets the new password, clears every credential and signs in
   * to a session that must enrol a passkey and TOTP. `Validation` for a dead link.
   */
  reEnrol(input: ReEnrolRequest, headers: Headers): Promise<IssuedSession>;
}

/** Live sign-in through better-auth, or demo mode's fixed viewer. */
export type Authn =
  | { readonly kind: "live"; readonly gateway: AuthGateway }
  | { readonly kind: "demo" };

export interface SessionEnv {
  /** `needs`: enrolment steps the login still lacks (empty once set up, and in demo mode). */
  Variables: { viewer: PersonViewer; needs: EnrolmentStep[] };
}

/** The one protected route a login that has not finished enrolling may reach. */
export const ENROLMENT_OPEN_PATH = "/api/identity/me";

/** 401 for a login that still lacks a passkey or TOTP, naming what it lacks. */
export function enrolmentIncomplete(needs: readonly EnrolmentStep[]): AppError {
  return new AppError("Unauthenticated", "Finish setting up your sign-in first", {
    enrolment: "incomplete",
    needs,
  });
}

/** `/api/*` paths that need no session. */
export function isPublicApiPath(path: string): boolean {
  return (
    path === "/api/system/health" ||
    path === "/api/identity/sign-up" ||
    path === "/api/identity/recover" ||
    path === "/api/identity/re-enrol" ||
    path === "/api/auth" ||
    path.startsWith("/api/auth/")
  );
}

const unauthenticated = () => new AppError("Unauthenticated", "Sign in first");

/**
 * Middleware for `/api/*`: sets `viewer` from the session (live) or to the first seeded person
 * (demo), or answers 401 `Unauthenticated`. A login that has not enrolled both a passkey and
 * TOTP reaches only `/api/identity/me` (which reports what is missing); anything else answers
 * 401 with `{ enrolment: "incomplete", needs }` as details. Public paths pass through untouched.
 */
export function sessionMiddleware(deps: {
  readonly authn: Authn;
  readonly uow: UnitOfWork;
  readonly clock: UseCaseContext["clock"];
}): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    if (isPublicApiPath(c.req.path)) return next();
    if (deps.authn.kind === "demo") {
      const viewer = demoViewer(deps);
      if (viewer === undefined) return errorResponse(c, unauthenticated());
      c.set("viewer", viewer);
      c.set("needs", []);
      return next();
    }
    const { session, setCookies } = await deps.authn.gateway.getSession(c.req.raw.headers);
    const viewer = session === null ? undefined : sessionViewer(deps, session);
    const needs = session === null ? [] : enrolmentNeeds(deps, session.userId);
    if (viewer === undefined || (needs.length > 0 && c.req.path !== ENROLMENT_OPEN_PATH)) {
      const error = viewer === undefined ? unauthenticated() : enrolmentIncomplete(needs);
      const res = errorResponse(c, error);
      for (const cookie of setCookies) res.headers.append("Set-Cookie", cookie);
      return res;
    }
    c.set("viewer", viewer);
    c.set("needs", needs);
    await next();
    for (const cookie of setCookies) c.res.headers.append("Set-Cookie", cookie);
    return undefined;
  };
}
