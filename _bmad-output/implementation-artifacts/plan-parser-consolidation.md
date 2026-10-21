---
title: 'Consolidate the statement parsers into one copy'
type: 'refactor'
ticket: ''
created: '2026-10-22'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-pangolin-money-v1/epic-import-dedupe-transfers/epic-import-dedupe-transfers-retrospective.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The seven statement parsers exist twice: `packages/app/src/imports/parsers/` (about 690 lines, what production runs) and `packages/importers/src/parsers/` (about 1,190 lines, used only by tests). A fix to one leaves the other stale, and the tests exercise the copy production never runs (retro finding A1).

**Approach:** Keep the app copy as the only implementation. Delete the importers parsers and their exports, keep that package's mock-statement generators and fixtures, and port its parser tests to run against the app parsers so no case is lost.

## Boundaries & Constraints

**Always:**
- No behaviour change to the app parsers or `importStatement`. Where a ported test disagrees with the app parser, the app parser is the truth: adapt the expectation and note it in Implementation Notes (never edit a parser to satisfy an old test).
- Every test case in `packages/importers/src/importers.test.ts` is either ported to run against the app parsers or listed in Implementation Notes with the reason it no longer applies (for example it asserted an `accountId` or `closingBalanceCents` that only the importers OFX result carried).
- The app parsers are exposed from `@pangolin/app` (`parseBuiltin*` functions) so the importers package's tests can call them; the package boundary rules stay unchanged (`importers` may import `app`).
- `packages/importers` keeps `generators/mock-statements.ts`, `fixtures/`, its `index.ts` exports for the generators, and `apps/server/src/cli.test.ts` keeps working.

**Never:**
- No change to dedupe, reconcile, review kinds or any ticketed behaviour; no new boundary exceptions; no deletion of fixtures or generators; no removal of the optional `options.parser` injection in `importStatement` (it is a separate decision).

## Design Notes

The importers parsers returned objects such as `{ rows, accountId, closingBalanceCents }` and exposed port adapters (`commbankCsvParser`, `qifParser`, `createGenericCsvParser`); the app parsers return `StatementParseResult { rows, setAside }`. Ported tests assert rows and set-aside reasons through that shape, or drive `importStatement` end to end, using the generators and fixtures.

## Code Map

- `packages/importers/src/parsers/*` (7 files), `packages/importers/src/index.ts` -- delete the parsers and their exports; keep the generator exports.
- `packages/importers/src/importers.test.ts` -- becomes the ported parser tests (rename if useful: `statement-parsing.test.ts`), importing the app parsers from `@pangolin/app`.
- `packages/app/src/imports/parsers/*`, `packages/app/src/index.ts` -- export the `parseBuiltin*` functions.
- `packages/importers/package.json` (description), `apps/server/src/cli.test.ts`, `scripts/check-boundaries.ts` -- confirm nothing else imports the removed exports.

## Tasks & Acceptance

**Execution:**
- [ ] Export the app parsers from `@pangolin/app`.
- [ ] Port `importers.test.ts` to run against them; record dropped or adapted cases in Implementation Notes.
- [ ] Delete `packages/importers/src/parsers/` and its exports; fix the package description.
- [ ] Run the whole suite, typecheck, lint (boundaries) and `check:strict`.

**Acceptance Criteria:**
- Given the change, when the suite runs, then every parser behaviour previously asserted against the importers copy is asserted against the app copy or recorded as not applicable, and the suite passes.
- Given the change, when `grep -r "packages/importers/src/parsers"` and `commbankCsvParser` are searched, then nothing outside history refers to the deleted code.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run` -- expected: all pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm check:strict` -- expected: clean.
