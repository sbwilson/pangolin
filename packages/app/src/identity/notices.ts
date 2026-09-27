// In-app notices (story 1.6): the signed-in person's own open, person-scoped review items
// (AD-17), such as `identity.partner-reset` (a re-enrolment link was issued against them) and
// `identity.recovery-code-used`. Household and account items belong to the review inbox, not
// here. A person may dismiss only their own notice; anything else is `NotFound`.
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { ReadRepos, ReviewItemRow } from "../ports/unit-of-work.ts";
import { resolveReviewItem } from "../system/review-items.ts";
import type { PersonViewer } from "../viewer.ts";
import { write } from "../write.ts";
import { PARTNER_RESET_REVIEW } from "./re-enrolment.ts";

/** A notice as the web app shows it. */
export interface Notice {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  /**
   * For `identity.partner-reset`: who issued the link (the partner's display name, or
   * `the server console`); null for other kinds.
   */
  readonly issuedBy: string | null;
}

function signedIn(ctx: UseCaseContext): PersonViewer {
  if (ctx.viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  return ctx.viewer;
}

/** The viewer's own open person-scoped items. */
function own(repos: Pick<ReadRepos, "reviewItems">, viewer: PersonViewer): ReviewItemRow[] {
  return repos.reviewItems.listOpenFor(viewer).filter((row) => row.personId === viewer.personId);
}

function issuerOf(repos: ReadRepos, row: ReviewItemRow): string | null {
  if (row.kind !== PARTNER_RESET_REVIEW.kind) return null;
  const linkId = row.entityRef.replace(/^re_enrolment_link:/, "");
  const issuedBy = repos.reEnrolmentLinks.findById(linkId)?.issuedBy;
  if (issuedBy === undefined) return null;
  if (!issuedBy.startsWith("person:")) return "the server console";
  const personId = issuedBy.slice("person:".length);
  return repos.person.listActive().find((p) => p.id === personId)?.displayName ?? null;
}

export const listNoticesInput = z.object({}).strict();
export type ListNoticesInput = z.input<typeof listNoticesInput>;

/** `identity.listNotices`: the viewer's own open person-scoped items, oldest first. */
export function listNotices(ctx: UseCaseContext, input: ListNoticesInput = {}): Notice[] {
  parseInput(listNoticesInput, input);
  const viewer = signedIn(ctx);
  return ctx.uow.read((repos) =>
    own(repos, viewer).map((row) => ({
      id: row.id,
      kind: row.kind,
      createdAt: row.createdAt,
      issuedBy: issuerOf(repos, row),
    })),
  );
}

export const dismissNoticeInput = z.object({ id: z.string().min(1).max(100) }).strict();
export type DismissNoticeInput = z.input<typeof dismissNoticeInput>;

/**
 * `identity.dismissNotice`: resolves the viewer's own open notice `id` as `dismissed`, audited.
 * Any other id (another person's, a household item, one already resolved, or none) is
 * `NotFound`.
 */
export function dismissNotice(ctx: UseCaseContext, input: DismissNoticeInput): void {
  const { id } = parseInput(dismissNoticeInput, input);
  const viewer = signedIn(ctx);
  write(ctx, (tx, audit) => {
    const item = own(tx, viewer).find((row) => row.id === id);
    if (item === undefined) throw new AppError("NotFound", "No such notice");
    resolveReviewItem(tx, audit, ctx, { dedupeKey: item.dedupeKey, resolution: "dismissed" });
  });
}
