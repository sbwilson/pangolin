// better-auth's hooks into `identity` (story 1.5, AD-1): the user-create gate and audit (setup
// links, at most two people), the login lockout, the re-auth gate on credential changes, and
// the audit of better-auth's credential writes. better-auth's own error shape is kept on
// its routes; the `code` carries our `AppError` code.
import type { AsyncLocalStorage } from "node:async_hooks";
import {
  AppError,
  assertLoginAllowed,
  checkSignUp,
  completeSignUp,
  type ErrorCode,
  type IdentityContext,
  type LockoutPolicy,
  type RecordCredentialChangeInput,
  recordCredentialChange,
  recordLoginAttempt,
  requireRecentAuth,
  sessionViewer,
} from "@pangolin/app";
import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";

/** What our sign-up endpoint knows that better-auth's user row does not. */
export interface SignUpPermit {
  readonly token: string;
  readonly displayName: string;
  readonly colour: string;
  /** Set once the person linked to the new user exists. */
  personId?: string;
}

type ApiStatus = ConstructorParameters<typeof APIError>[0];

const API_STATUS: Readonly<Record<ErrorCode, ApiStatus>> = {
  NotFound: "NOT_FOUND",
  Validation: "BAD_REQUEST",
  Conflict: "CONFLICT",
  Unauthenticated: "UNAUTHORIZED",
  ReauthRequired: "FORBIDDEN",
  RateLimited: "TOO_MANY_REQUESTS",
};

/** An `AppError` as better-auth's `APIError`, keeping its code and message; others unchanged. */
export function toApiError(error: unknown): unknown {
  if (!(error instanceof AppError)) return error;
  return new APIError(API_STATUS[error.code], { code: error.code, message: error.message });
}

/** Runs a synchronous use case, rethrowing an `AppError` as an `APIError`. */
function asApi<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toApiError(error);
  }
}

/** Where hooks report what they cannot throw: a message only, never a token. */
export type HookLog = (level: "warn" | "error", message: string) => void;

/**
 * `databaseHooks`: a user is created only inside our sign-up endpoint (which holds a permit)
 * and only while `identity.checkSignUp` passes. Right after the insert, `completeSignUp`
 * consumes the link and creates the audited person; if that fails the user is deleted again
 * (its sessions and accounts cascade), so no login ever exists without its person. A change of
 * the TOTP flag is audited (AD-1).
 */
export function signUpHooks(
  ctx: IdentityContext,
  permits: AsyncLocalStorage<SignUpPermit>,
  log: HookLog,
): NonNullable<BetterAuthOptions["databaseHooks"]> {
  return {
    user: {
      create: {
        before: async () => {
          const permit = permits.getStore();
          if (permit === undefined) {
            throw toApiError(new AppError("Validation", "Sign up with a setup link"));
          }
          asApi(() => checkSignUp(ctx, { token: permit.token }));
        },
        after: async (user, endpoint) => {
          const permit = permits.getStore();
          try {
            if (permit === undefined) throw new AppError("Validation", "Sign up with a setup link");
            permit.personId = completeSignUp(ctx, {
              token: permit.token,
              userId: user.id,
              email: user.email,
              displayName: permit.displayName,
              colour: permit.colour,
            });
          } catch (error) {
            const adapter = endpoint?.context.internalAdapter;
            if (adapter === undefined) {
              log("error", "A sign-up failed and its new user could not be removed: no adapter");
              throw new Error(
                "Sign-up failed, and the new user could not be removed: better-auth gave no adapter",
                { cause: error },
              );
            }
            try {
              await adapter.deleteUser(user.id);
            } catch (cleanup) {
              const reason = cleanup instanceof Error ? cleanup.message : String(cleanup);
              log("error", `A sign-up failed and its new user could not be removed: ${reason}`);
            }
            throw toApiError(error);
          }
        },
      },
      update: {
        after: async (user, endpoint) => {
          const path = endpoint?.path;
          const enabled = (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled;
          let action: "enable" | "disable" | undefined;
          if (path === "/two-factor/verify-totp" && enabled === true) action = "enable";
          if (path === "/two-factor/disable" && enabled !== true) action = "disable";
          if (action === undefined) return;
          recordCredentialChange(ctx, {
            userId: user.id,
            entity: "two_factor",
            entityId: user.id,
            action,
          });
        },
      },
    },
  };
}

const SIGN_IN = "/sign-in/email";
const VERIFY_TOTP = "/two-factor/verify-totp";
const VERIFY_PASSKEY = "/passkey/verify-authentication";
const REGISTER_PASSKEY = "/passkey/verify-registration";
const DELETE_PASSKEY = "/passkey/delete-passkey";

/**
 * better-auth routes that add, change or reveal a credential: they need a sign-in within the
 * last 5 minutes (`identity.requireRecentAuth`). Enrolment right after sign-up is within it.
 */
export const RECENT_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/passkey/generate-register-options",
  REGISTER_PASSKEY,
  DELETE_PASSKEY,
  "/passkey/update-passkey",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/get-totp-uri",
  "/change-password",
  "/change-email",
  "/delete-user",
  "/link-social",
  "/unlink-account",
]);

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * The email a password or TOTP attempt is for: the body's email on sign-in; for a TOTP code,
 * the user behind the pending two-factor cookie, or the signed-in user while enrolling.
 */
