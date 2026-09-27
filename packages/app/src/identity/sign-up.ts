// Sign-up through a setup link (story 1.5). better-auth creates the login; these use cases gate
// it (`checkSignUp`, before the user row exists) and complete it (`completeSignUp`, right after:
// consume the link and create the linked person, all audited in one transaction).
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { TokenPort } from "../ports/tokens.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import { createPersonInput, insertPerson } from "./create-person.ts";
import {
  invalidSetupLink,
  liveSetupLink,
  MAX_USERS,
  registrationClosed,
  setupLinkAuditView,
  setupTokenSchema,
} from "./setup-links.ts";

/**
 * What sign-up and login use cases run with. There is no viewer yet: nobody is signed in. A use
 * case that writes audits as the person it creates.
 */
export interface IdentityContext extends Omit<UseCaseContext, "viewer"> {
  readonly tokens: TokenPort;
}

export const checkSignUpInput = z.object({ token: setupTokenSchema }).strict();
export type CheckSignUpInput = z.input<typeof checkSignUpInput>;

/**
 * `identity.checkSignUp`: throws `Conflict` ("Registration is closed") once two people have a
 * login, whatever the token; otherwise `Validation` unless `token` is an unused, unexpired link.
 * Writes nothing.
 */
export function checkSignUp(ctx: IdentityContext, input: CheckSignUpInput): void {
  const { token } = parseInput(checkSignUpInput, input);
  const now = formatInstant(ctx.clock.now());
  ctx.uow.read((repos) => {
    if (repos.users.count() >= MAX_USERS) throw registrationClosed();
    liveSetupLink(repos, ctx.tokens, token, now);
  });
}

export const completeSignUpInput = z
  .object({
    token: setupTokenSchema,
    /** The better-auth user just created. */
    userId: z.string().min(1).max(100),
    email: z.string().min(1).max(320),
    displayName: createPersonInput.shape.displayName,
    colour: createPersonInput.shape.colour,
  })
  .strict();
export type CompleteSignUpInput = z.input<typeof completeSignUpInput>;

/**
 * `identity.completeSignUp`: runs right after better-auth inserts the user. In one transaction
 * it re-checks the gate (the new user must be at most the second), marks the link used and
 * creates the person linked to the user, auditing the user's `create`, the person's `create` and
 * the link's `use`, all as the new person. Throws like `checkSignUp`; the caller then deletes
 * the user so no login exists without its person. Returns the new person's ID.
 */
export function completeSignUp(ctx: IdentityContext, input: CompleteSignUpInput): Id<"Person"> {
  const parsed = parseInput(completeSignUpInput, input);
  const personId = ctx.newId<"Person">();
  const nowInstant = ctx.clock.now();
  const now = formatInstant(nowInstant);
  const writeCtx: UseCaseContext = { ...ctx, viewer: personViewer(personId, nowInstant) };
  return write(writeCtx, (tx, audit) => {
    // The count includes the user being completed.
    if (tx.users.count() > MAX_USERS) throw registrationClosed();
    const link = liveSetupLink(tx, ctx.tokens, parsed.token, now);
    if (!tx.setupLinks.markUsed(link.id, now)) throw invalidSetupLink();
    audit({
      entity: "user",
      entityId: parsed.userId,
      action: "create",
      before: null,
      after: { id: parsed.userId, email: parsed.email, personId },
    });
    insertPerson(writeCtx, tx, audit, personId, {
      displayName: parsed.displayName,
      colour: parsed.colour,
      userId: parsed.userId,
    });
    audit({
      entity: "setup_link",
      entityId: link.id,
      action: "use",
      before: setupLinkAuditView(link),
      after: setupLinkAuditView({ ...link, usedAt: now }),
    });
    return personId;
  });
}
