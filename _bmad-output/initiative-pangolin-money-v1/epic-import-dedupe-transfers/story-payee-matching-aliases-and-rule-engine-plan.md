---
title: 'Payee matching, aliases, and rule engine'
type: 'feature'
ticket: 4
created: '2026-10-20'
baseline_revision: 'd8fb8ad96e8dbdc3e982d7a4e844c74df2c748c4'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran:
  - blind-hunter
  - edge-case-hunter
  - verification-gap
  - intent-alignment
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/categorisation.md'
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Imported transactions currently enter the ledger with null payees, null categories, and no automatic classification. Users must manually categorize every transaction, and corrections do not learn or offer reusable rules.

**Approach:** Implement payee alias matching (`payee_alias`) and fuzzy matching against known payees in `packages/domain`; build a deterministic rule engine with schema and migration 0016 for `rule`; integrate the classification cascade (matching rule -> payee default category fallback -> unclassified review item); and wire rule offers when users correct categories on splits.

## Boundaries & Constraints

**Always:**
- Keep the `rule` table `STRICT` with `foreign_keys = ON` in migration 0016.
- Enforce AD-18 privacy scope on `rule`: `scope_person_id` and `origin_account_id`. Owner-scoped rules auto-apply only to that owner's private accounts; shared rules apply to all accounts.
- Enforce classification precedence: `user` > `rule` > `payee` > `activity` > `llm` (AD-10). Rules never overwrite user-set categories.
- Evaluate deterministic rules in ascending `priority` order (lower number = higher precedence). The first matching rule applies.
- Match payee aliases first (`exact`, `prefix`, `contains`, `regex`), then fuzzy-match against known payees in the account's visibility scope.
- Derive `transaction.needs_review` through review items: unclassified splits raise `classify.unclassified` on `transaction:<id>`.
- When a user corrects or sets a category on a split, resolve open `classify.unclassified` items and raise a `classify.rule_offer` review item for the transaction.
- Keep `packages/domain` pure: no I/O, no database imports, no Node built-ins.

**Never:**
- Do not call LLM providers for categorisation or payee domain/logo extraction in this ticket (deferred to epic 5).
- Do not implement transfer matching or auto-linking in this ticket (deferred to entry 3.5).
- Do not alter existing migrations 0000–0015.
- Do not leak private rules or aliases across account boundaries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Alias exact match | Raw description contains "WOOLWORTHS 1234", alias exact/prefix exists for Woolworths | Transaction assigned Woolworths `payeeId`; payee default category applied if no rule matches | No error |
| Regex alias match | Description matches regex pattern `^UBER\s*\*\s*TRIP` | Matched to Uber `payeeId` | Invalid regex in alias creation caught by validation; matching failure skips alias |
| Fuzzy payee match | Description "COLES SUPERMARKET EXPRESS", no alias, known payee "Coles" exists | Fuzzy match links to "Coles" `payeeId` | Low similarity scores below threshold do not match |
| Rule priority order | Two rules match description: Rule A (priority 10, Groceries) and Rule B (priority 20, Snacks) | Rule A applies; split category set to Groceries with `categorySource: "rule"` | Deterministic first-match |
| Payee default fallback | No rule matches, transaction matched to payee with `defaultCategoryId: "cat-fuel"` | Split category set to "cat-fuel" with `categorySource: "payee"` | No error |
| Unclassified split | No rule and no payee default match | Split category remains null; `classify.unclassified` review item raised; `transaction.needs_review` becomes true | Item raised cleanly |
| User category correction | User sets category on split via `setSplitField` | Category updated (`source: "user"`); unclassified review item resolved; `classify.rule_offer` raised | No error |
| Accept rule offer | User confirms "Always do this for Woolworths?" | New rule created with origin `correction`; `classify.rule_offer` item resolved | Rejects with `Conflict` if rule name exists in scope |
| Owner-scoped rule isolation | User A has private rule for "CLINIC"; User B imports into shared account | User A's private rule does NOT fire on shared account row | Scope isolated per AD-18 |

</frozen-after-approval>

## Code Map

