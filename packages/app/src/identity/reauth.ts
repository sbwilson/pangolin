// Re-authentication for sensitive actions (spine: Re-authentication convention). The window is
// per action; a use case calls `requireRecentAuth` before anything else.
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";

/** The default re-authentication window: 5 minutes. */
export const REAUTH_WINDOW_MS = 5 * 60_000;

/**
 * Throws `ReauthRequired` when a person last authenticated more than `windowMs` ago
 * (`viewer.authAt` is the start of their session). System viewers (jobs, the admin CLI) are
 * never asked to re-authenticate.
 */
export function requireRecentAuth(
  ctx: Pick<UseCaseContext, "viewer" | "clock">,
  windowMs: number = REAUTH_WINDOW_MS,
): void {
  if (ctx.viewer.kind !== "person") return;
  const age = ctx.clock.now().epochMilliseconds - ctx.viewer.authAt.epochMilliseconds;
  if (age > windowMs) {
    throw new AppError("ReauthRequired", "Sign in again to do this");
  }
}
