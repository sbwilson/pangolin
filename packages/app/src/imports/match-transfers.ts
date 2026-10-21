// Pipeline stage 6 (import-pipeline spec): match transfers between our own accounts and flag
// probable duplicates. Both run inside the import's write transaction.
import {
  findTransferMatch,
  isProbableDuplicate,
  normaliseCommBankDescription,
  shiftDay,
  TRANSFER_WINDOW_DAYS,
  type TransferLeg,
} from "@pangolin/domain";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import { deleteTransaction } from "../ledger/delete-transaction.ts";
import { transactionEntityRef, transferCandidateEntityRef } from "../ledger/needs-review.ts";
import { auditSnapshot, storedTransaction } from "../ledger/transaction-view.ts";
import type { TransferCandidateRow, TxRepos } from "../ports/unit-of-work.ts";
import { defineReviewKind, raiseReviewItem, resolveReviewItem } from "../system/review-items.ts";
import { type Audit, write } from "../write.ts";

/** A new transaction matches several transfer legs and was left unlinked. Entity `transaction:<id>`. */
export const IMPORT_TRANSFER_AMBIGUOUS_REVIEW = defineReviewKind({
  kind: "import.transfer_ambiguous",
  module: "imports",
  scope: "account",
});

/**
 * As `import.transfer_ambiguous`, but a candidate sits in a private account and the new
 * transaction does not: raised for the importer alone (person scope) on `transfer_candidate:<id>`,
 * so no other viewer sees it and `transaction.needs_review` does not move.
 */
export const IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW = defineReviewKind({
  kind: "import.transfer_ambiguous_private",
  module: "imports",
  scope: "person",
});

/** A new transaction looks like an existing one dated a few days apart. Entity `transaction:<id>`. */
export const IMPORT_PROBABLE_DUPLICATE_REVIEW = defineReviewKind({
  kind: "import.probable_duplicate",
  module: "imports",
  scope: "account",
});

export const transferAmbiguousKey = (transactionId: string) =>
  `import.transfer_ambiguous:${transactionId}`;
export const transferAmbiguousPrivateKey = (transactionId: string) =>
  `import.transfer_ambiguous_private:${transactionId}`;
export const probableDuplicateKey = (transactionId: string) =>
  `import.probable_duplicate:${transactionId}`;

/** The identity of a same-day row, shared with the import's occurrence counting. */
export function dayKey(postedOn: string, amountCents: number, normalisedDescription: string) {
  return `${postedOn}\n${amountCents}\n${normalisedDescription}`;
}

/**
 * Whether a row about to be committed to `accountId` looks like a live transaction of that
 * account one to three days away (same amount, same normalised description). An existing row
 * whose `dayKey` is in `claimed` (an exact duplicate of it is in the same file) is skipped.
 */
export function hasProbableDuplicate(
  tx: Pick<TxRepos, "transactions">,
  accountId: string,
  row: {
    readonly postedOn: string;
    readonly amountCents: number;
    readonly description: string;
    readonly externalId: string | null;
  },
  claimed: ReadonlySet<string>,
): boolean {
  const subject = {
    postedOn: row.postedOn,
    amountCents: row.amountCents,
    normalisedDescription: normaliseCommBankDescription(row.description),
    externalId: row.externalId,
  };
  const near = tx.transactions.listNearDuplicates(
    accountId,
    row.amountCents,
    shiftDay(row.postedOn, -TRANSFER_WINDOW_DAYS),
    shiftDay(row.postedOn, TRANSFER_WINDOW_DAYS),
  );
  return near.some((e) => {
    const normalisedDescription = normaliseCommBankDescription(e.descriptionRaw);
    if (claimed.has(dayKey(e.postedOn, e.amountCents, normalisedDescription))) return false;
    return isProbableDuplicate(subject, {
      postedOn: e.postedOn,
      amountCents: e.amountCents,
      normalisedDescription,
      externalId: e.externalId,
    });
  });
}