async function attemptEmail(ctx: HookContext): Promise<string | undefined> {
  if (ctx.path === SIGN_IN) {
    const email = (ctx.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" ? email : undefined;
  }
  if (ctx.path !== VERIFY_TOTP) return undefined;
  const cookie = ctx.context.createAuthCookie("two_factor");
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (typeof identifier === "string" && identifier !== "") {
    const pending = await ctx.context.internalAdapter.findVerificationValue(identifier);
    if (pending !== null && pending !== undefined) {
      const user = await ctx.context.internalAdapter.findUserById(pending.value);
      if (user !== null) return user.email;
    }
  }
  const session = await getSessionFromCtx(ctx).catch(() => null);
  return session?.user.email;
}

/** Refuses a credential change unless the session signed in within the re-auth window. */
async function assertRecentAuth(
  ctx: Pick<IdentityContext, "clock" | "uow">,
  hook: HookContext,
): Promise<void> {
  const session = await getSessionFromCtx(hook).catch(() => null);
  if (session === null) return; // better-auth's own session check answers 401.
  const viewer = sessionViewer(ctx, {
    userId: session.user.id,
    createdAt: new Date(session.session.createdAt),
  });
  if (viewer === undefined) throw toApiError(new AppError("Unauthenticated", "Sign in first"));
  asApi(() => requireRecentAuth({ viewer, clock: ctx.clock }));
}

/** Audits a passkey better-auth added or deleted, as the signed-in person. */
async function auditPasskey(
  ctx: Pick<IdentityContext, "clock" | "uow" | "newId">,
  hook: HookContext,
): Promise<void> {
  const returned = hook.context.returned;
  if (returned === undefined || isAPIError(returned)) return;
  const session = await getSessionFromCtx(hook).catch(() => null);
  if (session === null) return;
  const change: Omit<RecordCredentialChangeInput, "entityId"> = {
    userId: session.user.id,
    entity: "passkey",
    action: hook.path === REGISTER_PASSKEY ? "create" : "delete",
  };
  const id =
    hook.path === REGISTER_PASSKEY
      ? (returned as { id?: unknown }).id
      : (hook.body as { id?: unknown } | undefined)?.id;
  if (typeof id === "string" && id !== "") recordCredentialChange(ctx, { ...change, entityId: id });
}

/**
 * `hooks`: the lockout, the re-auth gate and passkey audit.
 * - Before a password sign-in or TOTP check reaches better-auth, a locked email is refused with
 *   429 `RateLimited`, so correct credentials during a lockout never reach it. Afterwards a
 *   rejected password or code counts as a failure, and a new session (password without 2FA,
 *   TOTP, or passkey) as a success. A right password awaiting its TOTP code counts as neither.
 * - A credential change (`RECENT_AUTH_PATHS`) with a session older than 5 minutes is refused
 *   with 403 `ReauthRequired`.
 * - A passkey added or deleted is audited (AD-1).
 */
export function authHooks(
  ctx: Pick<IdentityContext, "clock" | "uow" | "newId">,
  policy: LockoutPolicy,
): NonNullable<BetterAuthOptions["hooks"]> {
  return {
    before: createAuthMiddleware(async (hook) => {
      if (RECENT_AUTH_PATHS.has(hook.path)) await assertRecentAuth(ctx, hook);
      if (hook.path !== SIGN_IN && hook.path !== VERIFY_TOTP) return;
      const email = await attemptEmail(hook);
      if (email === undefined) return;
      asApi(() => assertLoginAllowed(ctx, { email }, policy));
    }),
    after: createAuthMiddleware(async (hook) => {
      if (hook.path === REGISTER_PASSKEY || hook.path === DELETE_PASSKEY) {
        await auditPasskey(ctx, hook);
        return;
      }
      if (hook.path !== SIGN_IN && hook.path !== VERIFY_TOTP && hook.path !== VERIFY_PASSKEY) {
        return;
      }
      const session = hook.context.newSession;
      if (session !== null && session !== undefined) {
        // Our hook runs before the two-factor plugin's, which then swaps this session for a TOTP
        // challenge: a right password alone is not a success.
        const pendingTotp =
          hook.path === SIGN_IN &&
          (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;
        if (!pendingTotp) recordLoginAttempt(ctx, { email: session.user.email, ok: true }, policy);
        return;
      }
      const returned = hook.context.returned;
      if (hook.path === VERIFY_PASSKEY) return;
      if (!isAPIError(returned) || returned.statusCode !== 401) return;
      const email = await attemptEmail(hook);
      if (email !== undefined) recordLoginAttempt(ctx, { email, ok: false }, policy);
    }),
  };
}