- `packages/domain/src/classify/payee-matching.ts` -- pure functions for matching payee aliases (`matchPayeeAlias`) and fuzzy matching against payee names (`matchFuzzyPayee`).
- `packages/domain/src/classify/rule-engine.ts` -- pure types and functions for evaluating deterministic rules (`matchesRuleConditions`, `evaluateRules`).
- `packages/domain/src/index.ts` -- re-export classification and rule engine functions and types.
- `packages/db/src/schema/rule.ts` -- schema definition for `rule` table (STRICT, priority, conditions JSON, actions JSON, origin check, AD-18 scope).
- `packages/db/src/schema/index.ts` -- export `rule` schema.
- `packages/db/migrations/0016_rule_schema.sql` -- migration creating `rule` table, scope indexes, and priority index.
- `packages/app/src/ports/unit-of-work.ts` -- define `RuleRow`, `RuleRepo`, and register in `TxRepos` and `ReadRepos`.
- `packages/db/src/classify-repos.ts` -- implement `createRuleRepo` with AD-18 `visibleScope` filtering and CRUD operations.
- `packages/db/src/unit-of-work.ts` -- wire `createRuleRepo` into `UnitOfWork`.
- `packages/app/src/testing/memory-uow.ts` -- in-memory repository implementation for `RuleRepo`.
- `packages/app/src/classify/classify-transaction.ts` -- classification pipeline applying payee alias matching, fuzzy matching, rule execution in priority order, payee default fallback, and unclassified review item staging.
- `packages/app/src/classify/rules.ts` -- review kind definitions (`CLASSIFY_UNCLASSIFIED_REVIEW`, `CLASSIFY_RULE_OFFER_REVIEW`), rule CRUD use cases, `generateRuleFromCorrection`, `acceptRuleOffer`, and `dismissRuleOffer`.
- `packages/app/src/imports/import-statement.ts` -- integrate transaction classification into the import pipeline.
- `packages/app/src/imports/set-aside.ts` -- integrate transaction classification into `fixSetAsideRow`.
- `packages/app/src/ledger/set-split-field.ts` -- resolve unclassified review items and trigger `classify.rule_offer` on user category correction.
- `packages/app/src/index.ts` -- export rule use cases, review kinds, and classification helpers.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/classify/payee-matching.ts` -- implement alias matching (exact, prefix, contains, regex) and fuzzy payee matching -- pure domain matching.
- [x] `packages/domain/src/classify/rule-engine.ts` -- implement rule condition evaluation and priority-ordered rule execution -- pure domain rule engine.
- [x] `packages/domain/src/index.ts` -- re-export payee matching and rule engine symbols -- expose to app and consumers.
- [x] `packages/domain/src/classify/classify.test.ts` -- unit tests for alias matching, regex safety, fuzzy payee matching, and rule priority evaluation -- domain test suite.
- [x] `packages/db/src/schema/rule.ts` -- define Drizzle schema for `rule` table with AD-18 scope columns and unique indexes -- database model.
- [x] `packages/db/src/schema/index.ts` -- export `rule` table -- schema registration.
- [x] `packages/db/migrations/0016_rule_schema.sql` -- migration 0016 creating `rule` table and indexes -- Drizzle migration.
- [x] `packages/app/src/ports/unit-of-work.ts` -- add `RuleRow`, `RuleRepo`, and repo registration to UoW -- application port contracts.
- [x] `packages/db/src/classify-repos.ts` -- implement SQLite `RuleRepo` with viewer visibility and scope enforcement -- database repository.
- [x] `packages/db/src/unit-of-work.ts` -- wire `createRuleRepo` into UnitOfWork -- repository wiring.
- [x] `packages/app/src/testing/memory-uow.ts` -- implement in-memory `RuleRepo` -- test parity.
- [x] `packages/app/src/classify/rules.ts` -- implement review kinds, rule CRUD use cases, `generateRuleFromCorrection`, `acceptRuleOffer`, `dismissRuleOffer` -- classification use cases.
- [x] `packages/app/src/classify/classify-transaction.ts` -- build transaction classification pipeline orchestration -- single classification entry point.
- [x] `packages/app/src/imports/import-statement.ts` -- call classification pipeline during statement import -- link imported transactions to payees, rules, and defaults.
- [x] `packages/app/src/imports/set-aside.ts` -- call classification pipeline when committing fixed set-aside rows -- consistency for fixed rows.
- [x] `packages/app/src/ledger/set-split-field.ts` -- resolve unclassified review item and trigger `classify.rule_offer` on user category assignment -- review and rule offer workflow.
- [x] `packages/app/src/index.ts` -- re-export classification use cases and review kinds -- public app API.
- [x] `packages/app/src/classify/rules.test.ts` -- integration tests for rule CRUD, rule offer generation, acceptance, dismissal, and scope isolation -- use case test suite.
- [x] `packages/app/src/imports/import-statement.test.ts` -- integration tests for import categorisation cascade and unclassified review items -- import verification.

**Acceptance Criteria:**
- Given an imported transaction matching a payee alias pattern, when statement is imported, then `payeeId` is set on the transaction.
- Given an imported transaction and multiple matching rules, when statement is imported, then the rule with the lowest priority number applies its category with `categorySource: "rule"`.
- Given an imported transaction with a matched payee that has a `defaultCategoryId` and no matching rule, when imported, then the split category is set to the default with `categorySource: "payee"`.
- Given an imported transaction where neither rules nor payee defaults match, when imported, then the split category is null, a `classify.unclassified` review item is raised, and `transaction.needs_review` is true.
- Given an unclassified transaction split, when a user sets its category via `setSplitField`, then the unclassified review item is resolved and a `classify.rule_offer` review item is raised.
- Given an open `classify.rule_offer` review item, when `acceptRuleOffer` is called, then a new `rule` is created and the review item is resolved.
- Given a private rule owned by Person A, when Person B imports transactions into a shared account, then Person A's rule is never applied.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `packages/app/src/accounts/leave-household.ts:170` -- verdict: medium -- route: patch -- `deleteScopedRows` omits `tx.rules.deleteScopedTo(leaver)`, leaving orphaned private rules on household departure.
- `packages/domain/src/classify/rule-engine.ts:2577` -- verdict: medium -- route: patch -- `evaluateRules` sort tiebreaker comparator violates reflexivity by returning 1 instead of 0 when `a.id === b.id`.
- `packages/app/src/testing/repo-parity.test.ts:1` -- verdict: medium -- route: patch -- Zero tests verify `RuleRepo` against SQLite database in parity test suite.
- `packages/app/src/imports/set-aside.test.ts:300` -- verdict: medium -- route: patch -- `fixSetAsideRow` tests lack assertions for transaction classification and review item raising.
- `packages/app/src/classify/rules.ts:236` -- verdict: low -- route: patch -- `generateRuleFromCorrection` does not guard against null `descriptionRaw` on name-hidden transactions.
- `packages/app/src/classify/rules.ts:280` -- verdict: low -- route: patch -- Fallback rule name in `acceptRuleOffer` is not truncated or validated against `nameInput` length.
- `packages/app/src/classify/classify-transaction.ts:48` -- verdict: low -- route: patch -- `JSON.parse` returning null or non-object in `conditions` or `actions` could cause runtime errors.
- `packages/domain/src/classify/rule-engine.ts:2525` -- verdict: low -- route: patch -- Prefix condition matching does not trim leading whitespace from descriptions.
- `packages/app/src/classify/rules.ts:645` -- verdict: low -- route: patch -- Missing regex pattern validation in `ruleConditionsSchema` when `matchKind === "regex"`.
- `packages/app/src/classify/rules.ts:657` -- verdict: low -- route: patch -- `ruleActionsSchema` allows empty action object without any action specified.
- `packages/app/src/classify/rules.ts:650` -- verdict: low -- route: patch -- `ruleConditionsSchema` does not validate that `minAmountCents <= maxAmountCents`.
- `packages/app/src/classify/rules.ts:678` -- verdict: low -- route: patch -- `createRule` and `updateRule` do not validate existence of `conditions.payeeId` or `conditions.accountId`.
- `packages/domain/src/classify/payee-matching.ts:2448` -- verdict: false -- route: false -- Fuzzy payee matcher already ranks token similarity and matches specific names appropriately.
- `packages/app/src/ledger/set-split-field.ts:185` -- verdict: false -- route: false -- Clearing a category with null is an explicit user action per AD-10 and intentionally prevents rules from refilling it.
- `packages/app/src/classify/rules.ts:836` -- verdict: false -- route: false -- Rule proposal using trimmed description or payeeId is the expected behavior.
- `packages/app/src/ledger/set-split-field.ts:187` -- verdict: false -- route: false -- Transactions during import have a single split; multi-split is an explicit manual split workflow.

## Design Notes

Deterministic rule condition schema:
```ts
export interface RuleConditions {
  readonly descriptionPattern?: string;
  readonly descriptionMatchKind?: "exact" | "contains" | "prefix" | "regex";
  readonly payeeId?: string;
  readonly accountId?: string;
  readonly minAmountCents?: number;
  readonly maxAmountCents?: number;
  readonly direction?: "inflow" | "outflow";
}
```

Precedence order during classification:
1. `matchPayeeAlias` / `matchFuzzyPayee` determines `transaction.payeeId`.
2. First matching rule in `priority` order sets split `categoryId`, `categorySource = "rule"`.
3. If split has no category, fallback to `payee.defaultCategoryId`, `categorySource = "payee"`.
4. If still no category, raise `classify.unclassified` review item on `transaction:<id>`.

## Verification

**Commands:**
- `npx vitest run packages/domain/src/classify` -- expected: all domain alias, fuzzy, and rule matching tests pass.
- `npx vitest run packages/app/src/classify` -- expected: all rule use cases, rule offer lifecycle, and scope isolation tests pass.
- `npx vitest run packages/app/src/imports` -- expected: all import categorisation cascade and unclassified review item tests pass.
- `npx vitest run packages/db/src/strict-check.test.ts` -- expected: migration 0016 rule table passes STRICT checks.
- `node scripts/check-boundaries.ts` -- expected: 0 boundary violations.
- `pnpm biome check` -- expected: 0 lint or formatting errors.
