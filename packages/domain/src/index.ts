export {
  type FuzzyMatchOptions,
  matchFuzzyPayee,
  matchPayeeAlias,
  type PayeeAliasCandidate,
  type PayeeCandidate,
} from "./classify/payee-matching.ts";
export {
  evaluateRules,
  matchesRuleConditions,
  type RuleActions,
  type RuleCandidate,
  type RuleConditions,
  type TransactionForRules,
} from "./classify/rule-engine.ts";
export {
  computeFingerprint,
  FINGERPRINT_VERSION,
  type FingerprintInput,
  sha256Hex,
} from "./dedupe/fingerprint.ts";
export { normaliseCommBankDescription } from "./normalise/commbank.ts";
