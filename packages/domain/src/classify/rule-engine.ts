export interface RuleConditions {
  readonly descriptionPattern?: string;
  readonly descriptionMatchKind?: "exact" | "contains" | "prefix" | "regex";
  readonly payeeId?: string;
  readonly accountId?: string;
  readonly minAmountCents?: number;
  readonly maxAmountCents?: number;
  readonly direction?: "inflow" | "outflow";
}

export interface RuleActions {
  readonly categoryId?: string;
}

export interface RuleCandidate {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly conditions: RuleConditions;
  readonly actions: RuleActions;
  readonly scopePersonId?: string | null;
  readonly originAccountId?: string | null;
}

export interface TransactionForRules {
  readonly accountId: string;
  readonly rawDescription: string;
  readonly amountCents: number;
  readonly payeeId?: string | null;
}

/**
 * Checks if a transaction matches all conditions of a deterministic rule.
 * An omitted condition does not restrict matching (AND logic).
 */
export function matchesRuleConditions(
  transaction: TransactionForRules,
  conditions: RuleConditions,
): boolean {
  if (conditions.descriptionPattern !== undefined) {
    const pattern = conditions.descriptionPattern.toLowerCase();
    const raw = transaction.rawDescription.toLowerCase();
    const matchKind = conditions.descriptionMatchKind ?? "contains";

    switch (matchKind) {
      case "exact": {
        if (raw.trim() !== pattern.trim()) return false;
        break;
      }
      case "prefix": {
        if (!raw.trim().startsWith(pattern.trim())) return false;
        break;
      }
      case "contains": {
        if (!raw.includes(pattern)) return false;
        break;
      }
      case "regex": {
        try {
          const re = new RegExp(conditions.descriptionPattern, "i");
          if (!re.test(transaction.rawDescription)) return false;
        } catch {
          return false;
        }
        break;
      }
    }
  }

  if (conditions.payeeId !== undefined) {
    if (transaction.payeeId !== conditions.payeeId) return false;
  }

  if (conditions.accountId !== undefined) {
    if (transaction.accountId !== conditions.accountId) return false;
  }

  if (conditions.direction !== undefined) {
    if (conditions.direction === "inflow" && transaction.amountCents <= 0) return false;
    if (conditions.direction === "outflow" && transaction.amountCents >= 0) return false;
  }

  const absAmount = Math.abs(transaction.amountCents);
  if (conditions.minAmountCents !== undefined) {
    if (absAmount < conditions.minAmountCents) return false;
  }

  if (conditions.maxAmountCents !== undefined) {
    if (absAmount > conditions.maxAmountCents) return false;
  }

  return true;
}

/**
 * Evaluates rules in ascending priority order (lower number = higher precedence).
 * Deterministically breaks ties using rule id.
 * Returns the first matching rule, or null.
 */
export function evaluateRules(
  transaction: TransactionForRules,
  rules: readonly RuleCandidate[],
): RuleCandidate | null {
  const sorted = [...rules].sort(
    (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  for (const r of sorted) {
    if (matchesRuleConditions(transaction, r.conditions)) {
      return r;
    }
  }

  return null;
}
