// One-time sign-up links (story 1.5). A link carries a 32-byte random token; only its SHA-256
// is stored. It is valid for 24 hours, once, and only while fewer than two people have a login.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { TokenPort } from "../ports/tokens.ts";
import type { ReadRepos, SetupLinkRow, TxRepos } from "../ports/unit-of-work.ts";
import { type Audit, write } from "../write.ts";
import { requireRecentAuth } from "./reauth.ts";

/** How long a setup link stays valid. */
export const SETUP_LINK_TTL_MS = 24 * 60 * 60_000;

/** The household has two people; registration closes once both have a login. */
export const MAX_USERS = 2;

/** A use-case context that can mint and hash tokens. */
export interface SetupLinkContext extends UseCaseContext {
  readonly tokens: TokenPort;
}

/** A freshly issued link. `token` exists only here: it is never stored or logged. */
export interface IssuedSetupLink {
  readonly id: Id<"SetupLink">;
  readonly token: string;
  readonly expiresAt: string;
}

export const setupTokenSchema = z.string().min(1).max(200);

export const issueSetupLinkInput = z.object({}).strict();
export type IssueSetupLinkInput = z.input<typeof issueSetupLinkInput>;

/** The `Conflict` every closed registration answers with. */
export function registrationClosed(): AppError {
  return new AppError("Conflict", "Registration is closed");
}

export function invalidSetupLink(): AppError {
  return new AppError("Validation", "This setup link is invalid, expired or already used");
}

/** The audit view of a link: never its hash. */
export function setupLinkAuditView(row: SetupLinkRow) {
  const { tokenHash: _hash, ...rest } = row;
  return rest;
}

/**
 * The unused, unexpired link for `token`, or throws `Validation`. Expiry is checked against
 * `now`, so a link is dead from the instant it expires.
 */
export function liveSetupLink(
  repos: Pick<ReadRepos, "setupLinks">,
  tokens: TokenPort,
  token: string,
  now: string,
): SetupLinkRow {
  const row = repos.setupLinks.findByTokenHash(tokens.hash(token));
  if (row === undefined || row.usedAt !== null || row.expiresAt <= now) throw invalidSetupLink();
  return row;
}

function insertLink(ctx: SetupLinkContext, tx: TxRepos, issuedBy: string, token: string) {
  const now = ctx.clock.now();
  const row: SetupLinkRow = {
    id: ctx.newId<"SetupLink">(),
    tokenHash: ctx.tokens.hash(token),
    issuedBy,
    createdAt: formatInstant(now),
    expiresAt: formatInstant(now.add({ milliseconds: SETUP_LINK_TTL_MS })),
    usedAt: null,
  };
  tx.setupLinks.insert(row);
  return row;
}

/** Ends every live link whose issuer `matches`, auditing each as a `revoke`. */
function revokeLive(
  ctx: SetupLinkContext,
  tx: TxRepos,
  audit: Audit,
  matches: (issuedBy: string) => boolean,
): void {
  const now = formatInstant(ctx.clock.now());
  for (const link of tx.setupLinks.listLive(now)) {
    if (!matches(link.issuedBy) || !tx.setupLinks.expire(link.id, now)) continue;
    audit({
      entity: "setup_link",
      entityId: link.id,
      action: "revoke",
      before: setupLinkAuditView(link),
      after: setupLinkAuditView({ ...link, expiresAt: now }),
    });
  }
}

function issue(ctx: SetupLinkContext, tx: TxRepos, audit: Audit, issuedBy: string, token: string) {
  const row = insertLink(ctx, tx, issuedBy, token);
  audit({
    entity: "setup_link",
    entityId: row.id,
    action: "create",
    before: null,
    after: setupLinkAuditView(row),
  });
  return { id: row.id, token, expiresAt: row.expiresAt };
}

/**
 * `identity.issueSetupLink`: a signed-in person, re-authenticated within the last 5 minutes,
 * issues a sign-up link for their partner. Any earlier unused partner link is revoked, so only
 * the newest works. Throws `ReauthRequired` when their sign-in is older, and `Conflict` once two
 * people have a login. Audited as a `create` of `setup_link` (without the hash), plus a
 * `revoke` per link it ends.
 */
export function issueSetupLink(ctx: SetupLinkContext, input: IssueSetupLinkInput): IssuedSetupLink {
  parseInput(issueSetupLinkInput, input);
  requireRecentAuth(ctx);
  const issuedBy = ctx.viewer.kind === "person" ? `person:${ctx.viewer.personId}` : "cli";
  const token = ctx.tokens.generate();
  return write(ctx, (tx, audit) => {
    if (tx.users.count() >= MAX_USERS) throw registrationClosed();
    revokeLive(ctx, tx, audit, (by) => by.startsWith("person:"));
    return issue(ctx, tx, audit, issuedBy, token);
  });
}

export const ensureFirstSetupLinkInput = z
  .object({
    /**
     * Revoke any live first-boot link and issue a new one, e.g. because the file that held it
     * is gone.
     */
    reissue: z.boolean().default(false),
  })
  .strict();
export type EnsureFirstSetupLinkInput = z.input<typeof ensureFirstSetupLinkInput>;

/**
 * What boot found: `closed` (somebody has a login, so no first link is needed), `live` (an
 * unexpired unused link already exists), or `issued` with the new link.
 */
export type FirstSetupLink =
  | { readonly status: "closed" }
  | { readonly status: "live" }
  | { readonly status: "issued"; readonly link: IssuedSetupLink };

/**
 * `identity.ensureFirstSetupLink`: at boot, while nobody has a login, makes sure one live
 * first-boot link (`issued_by` = `cli`) exists, issuing it when none does or when `reissue`
 * asks (revoking the old ones). The caller writes an issued link where the installer can read
 * it; never to a log.
 */
export function ensureFirstSetupLink(
  ctx: SetupLinkContext,
  input: EnsureFirstSetupLinkInput = {},
): FirstSetupLink {
  const { reissue } = parseInput(ensureFirstSetupLinkInput, input);
  const token = ctx.tokens.generate();
  return write(ctx, (tx, audit): FirstSetupLink => {
    if (tx.users.count() > 0) return { status: "closed" };
    if (reissue) revokeLive(ctx, tx, audit, (by) => by === "cli");
    else if (tx.setupLinks.hasLive(formatInstant(ctx.clock.now()))) return { status: "live" };
    return { status: "issued", link: issue(ctx, tx, audit, "cli", token) };
  });
}
