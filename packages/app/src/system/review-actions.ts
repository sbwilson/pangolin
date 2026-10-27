// The Needs review actions (ticket 8): each one finds the open item `id` the viewer may see and
// calls the use case that owns the thing it is about. An item resolves only through its entity
// changing or that use case; an id that is unknown, finished or not the viewer's is `NotFound`
// (the same answer for all three, AD-3), and one of another kind is `NotFound` too.
import { shiftDay, TRANSFER_WINDOW_DAYS } from "@pangolin/domain";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import {
  type AcceptRuleOfferInput,
  acceptRuleOffer,
  CLASSIFY_RULE_OFFER_REVIEW,
  CLASSIFY_UNCLASSIFIED_REVIEW,
  dismissRuleOffer,
} from "../classify/rules.ts";
import type { AttachmentContext, UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { dismissNotice, NOTICE_KINDS } from "../identity/notices.ts";
import { PARTNER_RESET_REVIEW, revokeMyReEnrolmentLinks } from "../identity/re-enrolment.ts";
import { acceptHandoff, dismissHandoff, IMPORT_HANDOFF_REVIEW } from "../imports/handoff.ts";
import {
  dismissTransferAmbiguity,
  IMPORT_PROBABLE_DUPLICATE_REVIEW,
  IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW,
  IMPORT_TRANSFER_AMBIGUOUS_REVIEW,
  keepProbableDuplicate,
  removeProbableDuplicate,
  transferAmbiguousKey,
  transferAmbiguousPrivateKey,
} from "../imports/match-transfers.ts";
import {
  confirmSetAsideProposal,
  type DiscardSetAsideRowInput,
  discardSetAsideRow,
  type FixSetAsideRowInput,
  type FixSetAsideRowResult,
  fixSetAsideRow,
  IMPORT_SET_ASIDE_REVIEW,
  type InterpretSetAsideRowsContext,
  type InterpretSetAsideRowsResult,
  interpretSetAsideRows,
  listSetAsideRowsForBatch,
} from "../imports/set-aside.ts";
import { idInput } from "../inputs.ts";
import { setSplitField } from "../ledger/set-split-field.ts";
import { createTransferGroup } from "../ledger/transfer-groups.ts";
import type { ReviewItemRow, TxRepos, UnitOfWork } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { resolveReviewItem } from "./review-items.ts";

const itemInput = z.object({ id: idInput }).strict();

/** The open item `id` the viewer may see, when its kind is one of `kinds`; else `NotFound`. */
function openItem(ctx: UseCaseContext, id: string, kinds: readonly string[]): ReviewItemRow {
  const { id: itemId } = parseInput(itemInput, { id });
  const item = ctx.uow
    .read((repos) => repos.reviewItems.listOpenFor(ctx.viewer))
    .find((row) => row.id === itemId);
  if (item === undefined || !kinds.includes(item.kind)) {
    throw new AppError("NotFound", "Review item not found");
  }
  return item;
}

/** The id after `<prefix>:` in the item's entity reference. */
function entityId(item: ReviewItemRow, prefix: string): string {
  const start = `${prefix}:`;
  if (!item.entityRef.startsWith(start)) {
    throw new AppError("NotFound", "Review item not found");
  }
  return item.entityRef.slice(start.length);
}

const transactionOf = (item: ReviewItemRow) => entityId(item, "transaction");

const TRANSFER_KINDS = [
  IMPORT_TRANSFER_AMBIGUOUS_REVIEW.kind,
  IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW.kind,
];

/** The transaction an ambiguous-transfer item (either kind) is about. */
const transferSubjectOf = (item: ReviewItemRow) =>
  item.kind === IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW.kind
    ? entityId(item, "transfer_candidate")
    : transactionOf(item);

/** A unit of work whose every transaction is the one already open. */
function insideOpen(tx: TxRepos): UnitOfWork {
  return { transaction: (fn) => fn(tx), read: (fn) => fn(tx) };
}

// ------------------------------------------------------------------------------------ rules

export type AcceptRuleOfferItemInput = { readonly id: string } & Pick<
  AcceptRuleOfferInput,
  "name" | "priority" | "conditions" | "actions"
>;

/** Accepts the rule offered after a correction (`classify.acceptRuleOffer`). */
export function acceptRuleOfferItem(ctx: UseCaseContext, input: AcceptRuleOfferItemInput): void {
  const { id, ...rest } = input;
  const item = openItem(ctx, id, [CLASSIFY_RULE_OFFER_REVIEW.kind]);
  acceptRuleOffer(ctx, { ...rest, transactionId: transactionOf(item) });
}

/** Turns the offered rule down (`classify.dismissRuleOffer`). */
export function dismissRuleOfferItem(ctx: UseCaseContext, input: { readonly id: string }): void {
  const item = openItem(ctx, input.id, [CLASSIFY_RULE_OFFER_REVIEW.kind]);
  dismissRuleOffer(ctx, { transactionId: transactionOf(item) });
}

// ------------------------------------------------------------------------------ suggestions

export const acceptSuggestionItemInput = z.object({ id: idInput }).strict();
export type AcceptSuggestionItemInput = z.input<typeof acceptSuggestionItemInput>;

/**
 * Accepts an AI categorisation suggestion (`classify.acceptSuggestionItem`).
 * Resolves the suggestion via `ledger.setSplitField` with `source: 'llm'`,
 * marks the suggestion as `accepted`, and resolves the unclassified review item.
 */
export function acceptSuggestionItem(ctx: UseCaseContext, input: AcceptSuggestionItemInput): void {
  const { id } = parseInput(acceptSuggestionItemInput, input);
  const item = openItem(ctx, id, [CLASSIFY_UNCLASSIFIED_REVIEW.kind]);
  const transactionId = transactionOf(item);

  const openSuggestion = ctx.uow.read((repos) =>
    repos.suggestions
      .listForTransaction(ctx.viewer, transactionId)
      .find((s) => s.resolvedAt === null && s.outcome === "open" && s.field === "category"),
  );
  if (openSuggestion === undefined) {
    throw new AppError("NotFound", "Suggestion not found");
  }

  const result = setSplitField(ctx, {
    transactionId,
    splitId: openSuggestion.splitId,
    field: "category",
    value: openSuggestion.suggestedValue,
    source: "llm",
  });
  if (!result.applied) {
    throw new AppError("Conflict", result.reason ?? "Suggestion could not be applied");
  }
}

export const dismissSuggestionItemInput = z.object({ id: idInput }).strict();
export type DismissSuggestionItemInput = z.input<typeof dismissSuggestionItemInput>;

/**
 * Dismisses an AI categorisation suggestion (`classify.dismissSuggestionItem`).
 * Marks the suggestion as `rejected` with `resolvedAt = now` and an audit record;
 * the underlying transaction split remains unclassified and the review item stays open.
 */
export function dismissSuggestionItem(
  ctx: UseCaseContext,
  input: DismissSuggestionItemInput,
): void {
  const { id } = parseInput(dismissSuggestionItemInput, input);
  const item = openItem(ctx, id, [CLASSIFY_UNCLASSIFIED_REVIEW.kind]);
  const transactionId = transactionOf(item);

  const openSuggestion = ctx.uow.read((repos) =>
    repos.suggestions
      .listForTransaction(ctx.viewer, transactionId)
      .find((s) => s.resolvedAt === null && s.outcome === "open" && s.field === "category"),
  );
  if (openSuggestion === undefined) {
    throw new AppError("NotFound", "Suggestion not found");
  }

  write(ctx, (tx, audit) => {
    const now = formatInstant(ctx.clock.now());
    const resolved = tx.suggestions.resolveOpen(
      openSuggestion.splitId,
      openSuggestion.field,
      "rejected",
      now,
    );
    if (!resolved) {
      throw new AppError("NotFound", "Suggestion not found");
    }
    audit({
      entity: "suggestion",
      entityId: openSuggestion.id,
      accountId: openSuggestion.accountId,
      action: "update",
      before: openSuggestion,
      after: { ...openSuggestion, outcome: "rejected", resolvedAt: now },
    });
  });
}

export const bulkAcceptSuggestionsInput = z
  .object({
    ids: z.array(idInput),
  })
  .strict();
export type BulkAcceptSuggestionsInput = z.input<typeof bulkAcceptSuggestionsInput>;

export interface BulkAcceptSuggestionsResult {
  readonly acceptedCount: number;
}

/**
 * Accepts multiple high-confidence AI suggestions in batch.
 * Applies each suggestion via `setSplitField(..., 'llm')`.
 */
export function bulkAcceptSuggestions(
  ctx: UseCaseContext,
  input: BulkAcceptSuggestionsInput,
): BulkAcceptSuggestionsResult {
  const { ids } = parseInput(bulkAcceptSuggestionsInput, input);
  const uniqueIds = Array.from(new Set(ids));
  let acceptedCount = 0;
  for (const id of uniqueIds) {
    acceptSuggestionItem(ctx, { id });
    acceptedCount++;
  }
  return { acceptedCount };
}

// ------------------------------------------------------------------------------- duplicates

/** Keeps a probable duplicate (`imports.keepProbableDuplicate`). */
export function keepDuplicateItem(ctx: UseCaseContext, input: { readonly id: string }): void {
  const item = openItem(ctx, input.id, [IMPORT_PROBABLE_DUPLICATE_REVIEW.kind]);
  keepProbableDuplicate(ctx, { transactionId: transactionOf(item) });
}

/** Removes a probable duplicate (`imports.removeProbableDuplicate`). */
export function removeDuplicateItem(ctx: UseCaseContext, input: { readonly id: string }): void {
  const item = openItem(ctx, input.id, [IMPORT_PROBABLE_DUPLICATE_REVIEW.kind]);
  removeProbableDuplicate(ctx, { transactionId: transactionOf(item) });
}

// --------------------------------------------------------------------------------- transfers

/** Leaves an ambiguous transfer unlinked (`imports.dismissTransferAmbiguity`). */
export function dismissTransferItem(ctx: UseCaseContext, input: { readonly id: string }): void {
  const item = openItem(ctx, input.id, TRANSFER_KINDS);
  dismissTransferAmbiguity(ctx, { transactionId: transferSubjectOf(item) });
}

const linkInput = z.object({ id: idInput, candidateId: idInput }).strict();
export type LinkTransferItemInput = z.input<typeof linkInput>;

/**
 * Links the flagged transaction with the chosen candidate as a transfer (`ledger.createTransferGroup`)
 * and resolves the item as `linked`, in one write. The candidate must be one of the unlinked
 * opposite-amount transactions within three days that the card lists, else `Validation`.
 */
export function linkTransferItem(ctx: UseCaseContext, input: LinkTransferItemInput): void {
  const { id, candidateId } = parseInput(linkInput, input);
  const item = openItem(ctx, id, TRANSFER_KINDS);
  const transactionId = transferSubjectOf(item);
  write(ctx, (tx, audit) => {
    const today = ctx.clock.today().toString();
    const flagged = tx.transactions.findVisible(ctx.viewer, transactionId, today);
    if (flagged === undefined) throw new AppError("NotFound", "Transaction not found");
    const offered = tx.transactions
      .listTransferCandidates(ctx.viewer, {
        excludeAccountId: flagged.accountId,
        amountCents: -flagged.amountCents,
        from: shiftDay(flagged.postedOn, -TRANSFER_WINDOW_DAYS),
        to: shiftDay(flagged.postedOn, TRANSFER_WINDOW_DAYS),
      })
      .some((candidate) => candidate.id === candidateId);
    if (!offered) throw new AppError("Validation", "That is not a candidate for this transfer");
    createTransferGroup(
      { ...ctx, uow: insideOpen(tx) },
      { transactionIds: [transactionId, candidateId] },
    );
    resolveReviewItem(tx, audit, ctx, {
      dedupeKey:
        item.kind === IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW.kind
          ? transferAmbiguousPrivateKey(transactionId)
          : transferAmbiguousKey(transactionId),
      resolution: "linked",
    });
  });
}

// ------------------------------------------------------------------------------------ hand-off

const acceptHandoffItemInput = z.object({ id: idInput, accountId: idInput }).strict();
export type AcceptHandoffItemInput = z.input<typeof acceptHandoffItemInput>;

/** Imports a hand-off into the account the recipient picked (`imports.acceptHandoff`). */
export function acceptHandoffItem(ctx: AttachmentContext, input: AcceptHandoffItemInput): void {
  const { id, accountId } = parseInput(acceptHandoffItemInput, input);
  const item = openItem(ctx, id, [IMPORT_HANDOFF_REVIEW.kind]);
  acceptHandoff(ctx, { handoffId: entityId(item, "import_handoff"), accountId });
}

/** Turns a hand-off down and discards its file (`imports.dismissHandoff`). */
export function dismissHandoffItem(ctx: AttachmentContext, input: { readonly id: string }): void {
  const item = openItem(ctx, input.id, [IMPORT_HANDOFF_REVIEW.kind]);
  dismissHandoff(ctx, { handoffId: entityId(item, "import_handoff") });
}

// ------------------------------------------------------------------------------- set-aside rows

/** The set-aside row `rowId` of the item's batch; `NotFound` for a row of another batch. */
function requireRowOf(ctx: UseCaseContext, item: ReviewItemRow, rowId: string): void {
  const rows = listSetAsideRowsForBatch(ctx, entityId(item, "import_batch"));
  if (!rows.some((row) => row.id === rowId)) throw new AppError("NotFound", "Row not found");
}

export type FixSetAsideRowItemInput = { readonly id: string } & Omit<FixSetAsideRowInput, "id">;

/** Commits a corrected set-aside row (`imports.fixSetAsideRow`). */
export function fixSetAsideRowItem(ctx: UseCaseContext, input: FixSetAsideRowItemInput): void {
  const { id, ...rest } = input;
  const item = openItem(ctx, id, [IMPORT_SET_ASIDE_REVIEW.kind]);
  const rowId = rest.rowId;
  if (rowId === undefined) throw new AppError("Validation", "rowId is required");
  requireRowOf(ctx, item, rowId);
  fixSetAsideRow(ctx, rest);
}

export type DiscardSetAsideRowItemInput = { readonly id: string } & Omit<
  DiscardSetAsideRowInput,
  "id"
>;

/** Discards a set-aside row (`imports.discardSetAsideRow`). */
export function discardSetAsideRowItem(
  ctx: UseCaseContext,
  input: DiscardSetAsideRowItemInput,
): void {
  const { id, ...rest } = input;
  const item = openItem(ctx, id, [IMPORT_SET_ASIDE_REVIEW.kind]);
  const rowId = rest.rowId;
  if (rowId === undefined) throw new AppError("Validation", "rowId is required");
  requireRowOf(ctx, item, rowId);
  discardSetAsideRow(ctx, rest);
}

export type InterpretSetAsideRowsItemInput = { readonly id: string };

/** Interprets set-aside rows for a batch using AI (`imports.interpretSetAsideRows`). */
export async function interpretSetAsideRowsItem(
  ctx: InterpretSetAsideRowsContext,
  input: InterpretSetAsideRowsItemInput,
): Promise<InterpretSetAsideRowsResult> {
  const item = openItem(ctx, input.id, [IMPORT_SET_ASIDE_REVIEW.kind]);
  const batchId = entityId(item, "import_batch");
  return await interpretSetAsideRows(ctx, { batchId });
}

export type ConfirmSetAsideProposalItemInput = {
  readonly id: string;
  readonly rowId: string;
};

/** Confirms an AI proposal on a set-aside row and commits it to the ledger. */
export function confirmSetAsideProposalItem(
  ctx: UseCaseContext,
  input: ConfirmSetAsideProposalItemInput,
): FixSetAsideRowResult {
  if (!input.rowId) {
    throw new AppError("Validation", "rowId is required");
  }
  const item = openItem(ctx, input.id, [IMPORT_SET_ASIDE_REVIEW.kind]);
  requireRowOf(ctx, item, input.rowId);
  return confirmSetAsideProposal(ctx, { rowId: input.rowId });
}

// ---------------------------------------------------------------------------------- notices

/** "Got it": dismisses one of the viewer's own notices (`identity.dismissNotice`). */
export function dismissNoticeItem(ctx: UseCaseContext, input: { readonly id: string }): void {
  const item = openItem(ctx, input.id, NOTICE_KINDS);
  dismissNotice(ctx, { id: item.id });
}

/** "Revoke the link": ends every unused re-enrolment link issued against the viewer. */
export function revokeLinksItem(
  ctx: UseCaseContext,
  input: { readonly id: string },
): { readonly revoked: number } {
  openItem(ctx, input.id, [PARTNER_RESET_REVIEW.kind]);
  return revokeMyReEnrolmentLinks(ctx, {});
}
