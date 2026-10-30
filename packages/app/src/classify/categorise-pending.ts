// Categorise the transactions that still have unclassified splits (ticket 11).
import { z } from "zod";
import { AppError, parseInput } from "../errors.ts";
import { providerSetting } from "../ports/llm-provider.ts";
import { type CategoriseTransactionsContext, categoriseTransactions } from "./categorise-engine.ts";
import type { LlmUseCaseContext } from "./llm-provider-use-cases.ts";

/**
 * How many transactions one pending run submits at most. The engine batches at
 * CATEGORISE_BATCH_SIZE per LLM call; this caps the whole run so one command
 * stays bounded, and a second run picks up where the first stopped — the
 * transactions it just categorised no longer have an unclassified split.
 */
export const CATEGORISE_PENDING_LIMIT = 200;

const categorisePendingInput = z.object({
  /** Cap on transactions submitted by this run. */
  limit: z.number().int().min(1).max(1000).optional(),
  /** Clock injection for tests; defaults to `ctx.clock.today()` like every sibling. */
  today: z.string().optional(),
});

export type CategorisePendingInput = z.input<typeof categorisePendingInput>;

export interface CategorisePendingResult {
  /** Transactions submitted to the provider. */
  readonly candidates: number;
  readonly recordedCount: number;
  readonly discardedCount: number;
}

/**
 * A run over the whole ledger: the admin `categorise` command passes
 * `systemViewer`, the same viewer the daily jobs use, so every account's
 * unclassified splits are candidates. AD-6 is honoured in the selection: when
 * the configured provider is not local, private-account rows are skipped, so a
 * deployed household's cloud run categorises its shared rows instead of
 * refusing. The engine's own guard stays for callers that pass ids directly.
 */
export interface CategorisePendingContext
  extends CategoriseTransactionsContext,
    LlmUseCaseContext {}

/**
 * Find the open transactions whose splits still need a category — newest
 * first, capped at `limit` — and hand exactly those ids to the categorisation
 * engine. Selection lives here so the engine keeps its "categorise exactly
 * these ids" contract and the CLI stays a printer.
 *
 * The provider is resolved first, because selection depends on it: with a
 * provider that is not local, private-account candidates are skipped rather
 * than submitted (AD-6) — a household's cloud run is not held hostage by one
 * private row, and one run never sends a private row to a cloud provider.
 *
 * Like the engine's own ordering, an empty candidate list answers before the
 * provider is consulted: a run with nothing to do exits cleanly even when no
 * provider is configured. With candidates and no provider configured, the
 * engine raises "No LLM provider configured for categorisation".
 */
export async function categorisePendingTransactions(
  ctx: CategorisePendingContext,
  input: CategorisePendingInput = {},
): Promise<CategorisePendingResult> {
  parseInput(categorisePendingInput, input);
  const limit = input.limit ?? CATEGORISE_PENDING_LIMIT;
  const today = input.today ?? ctx.clock.today().toString();

  const { context, configured, local } = resolveConfiguredProvider(ctx);
  const skipPrivate = configured && !local;

  const candidates = ctx.uow.read((repos) => {
    const privateAccountIds = skipPrivate
      ? new Set(
          repos.accounts
            .list(ctx.viewer)
            .filter((account) => account.isPrivate)
            .map((account) => account.id),
        )
      : undefined;
    return repos.transactions
      .listVisible(ctx.viewer, today)
      .filter(
        (txn) =>
          txn.descriptionRaw !== null &&
          txn.splits.some((split) => split.categoryId === null) &&
          !privateAccountIds?.has(txn.accountId),
      )
      .slice(0, limit)
      .map((txn) => txn.id);
  });

  if (candidates.length === 0) {
    return { candidates: 0, recordedCount: 0, discardedCount: 0 };
  }

  const result = await categoriseTransactions(context, { transactionIds: candidates });

  return {
    candidates: candidates.length,
    recordedCount: result.recordedCount,
    discardedCount: result.discardedCount,
  };
}

interface ResolvedCategoriseProvider {
  /** The context to hand the engine — with the DB-configured adapter when there is one. */
  readonly context: CategoriseTransactionsContext;
  /** Whether a provider is resolved at all: explicit, `resolveProvider`, or the DB row. */
  readonly configured: boolean;
  /** Whether that provider is local, resolved exactly as the engine's guard will see it. */
  readonly local: boolean;
}

/**
 * Resolve the DB-configured categorise provider — purpose row → API key
 * decryption → adapter — the same way the PDF import and the provider test do
 * it, and hand the engine a ready `provider`. A caller that already passes a
 * provider or a `resolveProvider` is left untouched; with no purpose row the
 * context stays as it is, so the engine itself refuses with its own message.
 * Reports locality with the same precedence the engine uses (`providerSetting`),
 * so the pending run's selection can skip private rows before submitting any.
 */
function resolveConfiguredProvider(ctx: CategorisePendingContext): ResolvedCategoriseProvider {
  const providerRow = ctx.uow.read((repos) => repos.llmProviders.findForPurpose("categorise"));

  if (ctx.provider || ctx.resolveProvider || !ctx.createProvider) {
    const local = ctx.provider
      ? providerSetting(ctx.providerIsLocal, providerRow?.isLocal, false)
      : (providerRow?.isLocal ?? false);
    return {
      context: ctx,
      configured: Boolean(ctx.provider ?? (ctx.resolveProvider && providerRow)),
      local,
    };
  }

  if (!providerRow) return { context: ctx, configured: false, local: false };

  let apiKey: string | undefined;
  if (providerRow.apiKeyCiphertext) {
    if (!ctx.decryptApiKey || !ctx.authSecret) {
      throw new AppError("Validation", "Cannot decrypt API key");
    }
    try {
      apiKey = ctx.decryptApiKey(providerRow.apiKeyCiphertext, ctx.authSecret);
    } catch (err) {
      throw new AppError("Validation", "Cannot decrypt API key", { cause: err });
    }
  }
  const local = providerSetting(ctx.providerIsLocal, providerRow.isLocal, false);
  return {
    context: {
      ...ctx,
      provider: ctx.createProvider(providerRow, apiKey),
      providerIsLocal: local,
      providerModel: providerSetting(ctx.providerModel, providerRow.model, undefined),
    },
    configured: true,
    local,
  };
}
