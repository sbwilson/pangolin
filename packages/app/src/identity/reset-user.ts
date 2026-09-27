// `pangolin reset-user` (story 1.6; the CLI and admin socket are story 1.9): for when both of us
// are locked out. Runs only as the `cli:reset-user` system viewer, which HTTP can never build
// (AD-6). It clears the person's sign-in at once and issues a re-enrolment link.
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import { write } from "../write.ts";
import {
  type ClearedCredentials,
  clearCredentials,
  type IssuedReEnrolmentLink,
  insertReEnrolmentLink,
  type ReEnrolmentContext,
  unusablePasswordHash,
} from "./re-enrolment.ts";

/** The only actor `resetUser` runs as. */
export const RESET_USER_ACTOR = "cli:reset-user";

export const resetUserInput = z.object({ personId: z.string().min(1).max(100) }).strict();
export type ResetUserInput = z.input<typeof resetUserInput>;

export interface ResetUserResult {
  readonly link: IssuedReEnrolmentLink;
  readonly cleared: ClearedCredentials;
}

/**
 * `identity.resetUser`: in one transaction, clears the person's passkeys, TOTP, sessions and
 * recovery codes and replaces their password with one nobody knows (so the old password cannot
 * open an enrolment session meanwhile; the link sets a new one), then issues a 24-hour
 * re-enrolment link with `issued_by` = `cli:reset-user` and raises the person's
 * `identity.partner-reset` notice. Everything is audited as `cli:reset-user`. Throws
 * `Unauthenticated` for any viewer but that system viewer, and `NotFound` for anyone who is not
 * an active person with a login. The caller turns the token into a URL (`reEnrolmentUrl`).
 */
export function resetUser(ctx: ReEnrolmentContext, input: ResetUserInput): ResetUserResult {
  const { personId } = parseInput(resetUserInput, input);
  if (ctx.viewer.kind !== "system" || ctx.viewer.actor !== RESET_USER_ACTOR) {
    throw new AppError("Unauthenticated", "Only the server console can reset a user");
  }
  const token = ctx.tokens.generate();
  return write(ctx, (tx, audit) => {
    const person = tx.person.listActive().find((row) => row.id === personId);
    if (person === undefined || person.userId === null) {
      throw new AppError("NotFound", "No such person");
    }
    const withLogin = { ...person, userId: person.userId };
    // The old password must not open an enrolment session before the owner redeems the link.
    const unusable = unusablePasswordHash(ctx.tokens);
    const cleared = clearCredentials(ctx, tx, audit, withLogin, "reset-user", unusable);
    const link = insertReEnrolmentLink(ctx, tx, audit, person.id, RESET_USER_ACTOR, token);
    return { link, cleared };
  });
}
