// Account recovery's better-auth glue (story 1.6): verifying a password and hashing a new one
// with better-auth's own hasher, issuing a session outside its sign-in routes with its own
// cookie helpers (so the cookie attributes are identical), and the login lockout for
// recovery-code sign-in. The rules themselves are `identity` use cases.
import {
  AppError,
  type CodeHasher,
  checkReEnrolmentLink,
  type IdentityContext,
  type LockoutPolicy,
  recordLoginAttempt,
  recoveryRefused,
  redeemRecoveryCode,
  redeemReEnrolmentLink,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from "@pangolin/app";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import type { AuthGateway, IssuedSession } from "../http/session.ts";

/** The server-only endpoint that starts a session for a login whose recovery just succeeded. */
export const START_SESSION_PATH = "/pangolin/start-session";

/**
 * A better-auth plugin with one endpoint, `startSession`, that creates a session for `userId`
 * and sets its cookie through better-auth's `setSessionCookie`. It is `SERVER_ONLY`: better-auth
 * never routes it over HTTP, so only our recovery use cases, after they succeed, can call it.
 */
export function recoverySessions() {
  return {
    id: "pangolin-recovery",
    endpoints: {
      startSession: createAuthEndpoint(
        START_SESSION_PATH,
        {
          method: "POST",
          body: z.object({ userId: z.string().min(1) }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
          if (user === null) throw new APIError("UNAUTHORIZED", { message: "No such login" });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "No session" });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

/** What recovery needs from the better-auth instance. */
export interface RecoveryAuth {
  readonly $context: Promise<{
    readonly internalAdapter: {
      findUserById(userId: string): Promise<{ email: string } | null>;
      findUserByEmail(
        email: string,
        options: { includeAccounts: true },
      ): Promise<{
        user: { id: string };
        accounts: { providerId: string; accountId: string; password?: string | null | undefined }[];
      } | null>;
    };
    readonly password: {
      hash(password: string): Promise<string>;
      verify(input: { hash: string; password: string }): Promise<boolean>;
    };
  }>;
  readonly api: {
    startSession(input: {
      body: { userId: string };
      headers: Headers;
      asResponse: true;
    }): Promise<Response>;
  };
}

/**
 * The login whose password `password` is, or undefined. Like better-auth's sign-in, a missing
 * login or password still costs one hash, so timing does not tell them apart.
 */
async function verifiedUser(
  auth: RecoveryAuth,
  email: string,
  password: string,
): Promise<string | undefined> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  const credential = found?.accounts.find(
    (account) => account.providerId === "credential" && account.accountId === found.user.id,
  );
  const hash = credential?.password;
  if (found === null || typeof hash !== "string" || hash === "") {
    await ctx.password.hash(password);
    return undefined;
  }
  return (await ctx.password.verify({ hash, password })) ? found.user.id : undefined;
}

async function startSession(
  auth: RecoveryAuth,
  userId: string,
  headers: Headers,
): Promise<IssuedSession> {
  const response = await auth.api.startSession({ body: { userId }, headers, asResponse: true });
  if (!response.ok) throw new Error(`better-auth could not start a session (${response.status})`);
  return { userId, signedIn: true, setCookies: response.headers.getSetCookie() };
}

/** Where recovery reports a failure it cannot answer with: a message only, never a secret. */
export type RecoveryLog = (level: "warn" | "error", message: string) => void;

/**
 * Runs what follows a committed redemption. The code or link is spent by then, so a failure
 * here must not become a 500: it is logged, and the person is told to sign in normally.
 */
async function afterCommit(
  log: RecoveryLog,
  userId: string,
  fn: () => Promise<IssuedSession>,
): Promise<IssuedSession> {
  try {
    return await fn();
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    log("error", `Recovery succeeded but no session could be started: ${reason}`);
    return { userId, signedIn: false, setCookies: [] };
  }
}

/**
 * `recover` and `reEnrol` for the `AuthGateway`.
 * - `recover`: a locked email is refused before anything is checked; otherwise the attempt is
 *   counted as a failure up front. A wrong email, password or code (unknown, malformed or used)
 *   is one `Unauthenticated` and keeps that failed `login_attempt`; any other error releases
 *   it. A success replaces it with a successful attempt, then starts the session.
 * - `reEnrol`: a dead link is refused before the new password is hashed; the hash is made
 *   outside the write (AD-2), and the use case checks the link again inside it. A redemption
 *   records a successful attempt for the email, ending any lockout on the old password.
 * If starting the session fails after the redemption committed, the answer is
 * `signedIn: false` rather than an error (see `afterCommit`).
 */
export function recoveryGateway(
  deps: IdentityContext & { readonly codes: CodeHasher },
  policy: LockoutPolicy,
  auth: RecoveryAuth,
  log: RecoveryLog,
): Pick<AuthGateway, "recover" | "reEnrol"> {
  return {
    recover: async (input, headers) => {
      const email = input.email.trim().toLowerCase();
      // Counted as a failure before the password is hashed, so a concurrent burst cannot all
      // pass the lockout check (seam S11a).
      reserveLoginAttempt(deps, { email }, policy);
      let userId: string | undefined;
      try {
        userId = await verifiedUser(auth, email, input.password);
        if (userId === undefined) throw recoveryRefused();
        redeemRecoveryCode(deps, { userId, code: input.code });
      } catch (error) {
        // A wrong email, password or code keeps the failure; anything else counts as neither.
        if (!(error instanceof AppError && error.code === "Unauthenticated")) {
          try {
            releaseLoginAttempt(deps, { email });
          } catch {
            // The original error is the answer; an unreleased attempt stays counted as a failure.
          }
        }
        throw error;
      }
      releaseLoginAttempt(deps, { email });
      recordLoginAttempt(deps, { email, ok: true }, policy);
      const recovered = userId;
      return afterCommit(log, recovered, () => startSession(auth, recovered, headers));
    },
    reEnrol: async (input, headers) => {
      checkReEnrolmentLink(deps, { token: input.token });
      const ctx = await auth.$context;
      const passwordHash = await ctx.password.hash(input.newPassword);
      const { userId } = redeemReEnrolmentLink(deps, { token: input.token, passwordHash });
      return afterCommit(log, userId, async () => {
        // The password the failures were guessing at is gone: the redemption counts as a
        // success, so an earlier lockout does not block the person's re-enrolment.
        const user = await ctx.internalAdapter.findUserById(userId);
        if (user !== null) recordLoginAttempt(deps, { email: user.email, ok: true }, policy);
        return startSession(auth, userId, headers);
      });
    },
  };
}