/** Raises the probable-duplicate item for a transaction that now exists. Idempotent. */
export function raiseProbableDuplicate(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "clock" | "newId">,
  transaction: { readonly id: string; readonly accountId: string },
): void {
  raiseReviewItem(tx, audit, ctx, {
    kind: IMPORT_PROBABLE_DUPLICATE_REVIEW,
    entityRef: transactionEntityRef(transaction.id),
    dedupeKey: probableDuplicateKey(transaction.id),
    accountId: transaction.accountId,
  });
}

/**
 * Links each new transaction to its unique opposite-amount partner in another visible account
 * (within three days, both ends unique) as an `auto` transfer group, and raises an
 * `import.transfer_ambiguous` item on each one with several possible partners (or, when a private
 * account's transaction is among them and the new one is shared, an importer-only
 * `import.transfer_ambiguous_private` item). Run once, after
 * every row of the batch is committed, so siblings count. A candidate in an account closed
 * before its date is ignored; the import never aborts over a link.
 */
export function matchTransfersForBatch(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "viewer" | "clock" | "newId">,
  newTxns: readonly TransferLeg[],
): void {
  const accountLocked = new Map<string, string | null>();
  const closedOn = (accountId: string): string | null => {
    if (!accountLocked.has(accountId)) {
      accountLocked.set(
        accountId,
        tx.accounts.findVisible(ctx.viewer, accountId)?.closedOn ?? null,
      );
    }
    return accountLocked.get(accountId) ?? null;
  };
  const usable = (leg: { accountId: string; postedOn: string }) => {
    if (ctx.viewer.kind === "system") return true;
    const closed = closedOn(leg.accountId);
    return closed === null || leg.postedOn <= closed;
  };
  const poolFor = (leg: TransferLeg): TransferCandidateRow[] =>
    tx.transactions
      .listTransferCandidates(ctx.viewer, {
        excludeAccountId: leg.accountId,
        amountCents: -leg.amountCents,
        from: shiftDay(leg.postedOn, -TRANSFER_WINDOW_DAYS),
        to: shiftDay(leg.postedOn, TRANSFER_WINDOW_DAYS),
      })
      .filter(usable);

  const isPrivate = (accountId: string): boolean =>
    tx.accounts.findVisible(ctx.viewer, accountId)?.isPrivate === true;
  // Whether an ambiguity on a shared leg involves a private account: any candidate in the leg's
  // pool, or in the counterpart pool of its single candidate. Over-inclusive on purpose.
  const privateInvolved = (leg: TransferLeg, pool: readonly TransferCandidateRow[]): boolean => {
    if (isPrivate(leg.accountId)) return false;
    const only = pool.length === 1 ? pool[0] : undefined;
    const considered = only === undefined ? pool : [...pool, ...poolFor(only)];
    return considered.some((c) => isPrivate(c.accountId));
  };

  const linked = new Set<string>();
  for (const leg of newTxns) {
    if (linked.has(leg.id) || leg.amountCents === 0 || !usable(leg)) continue;
    const pool = poolFor(leg);
    const result = findTransferMatch(leg, pool, poolFor);
    if (result.kind === "none") continue;
    if (result.kind === "ambiguous") {
      if (ctx.viewer.kind === "person" && privateInvolved(leg, pool)) {
        raiseReviewItem(tx, audit, ctx, {
          kind: IMPORT_TRANSFER_AMBIGUOUS_PRIVATE_REVIEW,
          entityRef: transferCandidateEntityRef(leg.id),
          dedupeKey: transferAmbiguousPrivateKey(leg.id),
          personId: ctx.viewer.personId,
        });
      } else {
        raiseReviewItem(tx, audit, ctx, {
          kind: IMPORT_TRANSFER_AMBIGUOUS_REVIEW,
          entityRef: transactionEntityRef(leg.id),
          dedupeKey: transferAmbiguousKey(leg.id),
          accountId: leg.accountId,
        });
      }
      continue;
    }
    linkAuto(tx, audit, ctx, [leg, result.candidate]);
    linked.add(leg.id);
    linked.add(result.candidate.id);
  }
}

