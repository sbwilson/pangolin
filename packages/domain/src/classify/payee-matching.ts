export interface PayeeAliasCandidate {
  readonly id: string;
  readonly payeeId: string;
  readonly pattern: string;
  readonly matchKind: "exact" | "contains" | "prefix" | "regex";
}

export interface PayeeCandidate {
  readonly id: string;
  readonly name: string;
}

export interface FuzzyMatchOptions {
  readonly threshold?: number;
}

/**
 * Matches a transaction description against payee aliases.
 * Aliases are checked in order. Returns the matched payeeId or null.
 */
export function matchPayeeAlias(
  description: string,
  aliases: readonly PayeeAliasCandidate[],
): string | null {
  const desc = description.trim().toLowerCase();
  for (const alias of aliases) {
    const pattern = alias.pattern.trim().toLowerCase();
    switch (alias.matchKind) {
      case "exact": {
        if (desc === pattern) return alias.payeeId;
        break;
      }
      case "prefix": {
        if (desc.startsWith(pattern)) return alias.payeeId;
        break;
      }
      case "contains": {
        if (desc.includes(pattern)) return alias.payeeId;
        break;
      }
      case "regex": {
        try {
          const re = new RegExp(alias.pattern, "i");
          if (re.test(description)) return alias.payeeId;
        } catch {
          // Invalid regex in alias creation caught by validation; matching failure skips alias
        }
        break;
      }
    }
  }
  return null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 0; i < a.length; i++) {
    curr[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      const left = (curr[j] ?? 0) + 1;
      const up = (prev[j + 1] ?? 0) + 1;
      const diag = (prev[j] ?? 0) + cost;
      curr[j + 1] = Math.min(left, up, diag);
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }
  return prev[b.length] ?? 0;
}

function wordSimilarity(w1: string, w2: string): number {
  if (w1 === w2) return 1;
  const maxLen = Math.max(w1.length, w2.length);
  if (maxLen === 0) return 1;
  // If words are short, require exact match
  if (w1.length < 3 || w2.length < 3) return 0;
  const dist = levenshtein(w1, w2);
  return Math.max(0, 1 - dist / maxLen);
}

function computePayeeSimilarity(descTokens: readonly string[], payeeName: string): number {
  const payeeTokens = tokenize(payeeName);
  if (payeeTokens.length === 0 || descTokens.length === 0) return 0;

  // Check if all payee tokens match tokens in the description
  let totalScore = 0;
  for (const pToken of payeeTokens) {
    let maxWordScore = 0;
    for (const dToken of descTokens) {
      if (pToken === dToken) {
        maxWordScore = 1;
        break;
      }
      const sim = wordSimilarity(pToken, dToken);
      if (sim > maxWordScore) {
        maxWordScore = sim;
      }
    }
    totalScore += maxWordScore;
  }

  return totalScore / payeeTokens.length;
}

const DEFAULT_FUZZY_THRESHOLD = 0.75;

/**
 * Fuzzy matches a transaction description against known payee names.
 * Returns the highest-scoring payeeId meeting the threshold, or null.
 */
export function matchFuzzyPayee(
  description: string,
  payees: readonly PayeeCandidate[],
  options?: FuzzyMatchOptions,
): string | null {
  const threshold = options?.threshold ?? DEFAULT_FUZZY_THRESHOLD;
  const descTokens = tokenize(description);
  if (descTokens.length === 0 || payees.length === 0) return null;

  let bestMatch: { payeeId: string; score: number } | null = null;

  for (const p of payees) {
    const score = computePayeeSimilarity(descTokens, p.name);
    if (score >= threshold) {
      if (bestMatch === null || score > bestMatch.score) {
        bestMatch = { payeeId: p.id, score };
      }
    }
  }

  return bestMatch?.payeeId ?? null;
}
