// Who is signed in (story 1.5): the session's user resolved to its person, and what the signed-in
// home needs to know about them.
import type { Id } from "@pangolin/shared";
import { formatInstant, Temporal } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { PersonRow } from "../ports/unit-of-work.ts";
import { type PersonViewer, personViewer } from "../viewer.ts";
import { MAX_USERS } from "./setup-links.ts";

/**
 * The person linked to better-auth user `userId`, or undefined when there is none (a deleted
 * person, or a user whose sign-up never completed). Used by the HTTP entry to build a viewer.
 */
export function personForUser(
  ctx: Pick<UseCaseContext, "uow">,
  userId: string,
): Id<"Person"> | undefined {
  return ctx.uow.read((repos) => repos.person.findByUserId(userId))?.id;
}

/** The first active person, oldest first; demo mode signs everyone in as them. */
export function firstPerson(ctx: Pick<UseCaseContext, "uow">): Id<"Person"> | undefined {
  return ctx.uow.read((repos) => repos.person.listActive())[0]?.id;
}

/**
 * The viewer for a better-auth session: its user's person, with `authAt` = when the session
 * was created (the last full authentication). Undefined when the user has no person.
 */
export function sessionViewer(
  ctx: Pick<UseCaseContext, "uow">,
  session: { readonly userId: string; readonly createdAt: Date },
): PersonViewer | undefined {
  const personId = personForUser(ctx, session.userId);
  if (personId === undefined) return undefined;
  const at = session.createdAt.getTime();
  if (!Number.isFinite(at)) throw new TypeError("sessionViewer: createdAt is not a valid date");
  return personViewer(personId, Temporal.Instant.fromEpochMilliseconds(at));
}

/**
 * Demo mode's viewer: the first seeded person, authenticated "now", so reads work without a
 * sign-in. Writes still fail: demo mode's unit of work refuses them.
 */
export function demoViewer(ctx: Pick<UseCaseContext, "uow" | "clock">): PersonViewer | undefined {
  const personId = firstPerson(ctx);
  return personId === undefined ? undefined : personViewer(personId, ctx.clock.now());
}

export interface Me {
  readonly personId: Id<"Person">;
  readonly displayName: string;
  readonly colour: string;
  /** When this session signed in (UTC ISO-8601); re-authentication windows count from here. */
  readonly authAt: string;
  /** True while fewer than two people have a login, so a partner can still be invited. */
  readonly canInvite: boolean;
  /**
   * The signed-in person's recovery codes: whether a set was ever issued (false until enrolment
   * first completes, and again after a partner-assisted reset) and how many are unused.
   */
  readonly recoveryCodes: { readonly issued: boolean; readonly remaining: number };
  /** The other person with a login, whose access this person may reset; null while alone. */
  readonly partner: { readonly personId: Id<"Person">; readonly displayName: string } | null;
}

export const meInput = z.object({}).strict();

/** `identity.me`: the signed-in person. Throws `Unauthenticated` for any other viewer. */
export function me(ctx: UseCaseContext, input: z.input<typeof meInput>): Me {
  parseInput(meInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  return ctx.uow.read((repos) => {
    const people = repos.person.listActive();
    const person: PersonRow | undefined = people.find((row) => row.id === viewer.personId);
    if (person === undefined) throw new AppError("Unauthenticated", "Sign in first");
    const partner = people.find((row) => row.id !== person.id && row.userId !== null);
    const codes = repos.recoveryCodes.counts(person.id);
    return {
      personId: person.id,
      displayName: person.displayName,
      colour: person.colour,
      authAt: formatInstant(viewer.authAt),
      canInvite: repos.users.count() < MAX_USERS,
      recoveryCodes: { issued: codes.total > 0, remaining: codes.unused },
      partner:
        partner === undefined ? null : { personId: partner.id, displayName: partner.displayName },
    };
  });
}

/** An enrolment step a login still lacks. */
export type EnrolmentStep = "passkey" | "totp";

/**
 * What login `userId` must still enrol before it may use the app: a passkey and a confirmed
 * TOTP authenticator. A setup abandoned after the account step leaves a password-only login;
 * the HTTP entry then lets it reach only its own enrolment.
 */
export function enrolmentNeeds(ctx: Pick<UseCaseContext, "uow">, userId: string): EnrolmentStep[] {
  const enrolment = ctx.uow.read((repos) => repos.users.enrolment(userId));
  const needs: EnrolmentStep[] = [];
  if (enrolment === undefined || enrolment.passkeys === 0) needs.push("passkey");
  if (enrolment === undefined || !enrolment.totp) needs.push("totp");
  return needs;
}
