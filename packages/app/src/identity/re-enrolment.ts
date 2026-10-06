// Partner-assisted recovery (story 1.6). The other partner, re-authenticated, issues a one-time
// re-enrolment link for someone who has lost their sign-in. Only the token's SHA-256 is stored;
// the link lasts 24 hours and raises a notice for the affected person. Redeeming it sets a new
// password and clears every passkey, the TOTP authenticator, all sessions and all recovery codes,
// so the person must enrol a passkey and TOTP again. Accepted residual risk (AD-27): the issuing
// partner holds the link and could redeem it; the audit trail and the notice make that visible.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { TokenPort } from "../ports/tokens.ts";
import type { PersonRow, ReadRepos, ReEnrolmentLinkRow, TxRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { personViewer } from "../viewer.ts";
import { type Audit, write } from "../write.ts";
import { requireRecentAuth } from "./reauth.ts";
import type { IdentityContext } from "./sign-up.ts";

/** How long a re-enrolment link stays valid. */
export const RE_ENROLMENT_LINK_TTL_MS = 24 * 60 * 60_000;

/** The in-app notice that someone's access was reset: visible to that person only (AD-17). */
export const PARTNER_RESET_REVIEW = defineReviewKind({
  kind: "identity.partner-reset",
  module: "identity",
  scope: "person",
});

/** The review-item dedupe key of the notice for link `linkId`. */
export function partnerResetDedupeKey(linkId: string): string {
  return `identity.partner-reset:${linkId}`;
}

/** The page a re-enrolment link opens: `<publicUrl>/recover?token=…`. */
export function reEnrolmentUrl(publicUrl: string, token: string): string {
  return `${publicUrl}/recover?token=${encodeURIComponent(token)}`;
}

/** A use-case context that can mint and hash tokens. */
export interface ReEnrolmentContext extends UseCaseContext {
  readonly tokens: TokenPort;
}

/** A freshly issued link. `token` exists only here: it is never stored, logged or audited. */
export interface IssuedReEnrolmentLink {
  readonly id: Id<"ReEnrolmentLink">;
  readonly personId: Id<"Person">;
  readonly token: string;
  readonly expiresAt: string;
}

export const reEnrolmentTokenSchema = z.string().min(1).max(200);

/** The one refusal for an unknown, used, revoked or expired link. */
export function invalidReEnrolmentLink(): AppError {
  return new AppError("Validation", "This recovery link is invalid, expired or already used");
}

/** The audit view of a link: never its hash. */
function linkAuditView(row: ReEnrolmentLinkRow) {
  const { tokenHash: _hash, ...rest } = row;
  return rest;
}

/** The active person `personId` with a login, or `NotFound`. */
function personWithLogin(
  tx: Pick<TxRepos, "person">,
  personId: string,
): PersonRow & { readonly userId: string } {
  const person = tx.person.listActive().find((row) => row.id === personId);
  if (person === undefined || person.userId === null) {
    throw new AppError("NotFound", "No such person");
  }
  return person as PersonRow & { readonly userId: string };
}

/** The unused, unexpired link for `token`, or throws `Validation`. */
function liveLink(
  repos: Pick<ReadRepos, "reEnrolmentLinks">,
  tokens: TokenPort,
  token: string,
  now: string,
): ReEnrolmentLinkRow {
  const row = repos.reEnrolmentLinks.findByTokenHash(tokens.hash(token));
  if (row === undefined || row.usedAt !== null || row.expiresAt <= now) {
    throw invalidReEnrolmentLink();
  }
  return row;
}

/** What `clearCredentials` removed, as audited. */
export interface ClearedCredentials {
  readonly passwordChanged: boolean;
  readonly passkeysRemoved: number;
  readonly twoFactorDisabled: boolean;
  readonly sessionsRevoked: number;
  readonly recoveryCodesRemoved: number;
}

/**
 * Inside the caller's write: removes every passkey, the TOTP authenticator (two-factor off),
 * every session and every recovery code of `person`'s login, and sets its password hash when one
 * is given. Audited as one `reset` of `user` (counts only), scoped to the person.
 */
export function clearCredentials(
  ctx: Pick<UseCaseContext, "clock">,
  tx: TxRepos,
  audit: Audit,
  person: PersonRow & { readonly userId: string },
  reason: "re-enrolment-link" | "reset-user" | "restore" | "left-household",
  passwordHash?: string,
): ClearedCredentials {
  const userId = person.userId;
  const passwordChanged =
    passwordHash !== undefined &&
    tx.credentials.setPasswordHash(userId, passwordHash, formatInstant(ctx.clock.now()));
  if (passwordHash !== undefined && !passwordChanged) {
    throw new Error("clearCredentials: the login has no password account to set");
  }
  const cleared: ClearedCredentials = {
    passwordChanged,
    passkeysRemoved: tx.credentials.deletePasskeys(userId),
    twoFactorDisabled: tx.credentials.disableTwoFactor(userId),
    sessionsRevoked: tx.credentials.revokeSessions(userId),
    recoveryCodesRemoved: tx.recoveryCodes.deleteAll(person.id),
  };
  audit({
    entity: "user",
    entityId: userId,
    action: "reset",
    before: null,
    after: { reason, ...cleared },
    personId: person.id,
  });
  return cleared;
}

/**
 * Inside the caller's write: ends every live link against `personId` (each audited as `revoke`)
 * and resolves its notice with `resolution`. Returns how many it ended.
 */
function revokeLiveLinks(
  ctx: Pick<UseCaseContext, "clock">,
  tx: TxRepos,
  audit: Audit,
  personId: Id<"Person">,
  resolution: "superseded" | "revoked",
): number {
  const now = formatInstant(ctx.clock.now());
  let revoked = 0;
  for (const link of tx.reEnrolmentLinks.listLive(personId, now)) {
    if (!tx.reEnrolmentLinks.expire(link.id, now)) continue;
    revoked++;
    audit({
      entity: "re_enrolment_link",
      entityId: link.id,
      action: "revoke",
      before: linkAuditView(link),
      after: linkAuditView({ ...link, expiresAt: now }),
      personId,
    });
    resolveReviewItem(tx, audit, ctx, { dedupeKey: partnerResetDedupeKey(link.id), resolution });
  }
  return revoked;
}

/**
 * A password hash no password matches: the `salt:key` hex shape better-auth's scrypt verifier
 * reads, with a random key instead of a derived one. Never returned or logged.
 */
export function unusablePasswordHash(tokens: TokenPort): string {
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex(tokens.randomBytes(16))}:${hex(tokens.randomBytes(64))}`;
}

export const revokeMyReEnrolmentLinksInput = z.object({}).strict();
export type RevokeMyReEnrolmentLinksInput = z.input<typeof revokeMyReEnrolmentLinksInput>;

/**
 * `identity.revokeMyReEnrolmentLinks`: the signed-in person ends every unused re-enrolment link
 * issued against them (each audited as `revoke`) and resolves their `identity.partner-reset`
 * notices as `revoked`. For a link they did not ask for. Returns how many links it ended.
 */
export function revokeMyReEnrolmentLinks(
  ctx: UseCaseContext,
  input: RevokeMyReEnrolmentLinksInput = {},
): { readonly revoked: number } {
  parseInput(revokeMyReEnrolmentLinksInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  return write(ctx, (tx, audit) => {
    const revoked = revokeLiveLinks(ctx, tx, audit, viewer.personId, "revoked");
    for (const item of tx.reviewItems.listOpenFor(viewer)) {
      if (item.kind !== PARTNER_RESET_REVIEW.kind || item.personId !== viewer.personId) continue;
      resolveReviewItem(tx, audit, ctx, { dedupeKey: item.dedupeKey, resolution: "revoked" });
    }
    return { revoked };
  });
}

/**
 * Inside the caller's write: ends `personId`'s earlier live links (each audited as `revoke`,
 * its notice resolved as `superseded`), stores a new one issued by `issuedBy`, audits its
 * `create` and raises its `identity.partner-reset` notice for that person.
 */
export function insertReEnrolmentLink(
  ctx: Pick<ReEnrolmentContext, "clock" | "newId" | "tokens">,
  tx: TxRepos,
  audit: Audit,
  personId: Id<"Person">,
  issuedBy: string,
  token: string,
): IssuedReEnrolmentLink {
  const nowInstant = ctx.clock.now();
  const now = formatInstant(nowInstant);
  revokeLiveLinks(ctx, tx, audit, personId, "superseded");
  const row: ReEnrolmentLinkRow = {
    id: ctx.newId<"ReEnrolmentLink">(),
    personId,
    issuedBy,
    tokenHash: ctx.tokens.hash(token),
    createdAt: now,
    expiresAt: formatInstant(nowInstant.add({ milliseconds: RE_ENROLMENT_LINK_TTL_MS })),
    usedAt: null,
  };
  tx.reEnrolmentLinks.insert(row);
  audit({
    entity: "re_enrolment_link",
    entityId: row.id,
    action: "create",
    before: null,
    after: linkAuditView(row),
    personId,
  });
  raiseReviewItem(tx, audit, ctx, {
    kind: PARTNER_RESET_REVIEW,
    entityRef: `re_enrolment_link:${row.id}`,
    dedupeKey: partnerResetDedupeKey(row.id),
    personId,
  });
  return { id: row.id, personId, token, expiresAt: row.expiresAt };
}

export const issueReEnrolmentLinkInput = z
  .object({ personId: z.string().min(1).max(100) })
  .strict();
export type IssueReEnrolmentLinkInput = z.input<typeof issueReEnrolmentLinkInput>;

/**
 * `identity.issueReEnrolmentLink`: a signed-in person, re-authenticated within the last 5
 * minutes, issues a 24-hour re-enrolment link for their partner (never for themselves:
 * `Validation`). Earlier live links for the partner are revoked. The partner gets an in-app
 * notice. Nothing about the partner's sign-in changes until the link is redeemed. Throws
 * `ReauthRequired` for an older sign-in and `NotFound` for anyone who is not an active person
 * with a login.
 */
export function issueReEnrolmentLink(
  ctx: ReEnrolmentContext,
  input: IssueReEnrolmentLinkInput,
): IssuedReEnrolmentLink {
  const { personId } = parseInput(issueReEnrolmentLinkInput, input);
  const viewer = ctx.viewer;
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  requireRecentAuth(ctx);
  if (personId === viewer.personId) {
    throw new AppError("Validation", "You cannot reset your own access; ask your partner");
  }
  const token = ctx.tokens.generate();
  return write(ctx, (tx, audit) => {
    const person = personWithLogin(tx, personId);
    return insertReEnrolmentLink(ctx, tx, audit, person.id, `person:${viewer.personId}`, token);
  });
}

export const checkReEnrolmentLinkInput = z.object({ token: reEnrolmentTokenSchema }).strict();
export type CheckReEnrolmentLinkInput = z.input<typeof checkReEnrolmentLinkInput>;

/**
 * `identity.checkReEnrolmentLink`: throws `Validation` unless `token` is a live link. Writes
 * nothing; lets the caller refuse a dead link before hashing a new password.
 */
export function checkReEnrolmentLink(ctx: IdentityContext, input: CheckReEnrolmentLinkInput): void {
  const { token } = parseInput(checkReEnrolmentLinkInput, input);
  const now = formatInstant(ctx.clock.now());
  ctx.uow.read((repos) => liveLink(repos, ctx.tokens, token, now));
}

export const redeemReEnrolmentLinkInput = z
  .object({
    token: reEnrolmentTokenSchema,
    /** The new password, already hashed by better-auth's hasher (AD-2: before the write). */
    passwordHash: z.string().min(1).max(1000),
  })
  .strict();
export type RedeemReEnrolmentLinkInput = z.input<typeof redeemReEnrolmentLinkInput>;

export interface RedeemedReEnrolmentLink {
  readonly personId: Id<"Person">;
  readonly userId: string;
}

/**
 * `identity.redeemReEnrolmentLink`: in one transaction, checks the link is live, sets the new
 * password and clears the login's passkeys, TOTP, sessions and recovery codes
 * (`clearCredentials`), then marks the link used. Audited as the affected person. The caller
 * then issues a session, which needs a passkey and TOTP before anything else. Throws the same
 * `Validation` for an unknown, used, revoked or expired token, or a person no longer active.
 */
export function redeemReEnrolmentLink(
  ctx: IdentityContext,
  input: RedeemReEnrolmentLinkInput,
): RedeemedReEnrolmentLink {
  const parsed = parseInput(redeemReEnrolmentLinkInput, input);
  const nowInstant = ctx.clock.now();
  const now = formatInstant(nowInstant);
  const link = ctx.uow.read((repos) => liveLink(repos, ctx.tokens, parsed.token, now));
  const writeCtx: UseCaseContext = { ...ctx, viewer: personViewer(link.personId, nowInstant) };
  return write(writeCtx, (tx, audit) => {
    const current = liveLink(tx, ctx.tokens, parsed.token, now);
    let person: PersonRow & { readonly userId: string };
    try {
      person = personWithLogin(tx, current.personId);
    } catch {
      throw invalidReEnrolmentLink();
    }
    clearCredentials(ctx, tx, audit, person, "re-enrolment-link", parsed.passwordHash);
    if (!tx.reEnrolmentLinks.markUsed(current.id, now)) throw invalidReEnrolmentLink();
    audit({
      entity: "re_enrolment_link",
      entityId: current.id,
      action: "use",
      before: linkAuditView(current),
      after: linkAuditView({ ...current, usedAt: now }),
      personId: person.id,
    });
    return { personId: person.id, userId: person.userId };
  });
}
