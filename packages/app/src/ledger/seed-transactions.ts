import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { syncClosingBalance } from "../accounts/closing-balance.ts";
import type { UseCaseContext } from "../context.ts";
import type { SplitRow, TransactionRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import { fingerprintManual, MANUAL_FINGERPRINT_VERSION } from "./fingerprint.ts";

export interface SeedSplitInput {
  readonly amountCents: number;
  readonly categoryId?: string | null | undefined;
  readonly beneficiary?: string | undefined;
  readonly tagIds?: readonly string[] | undefined;
}

export interface SeedTransactionInput {
  readonly key: string;
  readonly accountId: string;
  readonly postedOn: string;
  readonly amountCents: number;
  readonly description: string;
  readonly payeeId?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly splits: readonly SeedSplitInput[];
}

export interface AccountSeedInfo {
  readonly isPrivate: boolean;
  readonly ownerPersonId?: string | undefined;
}

/**
 * Creates transactions in bulk for seed loading. Writes the transaction rows with their initial
 * splits, tags and notes in a single unit of work without redundant `getTransaction` round-trips,
 * auditing each creation as `cli:seed`, and synchronising closing balances once per touched account.
 */
export function seedTransactions(
  ctx: UseCaseContext,
  transactions: readonly SeedTransactionInput[],
  accountOwners: ReadonlyMap<string, AccountSeedInfo>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (transactions.length === 0) return result;

  return write(ctx, (tx, audit) => {
    const at = formatInstant(ctx.clock.now());
    const touchedAccounts = new Set<string>();

    for (const input of transactions) {
      const id = ctx.newId<"Transaction">();
      result[input.key] = id;
      touchedAccounts.add(input.accountId);

      const accountInfo = accountOwners.get(input.accountId);
      const isPrivate = accountInfo?.isPrivate ?? false;
      const ownerPersonId = accountInfo?.ownerPersonId;

      const row: TransactionRow = {
        id,
        accountId: input.accountId as Id<"Account">,
        postedOn: input.postedOn,
        amountCents: input.amountCents,
        descriptionRaw: input.description,
        payeeId: (input.payeeId ?? null) as Id<"Payee"> | null,
        status: "posted",
        externalId: null,
        fingerprint: fingerprintManual(input.accountId, id),
        fingerprintVersion: MANUAL_FINGERPRINT_VERSION,
        importId: null,
        performedBy: null,
        transferGroupId: null,
        needsReview: false,
        isHidden: false,
        nameHiddenBy: null,
        nameHiddenUntil: null,
        notes: input.notes ?? null,
        createdAt: at,
        updatedAt: at,
      };

      const splitRows: SplitRow[] = input.splits.map((split) => {
        const beneficiary =
          split.beneficiary !== undefined
            ? split.beneficiary
            : isPrivate && ownerPersonId !== undefined
              ? ownerPersonId
              : "shared";

        return {
          id: ctx.newId<"Split">(),
          transactionId: id,
          amountCents: split.amountCents,
          categoryId: (split.categoryId ?? null) as Id<"Category"> | null,
          activityId: null,
          beneficiary,
          propertyId: null,
          taxCategoryId: null,
          deductibleBp: null,
          memo: null,
          categorySource: split.categoryId ? "user" : null,
          activitySource: null,
          taxCategorySource: null,
          beneficiarySource: split.beneficiary !== undefined ? "user" : null,
          deductibleBpSource: null,
          createdAt: at,
          updatedAt: at,
        };
      });

      tx.transactions.insert(row, splitRows);

      for (let i = 0; i < input.splits.length; i++) {
        const splitInput = input.splits[i];
        if (splitInput?.tagIds && splitInput.tagIds.length > 0) {
          const splitRow = splitRows[i];
          if (splitRow !== undefined) {
            tx.tags.replaceForSplit(ctx.viewer, splitRow.id, splitInput.tagIds, at);
          }
        }
      }

      audit({
        entity: "transaction",
        entityId: row.id,
        accountId: row.accountId,
        action: "create",
        before: null,
        after: { ...row, splits: splitRows },
      });
    }

    for (const accountId of touchedAccounts) {
      syncClosingBalance(tx, audit, ctx, accountId);
    }

    return result;
  });
}
