// One-time recovery codes (story 1.6). Each person gets 10 codes when their enrolment first
// completes; only each code's SHA-256 is stored. A code stands in for the passkey, never for the
// password: redeeming one takes email, password and code, removes the person's passkeys, ends
// their sessions and signs them in to an enrolment that needs a new passkey.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { CodeHasher, TokenPort } from "../ports/tokens.ts";
import type { PersonRow, RecoveryCodeRow, TxRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem } from "../system/review-items.ts";
import { type PersonViewer, personViewer } from "../viewer.ts";
import { type Audit, write } from "../write.ts";
import { requireRecentAuth } from "./reauth.ts";
import type { IdentityContext } from "./sign-up.ts";

/** The in-app notice that one of the person's recovery codes was used (AD-17, person scope). */
export const RECOVERY_CODE_USED_REVIEW = defineReviewKind({
  kind: "identity.recovery-code-used",
  module: "identity",
  scope: "person",
});

/** How many codes a person holds after (re)generation. */
export const RECOVERY_CODE_COUNT = 10;

/** Characters per code, shown as two groups of five. */
export const RECOVERY_CODE_LENGTH = 10;

/**
 * The 32 characters codes are drawn from: capitals and digits without the easily confused
 * `0`/`O`, `1`/`I`. 32 divides 256, so one random byte per character carries no bias.
 */
