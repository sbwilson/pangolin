import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import { AppError } from "../errors.ts";
import type { LlmProvider } from "../ports/llm-provider.ts";
import type { FewShotExample, LlmProviderRow, SuggestionRow } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";
import {
  buildCategorisationRequest,
  CATEGORISE_PROMPT_VERSION,
  type CategoriseCategoryOption,
  type CategoriseRequestItem,
} from "./categorise-request.ts";
import { normaliseDomain } from "./domain.ts";
import { findFewShotExamples } from "./few-shot-search.ts";

export const CATEGORISE_BATCH_SIZE = 20;

export interface CategoriseTransactionsContext extends UseCaseContext {
  readonly provider?: LlmProvider | undefined;
  readonly providerIsLocal?: boolean | undefined;
  readonly providerModel?: string | undefined;
  readonly resolveProvider?: ((row: LlmProviderRow) => LlmProvider) | undefined;
}

export interface CategoriseTransactionsInput {
  readonly transactionIds: readonly string[];
}

export interface CategoriseTransactionsResult {
  readonly suggestions: readonly SuggestionRow[];
  readonly recordedCount: number;
  readonly discardedCount: number;
}

interface ItemMeta {
  readonly transactionId: string;
  readonly accountId: string;
  readonly splitId: string;
  readonly isPrivate: boolean;
  readonly description: string;
  readonly amountCents: number;
  readonly postedOn: string;
}

/**
 * Transaction categorisation engine (AD-6, AD-10).
 *
 * Batches unclassified transactions (~20 per prompt), calls the configured LLM provider,
 * validates responses with strict Zod schema, rejects hallucinated category IDs,
 * and writes suggestions with `outcome = 'open'`.
 */
