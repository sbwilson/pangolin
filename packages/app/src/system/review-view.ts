// The Needs review inbox as the web app reads it (ticket 8, AD-3, AD-4, AD-17): every open item
// the viewer may see, with what its card needs of the thing it is about. Everything starts from
// `reviewItems.listOpenFor(viewer)` and goes through `redact`, so a card never carries data from
// an account the viewer cannot see. The two counts are numbers only.
import { shiftDay, TRANSFER_WINDOW_DAYS } from "@pangolin/domain";
import { z } from "zod";
import { CLOSING_BALANCE_REVIEW } from "../accounts/closing-balance.ts";
import { CLASSIFY_RULE_OFFER_REVIEW, CLASSIFY_UNCLASSIFIED_REVIEW } from "../classify/rules.ts";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { issuerOf } from "../identity/notices.ts";
import { PARTNER_RESET_REVIEW } from "../identity/re-enrolment.ts";
import { RECOVERY_CODE_USED_REVIEW } from "../identity/recovery-codes.ts";
import { IMPORT_HANDOFF_REVIEW } from "../imports/handoff.ts";
import {
  IMPORT_PROBABLE_DUPLICATE_REVIEW,
  IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW,
  IMPORT_TRANSFER_AMBIGUOUS_REVIEW,
} from "../imports/match-transfers.ts";
import { rowInterpretProposalSchema } from "../imports/row-interpret-request.ts";
import { IMPORT_SET_ASIDE_REVIEW, listSetAsideRowsForBatch } from "../imports/set-aside.ts";
import type { ReadRepos, ReviewItemRow } from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";
import type { Viewer } from "../viewer.ts";

/** How many transfer candidates a card lists at most. */
const MAX_CANDIDATES = 8;

/** A transaction as a card shows it: the description is already redacted (AD-4). */
export interface ReviewTransaction {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly postedOn: string;
  readonly amountCents: number;
  readonly description: string;
  readonly payeeName: string | null;
}

/** Proposed transaction fix for a set-aside row (AD-6). */
export interface ReviewSetAsideRowProposal {
  readonly postedOn: string;
  readonly amountCents: number;
  readonly description: string;
  readonly confidence?: number | null | undefined;
  readonly explanation?: string | null | undefined;
}

/** One set-aside row of an import batch. */
export interface ReviewSetAsideRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly rawLine: string;
  readonly reason: string | null;
  readonly proposal: ReviewSetAsideRowProposal | null;
}

/** Open suggestion details for an unclassified split (story 5.4). */
export interface ReviewSuggestion {
  readonly id: string;
  readonly splitId: string;
  readonly field: string;
  readonly suggestedValue: string;
  readonly categoryName: string | null;
  readonly confidence: number | null;
  readonly payeeName: string | null;
  readonly websiteDomain: string | null;
}

/** What a card knows of the thing its item is about; `none` for a kind with nothing to add. */
export type ReviewDetail =
  | {
      readonly type: "transaction";
      /** Null once the transaction is gone or hidden from the viewer. */
      readonly transaction: ReviewTransaction | null;
      /** Unlinked opposite-amount transactions within three days (transfer ambiguity only). */
      readonly candidates: readonly ReviewTransaction[];
      readonly suggestion?: ReviewSuggestion | null;
    }
  | {
      readonly type: "batch";
      readonly source: string | null;
      readonly accountName: string | null;
      readonly rows: readonly ReviewSetAsideRow[];
    }
  | {
      readonly type: "handoff";
      readonly filename: string | null;
      readonly senderName: string | null;
    }
  | { readonly type: "notice"; readonly issuedBy: string | null }
  | { readonly type: "account"; readonly accountName: string | null }
  | { readonly type: "none" };

/** An open review item as a card. */
export interface ReviewCard {
  readonly id: string;
  readonly kind: string;
  readonly createdAt: string;
  readonly accountId: string | null;
  readonly detail: ReviewDetail;
}

export const listReviewCardsInput = z.object({}).strict();
export type ListReviewCardsInput = z.input<typeof listReviewCardsInput>;

function requirePerson(viewer: Viewer): Extract<Viewer, { kind: "person" }> {
  if (viewer.kind !== "person") throw new AppError("Unauthenticated", "Sign in first");
  return viewer;
}