export const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CODE_RE = new RegExp(`^[${RECOVERY_CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);

/** A use-case context that can draw random bytes and hash codes. */
export interface RecoveryCodeContext extends UseCaseContext {
  readonly tokens: TokenPort;
  /** Hashes codes under the server's recovery-code key. */
  readonly codes: CodeHasher;
}

/** The one refusal every failed redemption gets, so it never says which part was wrong. */
export function recoveryRefused(): AppError {
  return new AppError("Unauthenticated", "Those details did not match. Check them and try again.");
}

/** `ABCDEFGHJK` as `ABCDE-FGHJK`. */
export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/**
 * A code as typed (any case, with or without the hyphen or spaces) in its stored form, or
 * undefined when it cannot be a code.
 */
export function normaliseRecoveryCode(input: string): string | undefined {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(code) ? code : undefined;
}

function newCodes(tokens: TokenPort): string[] {
  const bytes = tokens.randomBytes(RECOVERY_CODE_COUNT * RECOVERY_CODE_LENGTH);
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    let code = "";
    for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) {
      const byte = bytes[i * RECOVERY_CODE_LENGTH + j] ?? 0;
      code += RECOVERY_CODE_ALPHABET[byte & 31];
    }
    codes.push(code);
  }
  return codes;
}

/** The audit view of a code: never its hash. */
function codeAuditView(row: RecoveryCodeRow) {
  const { codeHash: _hash, ...rest } = row;
  return rest;
}

function signedInPerson(ctx: UseCaseContext): PersonViewer {
  if (ctx.viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  return ctx.viewer;
}

function activePerson(tx: Pick<TxRepos, "person">, personId: Id<"Person">): PersonRow {
  const person = tx.person.listActive().find((row) => row.id === personId);
  if (person === undefined) throw new AppError("Unauthenticated", "Sign in first");
  return person;
}

/**
 * Stores a fresh set of codes for `personId` inside the caller's write, audited as one
 * `generate` of `recovery_code` (the count only). Returns the codes, formatted for display.
 */
function storeCodes(
  ctx: Pick<RecoveryCodeContext, "clock" | "newId" | "codes">,
  tx: TxRepos,
  audit: Audit,
  personId: Id<"Person">,
  codes: readonly string[],
  replaced: number,
): string[] {
  const createdAt = formatInstant(ctx.clock.now());
  for (const code of codes) {
    tx.recoveryCodes.insert({
      id: ctx.newId<"RecoveryCode">(),
      personId,
      codeHash: ctx.codes.hash(code),
      createdAt,
      usedAt: null,
    });
  }
  audit({
    entity: "recovery_code",
    entityId: personId,
    action: "generate",
    before: replaced === 0 ? null : { unused: replaced },
    after: { unused: codes.length },
    personId,
  });
  return codes.map(formatRecoveryCode);
}

/** Freshly generated codes, formatted `XXXXX-XXXXX`. They exist only in this response. */
export interface IssuedRecoveryCodes {
  readonly codes: readonly string[];
}

export const issueInitialRecoveryCodesInput = z.object({}).strict();
export type IssueInitialRecoveryCodesInput = z.input<typeof issueInitialRecoveryCodesInput>;

/**
 * `identity.issueInitialRecoveryCodes`: the codes a person gets when their enrolment first
 * completes (a passkey and TOTP both exist), shown once. Throws `Conflict` when the person
 * already has codes (used or not), so the set can never be shown twice, and while their
 * enrolment is still incomplete. A partner-assisted reset clears every code, so re-enrolling
 * after one issues a new set here.
 */
export function issueInitialRecoveryCodes(
  ctx: RecoveryCodeContext,
  input: IssueInitialRecoveryCodesInput = {},
): IssuedRecoveryCodes {
  parseInput(issueInitialRecoveryCodesInput, input);
  const viewer = signedInPerson(ctx);
  const codes = newCodes(ctx.tokens);
  return write(ctx, (tx, audit) => {
    const person = activePerson(tx, viewer.personId);
    const enrolment = person.userId === null ? undefined : tx.users.enrolment(person.userId);
    if (enrolment === undefined || enrolment.passkeys === 0 || !enrolment.totp) {
      throw new AppError("Conflict", "Finish setting up your sign-in first");
    }
    if (tx.recoveryCodes.counts(person.id).total > 0) {
      throw new AppError(
        "Conflict",
        "Your recovery codes were already issued; regenerate them to get new ones",
      );
    }
    return { codes: storeCodes(ctx, tx, audit, person.id, codes, 0) };
  });
}

export const regenerateRecoveryCodesInput = z.object({}).strict();
export type RegenerateRecoveryCodesInput = z.input<typeof regenerateRecoveryCodesInput>;

/**
 * `identity.regenerateRecoveryCodes`: replaces every unused code of the signed-in person with 10
 * new ones and returns them once. Needs a sign-in within the last 5 minutes (`ReauthRequired`).
 * Used codes stay as the record of their use.
 */
export function regenerateRecoveryCodes(
  ctx: RecoveryCodeContext,
  input: RegenerateRecoveryCodesInput = {},
): IssuedRecoveryCodes {
  parseInput(regenerateRecoveryCodesInput, input);
  const viewer = signedInPerson(ctx);
  requireRecentAuth(ctx);
  const codes = newCodes(ctx.tokens);
  return write(ctx, (tx, audit) => {
    const person = activePerson(tx, viewer.personId);
    const replaced = tx.recoveryCodes.deleteUnused(person.id);
    return { codes: storeCodes(ctx, tx, audit, person.id, codes, replaced) };
  });
}

export const redeemRecoveryCodeInput = z
  .object({
    /** The login whose password the caller has just verified. */
    userId: z.string().min(1).max(100),
    code: z.string().max(100),
  })
  .strict();
export type RedeemRecoveryCodeInput = z.input<typeof redeemRecoveryCodeInput>;

export interface RedeemedRecoveryCode {
  readonly personId: Id<"Person">;
  readonly userId: string;
  /** Unused codes left after this one. */
  readonly remaining: number;
}

/**
 * `identity.redeemRecoveryCode`: the second half of recovery-code sign-in, after the caller has
 * checked the lockout and verified the login's password. In one transaction it marks the code
 * used, deletes every passkey of the login and ends all its sessions; the caller then issues a
 * new session, which can reach only passkey enrolment. Audited as the person: the code's `use`
 * and the login's `recover` (counts only, never the code); the person also gets an
 * `identity.recovery-code-used` notice. Throws the same `Unauthenticated` for
 * a malformed, unknown or used code, and for a login with no person.
 */
export function redeemRecoveryCode(
  ctx: Omit<IdentityContext, "tokens"> & { readonly codes: CodeHasher },
  input: RedeemRecoveryCodeInput,
): RedeemedRecoveryCode {
  const parsed = parseInput(redeemRecoveryCodeInput, input);
  const code = normaliseRecoveryCode(parsed.code);
  const person = ctx.uow.read((repos) => repos.person.findByUserId(parsed.userId));
  if (code === undefined || person === undefined) throw recoveryRefused();
  const nowInstant = ctx.clock.now();
  const now = formatInstant(nowInstant);
  const writeCtx: UseCaseContext = { ...ctx, viewer: personViewer(person.id, nowInstant) };
  return write(writeCtx, (tx, audit) => {
    const row = tx.recoveryCodes.findUnused(person.id, ctx.codes.hash(code));
    if (row === undefined || !tx.recoveryCodes.markUsed(row.id, now)) throw recoveryRefused();
    // Tell the person, in case it was not them: a password and a leaked code sheet suffice.
    raiseReviewItem(tx, audit, ctx, {
      kind: RECOVERY_CODE_USED_REVIEW,
      entityRef: `recovery_code:${row.id}`,
      dedupeKey: `identity.recovery-code-used:${row.id}`,
      personId: person.id,
    });
    audit({
      entity: "recovery_code",
      entityId: row.id,
      action: "use",
      before: codeAuditView(row),
      after: codeAuditView({ ...row, usedAt: now }),
      personId: person.id,
    });
    const passkeysRemoved = tx.credentials.deletePasskeys(parsed.userId);
    const sessionsRevoked = tx.credentials.revokeSessions(parsed.userId);
    audit({
      entity: "user",
      entityId: parsed.userId,
      action: "recover",
      before: null,
      after: { method: "recovery-code", passkeysRemoved, sessionsRevoked },
      personId: person.id,
    });
    const remaining = tx.recoveryCodes.counts(person.id).unused;
    return { personId: person.id, userId: parsed.userId, remaining };
  });
}
