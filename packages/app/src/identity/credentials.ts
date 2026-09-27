// Audit of better-auth's own credential writes (story 1.5, AD-1): better-auth writes passkeys and
// the TOTP flag itself; this records each change, as the person whose login it is.
import { z } from "zod";
import { parseInput } from "../errors.ts";
import { personViewer } from "../viewer.ts";
import { write } from "../write.ts";
import type { IdentityContext } from "./sign-up.ts";

export const recordCredentialChangeInput = z
  .object({
    userId: z.string().min(1).max(100),
    entity: z.enum(["passkey", "two_factor"]),
    /** The passkey's ID, or the user's for `two_factor`. */
    entityId: z.string().min(1).max(200),
    action: z.enum(["create", "delete", "enable", "disable"]),
  })
  .strict();
export type RecordCredentialChangeInput = z.input<typeof recordCredentialChangeInput>;

/**
 * `identity.recordCredentialChange`: audits a credential change better-auth made, scoped to and
 * acted by the login's person. Returns false, writing nothing, when the login has no person.
 */
export function recordCredentialChange(
  ctx: Omit<IdentityContext, "tokens">,
  input: RecordCredentialChangeInput,
): boolean {
  const parsed = parseInput(recordCredentialChangeInput, input);
  const personId = ctx.uow.read((repos) => repos.person.findByUserId(parsed.userId))?.id;
  if (personId === undefined) return false;
  const viewer = personViewer(personId, ctx.clock.now());
  write({ ...ctx, viewer }, (_tx, audit) =>
    audit({
      entity: parsed.entity,
      entityId: parsed.entityId,
      action: parsed.action,
      before: null,
      after: { userId: parsed.userId },
      personId,
    }),
  );
  return true;
}