/** The id after `<prefix>:` in an entity reference, or undefined for another shape. */
function refId(entityRef: string, prefix: string): string | undefined {
  return entityRef.startsWith(`${prefix}:`) ? entityRef.slice(prefix.length + 1) : undefined;
}

function transactionBrief(
  repos: ReadRepos,
  ctx: UseCaseContext,
  id: string,
): ReviewTransaction | null {
  const found = repos.transactions.findVisible(ctx.viewer, id, ctx.clock.today().toString());
  if (found === undefined) return null;
  const [txn] = redact(ctx.viewer, [found]);
  if (txn === undefined) return null;
  return {
    id: txn.id,
    accountId: txn.accountId,
    accountName: repos.accounts.findVisible(ctx.viewer, txn.accountId)?.name ?? "",
    postedOn: txn.postedOn,
    amountCents: txn.amountCents,
    description: txn.descriptionRaw ?? "",
    payeeName: txn.payeeName,
  };
}

function candidatesFor(
  repos: ReadRepos,
  ctx: UseCaseContext,
  transaction: ReviewTransaction,
): ReviewTransaction[] {
  return repos.transactions
    .listTransferCandidates(ctx.viewer, {
      excludeAccountId: transaction.accountId,
      amountCents: -transaction.amountCents,
      from: shiftDay(transaction.postedOn, -TRANSFER_WINDOW_DAYS),
      to: shiftDay(transaction.postedOn, TRANSFER_WINDOW_DAYS),
    })
    .slice(0, MAX_CANDIDATES)
    .flatMap((candidate) => {
      const brief = transactionBrief(repos, ctx, candidate.id);
      return brief === null ? [] : [brief];
    });
}

const TRANSACTION_KINDS: readonly string[] = [
  CLASSIFY_UNCLASSIFIED_REVIEW.kind,
  CLASSIFY_RULE_OFFER_REVIEW.kind,
  IMPORT_PROBABLE_DUPLICATE_REVIEW.kind,
  IMPORT_TRANSFER_AMBIGUOUS_REVIEW.kind,
  IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW.kind,
];

function detailOf(repos: ReadRepos, ctx: UseCaseContext, row: ReviewItemRow): ReviewDetail {
  if (TRANSACTION_KINDS.includes(row.kind)) {
    const id = refId(row.entityRef, "transaction") ?? refId(row.entityRef, "transfer_candidate");
    const transaction = id === undefined ? null : transactionBrief(repos, ctx, id);
    const candidates =
      transaction !== null &&
      (row.kind === IMPORT_TRANSFER_AMBIGUOUS_REVIEW.kind ||
        row.kind === IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW.kind)
        ? candidatesFor(repos, ctx, transaction)
        : [];
    let suggestion: ReviewSuggestion | null = null;
    if (
      transaction !== null &&
      row.kind === CLASSIFY_UNCLASSIFIED_REVIEW.kind &&
      id !== undefined
    ) {
      const open = repos.suggestions
        .listForTransaction(ctx.viewer, id)
        .find((s) => s.resolvedAt === null && s.outcome === "open" && s.field === "category");
      if (open !== undefined) {
        suggestion = {
          id: open.id,
          splitId: open.splitId,
          field: open.field,
          suggestedValue: open.suggestedValue,
          categoryName: repos.categories.find(ctx.viewer, open.suggestedValue)?.name ?? null,
          confidence: open.confidence,
          payeeName: open.payeeName,
          websiteDomain: open.websiteDomain,
        };
      }
    }
    return { type: "transaction", transaction, candidates, suggestion };
  }
  switch (row.kind) {
    case IMPORT_SET_ASIDE_REVIEW.kind: {
      const batch = repos.importBatches.find(
        ctx.viewer,
        refId(row.entityRef, "import_batch") ?? "",
      );
      return {
        type: "batch",
        source: batch?.source ?? null,
        accountName:
          batch === undefined
            ? null
            : (repos.accounts.findVisible(ctx.viewer, batch.accountId)?.name ?? null),
        rows: [],
      };
    }
    case IMPORT_HANDOFF_REVIEW.kind: {
      const handoff = repos.importHandoffs.findForRecipient(
        ctx.viewer,
        refId(row.entityRef, "import_handoff") ?? "",
      );
      return {
        type: "handoff",
        filename: handoff?.filename ?? null,
        senderName:
          handoff === undefined
            ? null
            : (repos.person.listActive().find((p) => p.id === handoff.senderId)?.displayName ??
              null),
      };
    }
    case PARTNER_RESET_REVIEW.kind:
      return { type: "notice", issuedBy: issuerOf(repos, row) };
    case RECOVERY_CODE_USED_REVIEW.kind:
      return { type: "notice", issuedBy: null };
    case CLOSING_BALANCE_REVIEW.kind: {
      const account = repos.accounts.findVisible(ctx.viewer, refId(row.entityRef, "account") ?? "");
      return { type: "account", accountName: account?.name ?? null };
    }
    default:
      return { type: "none" };
  }
}

