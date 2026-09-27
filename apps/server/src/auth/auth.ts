// The better-auth instance (story 1.5), built in the composition root on our SQLite connection:
// email and password, TOTP (`twoFactor`) and passkeys, with its tables from our migration 0003.
import { AsyncLocalStorage } from "node:async_hooks";
import { passkey } from "@better-auth/passkey";
import type { IdentityContext } from "@pangolin/app";
import { createAuthAdapter, type Db } from "@pangolin/db";
import { betterAuth } from "better-auth";
import { isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import type { AuthConfig } from "../config.ts";
import { type AuthGateway, CLIENT_IP_HEADER, type SignUpRequest } from "../http/session.ts";
import { authHooks, type SignUpPermit, signUpHooks } from "./hooks.ts";
import { recoveryGateway, recoverySessions } from "./recovery.ts";
import { recoveryCodeHasher } from "./secret.ts";

export const APP_NAME = "Pangolin Money";

export interface AuthDeps extends IdentityContext {
  readonly db: Db;
  readonly config: AuthConfig;
  readonly secret: string;
  /** Receives better-auth's warnings and errors: the message only, never its arguments. */
  readonly log?: (level: "warn" | "error", message: string) => void;
}

const defaultLog = (level: "warn" | "error", message: string): void => {
  console.error(JSON.stringify({ time: new Date().toISOString(), level, msg: "auth", message }));
};

/**
 * Cookie attributes: always `HttpOnly`, `Secure` and `SameSite=Strict`, with the `__Host-`
 * prefix when the public URL is https (browsers accept `Secure` from `http://localhost`).
 */
export function cookieSettings(publicUrl: string) {
  const https = new URL(publicUrl).protocol === "https:";
  return {
    // The prefix is ours (`__Host-` needs Secure, Path=/ and no Domain, all set below), so
    // better-auth's own `__Secure-` prefix stays off.
    useSecureCookies: false,
    cookiePrefix: https ? "__Host-pangolin" : "pangolin",
    defaultCookieAttributes: {
      httpOnly: true,
      secure: true,
      sameSite: "strict" as const,
      path: "/",
    },
  };
}

function buildAuth(deps: AuthDeps, permits: AsyncLocalStorage<SignUpPermit>) {
  const { config } = deps;
  const rpID = new URL(config.publicUrl).hostname;
  const idleSeconds = Math.round(config.sessionIdleMs / 1000);
  const log = deps.log ?? defaultLog;
  return betterAuth({
    appName: APP_NAME,
    baseURL: config.publicUrl,
    basePath: "/api/auth",
    secret: deps.secret,
    trustedOrigins: [config.publicUrl],
    database: createAuthAdapter(deps.db),
    telemetry: { enabled: false },
    logger: {
      level: "warn",
      log: (level, message) => {
        if (level === "warn" || level === "error") log(level, message);
      },
    },
    // Routine refusals (a wrong password, a lockout) are not logged; failures are, message only.
    onAPIError: {
      onError: (error) => {
        if (isAPIError(error)) {
          if (error.statusCode >= 500) log("error", error.message);
          return;
        }
        log("error", error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 256,
      autoSignIn: true,
    },
    session: {
      // Idle timeout: the session lives `idle` past its last refresh, refreshed at most once a
      // minute while in use.
      expiresIn: idleSeconds,
      updateAge: Math.min(60, idleSeconds),
      freshAge: idleSeconds,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/*": { window: 60, max: config.rateLimitPerMinute },
        "/two-factor/*": { window: 60, max: config.rateLimitPerMinute },
      },
    },
    advanced: {
      ...cookieSettings(config.publicUrl),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      database: { generateId: () => deps.newId() },
    },
    databaseHooks: signUpHooks(deps, permits, log),
    hooks: authHooks(deps, config.lockout),
    plugins: [
      twoFactor({ issuer: APP_NAME }),
      passkey({ rpID, rpName: APP_NAME, origin: config.publicUrl }),
      recoverySessions(),
    ],
  });
}

/**
 * The better-auth instance behind the `AuthGateway` the HTTP entry uses. Sign-ups run one at a
 * time, so the gate (at most two people) cannot race.
 */
export function createAuth(deps: AuthDeps): AuthGateway {
  const permits = new AsyncLocalStorage<SignUpPermit>();
  const auth = buildAuth(deps, permits);
  let signUps: Promise<unknown> = Promise.resolve();

  const signUp = async (input: SignUpRequest, headers: Headers) => {
    const permit: SignUpPermit = {
      token: input.token,
      displayName: input.displayName,
      colour: input.colour,
    };
    const response = await permits.run(permit, () =>
      auth.api.signUpEmail({
        body: { email: input.email, password: input.password, name: input.displayName },
        headers,
        asResponse: true,
      }),
    );
    return { response, personId: permit.personId };
  };

  return {
    ...recoveryGateway(
      { ...deps, codes: recoveryCodeHasher(deps.secret) },
      deps.config.lockout,
      auth,
      deps.log ?? defaultLog,
    ),
    handler: (request) => auth.handler(request),
    getSession: async (headers) => {
      const result = await auth.api.getSession({ headers, returnHeaders: true });
      const setCookies = result.headers?.getSetCookie() ?? [];
      const data = result.response;
      if (data === null) return { session: null, setCookies };
      return {
        session: { userId: data.session.userId, createdAt: new Date(data.session.createdAt) },
        setCookies,
      };
    },
    signUp: (input, headers) => {
      const next = signUps.then(() => signUp(input, headers));
      signUps = next.catch(() => undefined);
      return next;
    },
  };
}
