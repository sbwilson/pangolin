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
export {
  FLOW_KINDS,
  type FlowAccountType,
  type FlowGroupKind,
  type FlowKind,
  type FlowKindInput,
  flowKind,
} from "./flows/flow-kind.ts";
export { normaliseCommBankDescription } from "./normalise/commbank.ts";
export {
  type ReconcileResult,
  type ReconcileRow,
  type ReconcileStatus,
  reconcileStatement,
} from "./reconcile/reconcile-statement.ts";
export {
  type DuplicateSubject,
  daysApart,
  findTransferMatch,
  isProbableDuplicate,
  shiftDay,
  TRANSFER_WINDOW_DAYS,
  type TransferLeg,
  type TransferMatchResult,
  transferCandidates,
} from "./transfers/match-transfers.ts";