/**
 * `system.listReviewCards`: the open items the viewer may see, oldest first, each with the detail
 * its card needs. Items of an account the viewer cannot see are not listed (AD-3), hidden names
 * are placeholders (AD-4). A set-aside card lists its rows through `listSetAsideRowsForBatch`.
 */
export function listReviewCards(
  ctx: UseCaseContext,
  input: ListReviewCardsInput = {},
): ReviewCard[] {
  parseInput(listReviewCardsInput, input);
  requirePerson(ctx.viewer);
  const listed = ctx.uow.read((repos) =>
    repos.reviewItems.listOpenFor(ctx.viewer).map((row) => ({
      row,
      card: {
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt,
        accountId: row.accountId,
        detail: detailOf(repos, ctx, row),
      } satisfies ReviewCard,
    })),
  );
  return listed.map(({ row, card }): ReviewCard => {
    const batchId =
      row.kind === IMPORT_SET_ASIDE_REVIEW.kind ? refId(row.entityRef, "import_batch") : undefined;
    if (batchId === undefined || card.detail.type !== "batch") return card;
    return { ...card, detail: { ...card.detail, rows: setAsideRows(ctx, batchId) } };
  });
}

function setAsideRows(ctx: UseCaseContext, batchId: string): ReviewSetAsideRow[] {
  try {
    return listSetAsideRowsForBatch(ctx, batchId).map((r) => {
      let proposal: ReviewSetAsideRowProposal | null = null;
      if (r.proposal) {
        try {
          const parsed = JSON.parse(r.proposal);
          const validated = rowInterpretProposalSchema.safeParse(parsed);
          if (validated.success) {
            proposal = {
              postedOn: validated.data.postedOn,
              amountCents: validated.data.amountCents,
              description: validated.data.description,
              confidence: validated.data.confidence ?? null,
              explanation: validated.data.explanation ?? null,
            };
          }
        } catch {
          proposal = null;
        }
      }
      return {
        id: r.id,
        rowNumber: r.rowNumber,
        rawLine: r.rawLine,
        reason: r.reason,
        proposal,
      };
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "NotFound") return [];
    throw error;
  }
}

/** What the nav badge and the partner chip show. Numbers only. */
export interface ReviewCounts {
  /** The open items this viewer may see. */
  readonly open: number;
  /**
   * The partner and how many open items both partners see (household items, and items of an
   * account that is not private). The same number for either partner; null with no partner or
   * nothing pending. Never person-scoped or private-account items.
   */
  readonly partner: { readonly displayName: string; readonly pending: number } | null;
}

export const countReviewItemsInput = z.object({}).strict();
export type CountReviewItemsInput = z.input<typeof countReviewItemsInput>;

/** `system.countReviewItems`: the viewer's open count and the partner-pending count. */
export function countReviewItems(
  ctx: UseCaseContext,
  input: CountReviewItemsInput = {},
): ReviewCounts {
  parseInput(countReviewItemsInput, input);
  const viewer = requirePerson(ctx.viewer);
  return ctx.uow.read((repos) => {
    const open = repos.reviewItems.listOpenFor(viewer).length;
    const partner = repos.person.listActive().find((p) => p.id !== viewer.personId);
    const pending = repos.reviewItems.countSharedVisibleOpen(viewer);
    return {
      open,
      partner:
        partner === undefined || pending === 0
          ? null
          : { displayName: partner.displayName, pending },
    };
  });
}