export async function categoriseTransactions(
  ctx: CategoriseTransactionsContext,
  input: CategoriseTransactionsInput,
): Promise<CategoriseTransactionsResult> {
  if (input.transactionIds.length === 0) {
    return { suggestions: [], recordedCount: 0, discardedCount: 0 };
  }

  const today = ctx.clock.today().toString();

  // 1. Resolve LLM provider and determine locality (AD-6)
  const providerRow = ctx.uow.read((repos) => repos.llmProviders.findForPurpose("categorise"));

  let provider: LlmProvider;
  let isLocal: boolean;
  let model: string;

  if (ctx.provider) {
    provider = ctx.provider;
    isLocal = ctx.providerIsLocal ?? providerRow?.isLocal ?? false;
    model = ctx.providerModel ?? providerRow?.model ?? "default";
  } else if (providerRow && ctx.resolveProvider) {
    provider = ctx.resolveProvider(providerRow);
    isLocal = providerRow.isLocal;
    model = providerRow.model;
  } else {
    throw new AppError("Validation", "No LLM provider configured for categorisation");
  }

  // 2. Read transactions, accounts, categories, and tax categories
  const {
    itemsToCategorise,
    categoryOptions,
    knownCategoryIds,
    knownTaxCategoryIds,
    knownActivityIds,
    fewShotPool,
  } = ctx.uow.read((repos) => {
    const categories = repos.categories.list(ctx.viewer);
    const groups = repos.categoryGroups.list(ctx.viewer);
    const groupMap = new Map(groups.map((g) => [g.id, g.name]));

    const categoryOptions: CategoriseCategoryOption[] = categories.map((c) => ({
      id: c.id,
      name: c.name,
      groupName: groupMap.get(c.groupId),
    }));
    const knownCategoryIds = new Set(categories.map((c) => c.id));
    const knownTaxCategoryIds = new Set(repos.taxCategories.list(ctx.viewer).map((t) => t.id));
    const knownActivityIds = new Set(repos.activities.list(ctx.viewer).map((a) => a.id));

    const itemsToCategorise: ItemMeta[] = [];
    const fewShotPool: FewShotExample[] = [];

    for (const txnId of input.transactionIds) {
      const txn = repos.transactions.findVisible(ctx.viewer, txnId, today);
      if (!txn || txn.descriptionRaw === null) continue;

      const acc = repos.accounts.findVisible(ctx.viewer, txn.accountId);
      if (!acc) continue;
      const isPrivate = acc.isPrivate;

      // AD-6: Reject private account transactions immediately if provider is not local
      if (!isLocal && isPrivate) {
        throw new AppError(
          "PermissionDenied",
          "Cannot send private account transactions to a cloud LLM provider",
        );
      }

      const unclassifiedSplit = txn.splits.find((s) => s.categoryId === null) ?? txn.splits[0];
      if (!unclassifiedSplit) continue;

      itemsToCategorise.push({
        transactionId: txn.id,
        accountId: txn.accountId,
        splitId: unclassifiedSplit.id,
        isPrivate,
        description: txn.descriptionRaw,
        amountCents: txn.amountCents,
        postedOn: txn.postedOn,
      });

      // Retrieve few-shot examples for this description from public accounts
      if (fewShotPool.length < 10) {
        const examples = findFewShotExamples(
          repos,
          ctx.viewer,
          today,
          txn.descriptionRaw,
          10 - fewShotPool.length,
        );
        for (const ex of examples) {
          if (!fewShotPool.some((p) => p.transactionId === ex.transactionId)) {
            fewShotPool.push(ex);
            if (fewShotPool.length >= 10) break;
          }
        }
      }
    }

    return {
      itemsToCategorise,
      categoryOptions,
      knownCategoryIds,
      knownTaxCategoryIds,
      knownActivityIds,
      fewShotPool,
    };
  });

  if (categoryOptions.length === 0 || itemsToCategorise.length === 0) {
    return { suggestions: [], recordedCount: 0, discardedCount: 0 };
  }

  // 3. Process transactions in batches of at most CATEGORISE_BATCH_SIZE (20)
  const allValidSuggestions: SuggestionRow[] = [];
  let discardedCount = 0;

  for (let i = 0; i < itemsToCategorise.length; i += CATEGORISE_BATCH_SIZE) {
    const chunk = itemsToCategorise.slice(i, i + CATEGORISE_BATCH_SIZE);
    const requestItems: CategoriseRequestItem[] = chunk.map((item, idx) => ({
      index: idx,
      description: item.description,
      amountCents: item.amountCents,
      postedOn: item.postedOn,
      isPrivate: item.isPrivate,
    }));

    const prompt = buildCategorisationRequest({
      items: requestItems,
      categories: categoryOptions,
      fewShotExamples: fewShotPool,
      isLocal,
      model,
    });

    const response = await provider.generateStructured(prompt);
    const now = formatInstant(ctx.clock.now());

    const hasAnyIndex = response.data.suggestions.some(
      (s) => s.index !== undefined && s.index !== null,
    );

    for (let idx = 0; idx < chunk.length; idx++) {
      const item = chunk[idx]!;
      // Find matching suggestion by index, or fallback to array position only if no suggestions contain index
      const suggestionOutput = hasAnyIndex
        ? response.data.suggestions.find((s) => s.index === idx)
        : response.data.suggestions[idx];

      if (!suggestionOutput) continue;

      // Discard suggestion if category_id does not exist in known categories
      if (!knownCategoryIds.has(suggestionOutput.category_id as Id<"Category">)) {
        discardedCount++;
        continue;
      }

      const taxCategoryId =
        suggestionOutput.tax_category_id &&
        knownTaxCategoryIds.has(suggestionOutput.tax_category_id as Id<"TaxCategory">)
          ? (suggestionOutput.tax_category_id as Id<"TaxCategory">)
          : null;

      const activityId =
        suggestionOutput.activity_id &&
        knownActivityIds.has(suggestionOutput.activity_id as Id<"Activity">)
          ? (suggestionOutput.activity_id as Id<"Activity">)
          : null;

      const suggestionRow: SuggestionRow = {
        id: ctx.newId<"Suggestion">(),
        accountId: item.accountId as Id<"Account">,
        transactionId: item.transactionId as Id<"Transaction">,
        splitId: item.splitId as Id<"Split">,
        source: "llm",
        field: "category",
        suggestedValue: suggestionOutput.category_id,
        payeeName: suggestionOutput.payee_name ?? null,
        // Stored NORMALISED: bare public host or null (never scheme/www/path,
        // never an IP literal or private host).
        websiteDomain: normaliseDomain(suggestionOutput.website_domain),
        taxCategoryId,
        activityId,
        confidence: suggestionOutput.confidence,
        model: response.model ?? model,
        promptVersion: CATEGORISE_PROMPT_VERSION,
        outcome: "open",
        createdAt: now,
        resolvedAt: null,
      };

      allValidSuggestions.push(suggestionRow);
    }
  }

  // 4. Record valid suggestions in short write transaction
  if (allValidSuggestions.length > 0) {
    write(ctx, (tx, audit) => {
      const now = formatInstant(ctx.clock.now());
      for (const s of allValidSuggestions) {
        // Resolve any existing open suggestion for this split and field as superseded
        tx.suggestions.resolveOpen(s.splitId, s.field, "superseded", now);
        tx.suggestions.insert(s);
        audit({
          entity: "suggestion",
          entityId: s.id,
          accountId: s.accountId,
          action: "create",
          before: null,
          after: s,
        });
      }
    });
  }

  return {
    suggestions: allValidSuggestions,
    recordedCount: allValidSuggestions.length,
    discardedCount,
  };
}
