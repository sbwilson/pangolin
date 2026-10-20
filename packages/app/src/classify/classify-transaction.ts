import {
  evaluateRules,
  matchFuzzyPayee,
  matchPayeeAlias,
  type RuleActions,
  type RuleCandidate,
  type RuleConditions,
  type TransactionForRules,
} from "@pangolin/domain";
import type { Id } from "@pangolin/shared";
import { privateOwner } from "../ledger/split-targets.ts";
import type { PayeeAliasRow, PayeeRow, SplitSource, TxRepos } from "../ports/unit-of-work.ts";
import type { Viewer } from "../viewer.ts";

export interface ClassificationContext {
  readonly aliases: readonly PayeeAliasRow[];
  readonly payees: readonly PayeeRow[];
  readonly rules: readonly RuleCandidate[];
}

/**
 * Loads the applicable aliases, payees, and rules for an account under AD-18 privacy scope.
 * Owner-scoped rules, aliases, and payees only apply to that owner's private accounts.
 * Shared accounts see only shared rules, aliases, and payees.
 */
export function loadClassificationContext(
  tx: TxRepos,
  viewer: Viewer,
  accountId: string,
): ClassificationContext {
  const owner = privateOwner(tx, viewer, accountId);
  const allAliases = tx.payeeAliases.list(viewer);
  const allPayees = tx.payees.list(viewer);
  const allRules = tx.rules.list(viewer);

  const aliases = allAliases.filter(
    (a) => a.scopePersonId === null || (owner !== null && a.scopePersonId === owner),
  );
  const payees = allPayees.filter(
    (p) => p.scopePersonId === null || (owner !== null && p.scopePersonId === owner),
  );

  const rules: RuleCandidate[] = allRules
    .filter((r) => r.scopePersonId === null || (owner !== null && r.scopePersonId === owner))
    .map((r) => {
      let conditions: RuleConditions = {};
      let actions: RuleActions = {};
      try {
        const parsed = JSON.parse(r.conditions);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          conditions = parsed as RuleConditions;
        }
      } catch {
        conditions = {};
      }
      try {
        const parsed = JSON.parse(r.actions);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          actions = parsed as RuleActions;
        }
      } catch {
        actions = {};
      }
      return {
        id: r.id,
        name: r.name,
        priority: r.priority,
        conditions,
        actions,
        scopePersonId: r.scopePersonId,
      };
    });

  return { aliases, payees, rules };
}

export interface ClassifyTransactionInput {
  readonly accountId: string;
  readonly rawDescription: string;
  readonly amountCents: number;
}

export interface ClassifyTransactionResult {
  readonly payeeId: Id<"Payee"> | null;
  readonly categoryId: Id<"Category"> | null;
  readonly categorySource: SplitSource | null;
  readonly unclassified: boolean;
}

/**
 * Classifies an incoming transaction through the cascade (AD-10, AD-18):
 * 1. Payee matching: payee_alias (exact, prefix, contains, regex), then fuzzy payee match.
 * 2. Deterministic rule evaluation in ascending priority order.
 * 3. Fallback to payee's defaultCategoryId.
 * 4. If still no category, flagged as unclassified.
 */
export function classifyTransaction(
  input: ClassifyTransactionInput,
  context: ClassificationContext,
): ClassifyTransactionResult {
  // 1. Match payee
  let payeeId = (matchPayeeAlias(input.rawDescription, context.aliases) ??
    null) as Id<"Payee"> | null;
  if (payeeId === null) {
    payeeId = (matchFuzzyPayee(input.rawDescription, context.payees) ?? null) as Id<"Payee"> | null;
  }

  // 2. Evaluate rules
  const txnForRules: TransactionForRules = {
    accountId: input.accountId,
    rawDescription: input.rawDescription,
    amountCents: input.amountCents,
    payeeId,
  };

  const matchingRule = evaluateRules(txnForRules, context.rules);
  if (matchingRule?.actions.categoryId) {
    return {
      payeeId,
      categoryId: matchingRule.actions.categoryId as Id<"Category">,
      categorySource: "rule",
      unclassified: false,
    };
  }

  // 3. Fallback to payee default category
  if (payeeId !== null) {
    const matchedPayee = context.payees.find((p) => p.id === payeeId);
    if (matchedPayee?.defaultCategoryId) {
      return {
        payeeId,
        categoryId: matchedPayee.defaultCategoryId,
        categorySource: "payee",
        unclassified: false,
      };
    }
  }

  // 4. Unclassified
  return {
    payeeId,
    categoryId: null,
    categorySource: null,
    unclassified: true,
  };
}