function linkAuto(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "viewer" | "clock" | "newId">,
  sides: readonly [TransferLeg, TransferLeg],
): void {
  const before = sides.map((s) => ({ side: s, stored: storedTransaction(tx, ctx.viewer, s.id) }));
  const at = formatInstant(ctx.clock.now());
  const groupId = ctx.newId<"TransferGroup">();
  tx.transferGroups.insert({ id: groupId, matchedBy: "auto", createdAt: at, updatedAt: at });
  if (
    tx.transactions.setTransferGroup(
      sides.map((s) => s.id),
      groupId,
      at,
    ) !== 2
  ) {
    throw new Error("A transfer group's transactions vanished during its creation");
  }
  for (const { side, stored } of before) {
    audit({
      entity: "transaction",
      entityId: side.id,
      accountId: side.accountId,
      action: "update",
      before: auditSnapshot(stored),
      after: auditSnapshot(storedTransaction(tx, ctx.viewer, side.id)),
    });
  }
}

export const resolveImportFlagInput = z.object({ transactionId: idInput }).strict();
export type ResolveImportFlagInput = z.input<typeof resolveImportFlagInput>;

function resolveFlag(
  ctx: UseCaseContext,
  input: ResolveImportFlagInput,
  dedupeKey: (id: string) => string,
  resolution: string,
): void {
  const { transactionId } = parseInput(resolveImportFlagInput, input);
  write(ctx, (tx, audit) => {
    if (
      tx.transactions.findVisible(ctx.viewer, transactionId, ctx.clock.today().toString()) ===
      undefined
    ) {
      throw new AppError("NotFound", "Transaction not found");
    }
    if (!resolveReviewItem(tx, audit, ctx, { dedupeKey: dedupeKey(transactionId), resolution })) {
      throw new AppError("NotFound", "Review item not found");
    }
  });
}

/** Resolves the `import.probable_duplicate` item on a transaction the person decided to keep. */
export function keepProbableDuplicate(ctx: UseCaseContext, input: ResolveImportFlagInput): void {
  resolveFlag(ctx, input, probableDuplicateKey, "kept");
}

/**
 * Resolves the `import.transfer_ambiguous` (or `_private`) item: the person leaves the
 * transaction unlinked.
 */
export function dismissTransferAmbiguity(ctx: UseCaseContext, input: ResolveImportFlagInput): void {
  const { transactionId } = parseInput(resolveImportFlagInput, input);
  write(ctx, (tx, audit) => {
    if (
      tx.transactions.findVisible(ctx.viewer, transactionId, ctx.clock.today().toString()) ===
      undefined
    ) {
      throw new AppError("NotFound", "Transaction not found");
    }
    // A person-scoped item resolves only for a viewer who can see it; anyone else gets the same
    // answer as for no item.
    const visible = new Set(tx.reviewItems.listOpenFor(ctx.viewer).map((i) => i.dedupeKey));
    const resolved = [transferAmbiguousKey, transferAmbiguousPrivateKey]
      .filter((key) => visible.has(key(transactionId)))
      .map((key) =>
        resolveReviewItem(tx, audit, ctx, {
          dedupeKey: key(transactionId),
          resolution: "dismissed",
        }),
      );
    if (!resolved.some(Boolean)) throw new AppError("NotFound", "Review item not found");
  });
}

/**
 * Soft-deletes a transaction flagged as a probable duplicate (`ledger.deleteTransaction`, which
 * resolves its open items). `NotFound` when it has no open `import.probable_duplicate` item.
 */
export function removeProbableDuplicate(ctx: UseCaseContext, input: ResolveImportFlagInput): void {
  const { transactionId } = parseInput(resolveImportFlagInput, input);
  const flagged = ctx.uow.read((repos) =>
    repos.reviewItems
      .listOpenFor(ctx.viewer)
      .some((i) => i.dedupeKey === probableDuplicateKey(transactionId)),
  );
  if (!flagged) throw new AppError("NotFound", "Review item not found");
  deleteTransaction(ctx, { id: transactionId });
}
