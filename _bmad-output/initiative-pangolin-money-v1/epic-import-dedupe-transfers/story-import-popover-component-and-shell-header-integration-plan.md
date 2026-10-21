---
title: 'Import popover component and shell header integration'
type: 'feature'
ticket: 9
created: '2026-10-21'
baseline_revision: '391d9e413d4d7f92c8d0bc52586c8e9adcda186b'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/import-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to import a bank file from the app: no import or hand-off HTTP route, no file picker, and no Import button in the shell, so the pipeline built in this epic cannot be used.

**Approach:** Add two JSON routes (import into an account, hand a file to the partner) and an Import popover opened from the shell header, with a drop zone, account picker including "For <partner>", per-bank export tips, a live-region result summary, and a "N need review" link to `/review`.

## Boundaries & Constraints

**Always:**
- The popover accepts `.csv`, `.ofx` and `.qif` text up to 10 MiB. Format is chosen from the extension (`.ofx`, `.qif`) or, for CSV, from a bank select (CommBank, ubank, Up, FY2025 multi-bank). Anything else, including PDF and `.xlsx`, shows "We can't read <ext> files. Try CSV, OFX or QIF."
- The account picker lists only accounts `listAccounts` returns, grouped Yours / Shared, plus "For <partner>" from `Me.partner`; picking "For <partner>" calls `createHandoff` and the sender sees only "Handed to <partner>. It'll wait in her Needs review." Never the partner's accounts.
- The import route runs `importStatement` as the signed-in viewer; an account the viewer cannot see is a `404` like any private-account route. Results show `newCount`, `dupCount`, `setAsideCount`; "N need review" is `needReviewCount` (human decision during review: the import route returns the number of open review items the batch raised: its set-aside item, probable duplicates, ambiguous transfers, unclassified transactions) linking to `/review`, shown whenever it is above zero; zero new rows with only skipped duplicates reads "Nothing new. You've already imported all of this."
- Progress is shown while the request is pending ("Reading file…") and the outcome is announced in an `aria-live` region. Esc closes the popover; the open state lives in a provider in `RootLayout` exposing `openImport({ accountId? })`.
- Both routes get `route-manifest.ts` entries and join the privacy suite.

**Never:**
- No generic-CSV column-mapping UI (a generic CSV is reported as unsupported), no PDF, no "Ask Pangolin to read these", no inline set-aside fixing, no Import button beside the Transactions search, no stale-row Import shortcut, no batch polling endpoint, no new dependency beyond what the popover needs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Import | OFX file, own account picked | Summary "142 new, 3 to review"; Needs review link | Server `Validation` text shown |
| Duplicate file | Same file again | "Nothing new. You've already imported all of this." | n/a |
| Partial | CSV with bad rows | "139 imported · 3 set aside" with a link to Needs review | n/a |
| For partner | "For Carissa" picked | Hand-off created; sender message only | `Validation` if recipient is self |
| Unsupported | `.xlsx` or `.pdf` | Message shown, Import disabled | n/a |
| Too large | 11 MiB file | Rejected client-side and server-side (413/400) | Message shown |
| Hidden account | Route given another person's private account id | `404`, nothing written | n/a |
| Keyboard | Tab/Esc/Enter | Reachable, Esc closes, focus returns to the Import button | n/a |

</frozen-after-approval>

## Code Map

- `apps/server/src/http/app.ts` -- `POST /api/import` (`importStatement`) and `POST /api/handoffs` (`createHandoff` via `withAttachments`) using `objectBody`; add a body-size limit above 10 MiB.
- `apps/server/src/privacy/route-manifest.ts`, `privacy.test.ts` -- entries (hand-off routes at ~l.180 are the model; the account param as an `account` entity) and a paired-world check that B cannot import into A's private account.
- `apps/web/src/api.ts` -- typed `importFile`, `handOffFile`; types for the result.
- `apps/web/src/components/import/ImportPopover.tsx`, `ImportProvider.tsx`, `DropZone.tsx`, `AccountPicker.tsx`, `ExportTips.tsx`, `ImportSummary.tsx`, `lib/import-format.ts` -- the popover (hand-built; no Popover primitive exists, `ReauthDialog.tsx` is the dialog pattern), format inference, tips copy (CommBank from the mockup; other banks are [ASSUMPTION] copy).
- `apps/web/src/RootLayout.tsx`, `components/MobileNav.tsx` -- Import button in the desktop header and a compact one beside the phone title; provider mounted here.
- `apps/web/src/lib/accounts.ts`, `session.tsx` (`Me.partner`) -- reuse for grouping and the partner label.
- Fixtures: `packages/importers/fixtures/*` for tests; e2e helpers in `e2e/helpers/account.ts`.
- Tests: `ImportPopover.test.tsx`, `import-format.test.ts`, server route tests, `e2e/import.spec.ts` (+ axe entry in `e2e/axe.spec.ts`).
- Don't change: `importStatement`, `createHandoff`, `ReviewPage`.

## Tasks & Acceptance

**Execution:**
- [ ] Server routes, size limit, manifest entries, privacy test.
- [ ] `api.ts` client calls and format-inference helper with tests.
- [ ] Popover components, provider, header and phone buttons.
- [ ] Component tests (every matrix row) and `e2e/import.spec.ts`: upload `commbank.ofx` via `setInputFiles`, see the summary, follow "N need review" to `/review`; axe on the open popover.

**Acceptance Criteria:**
- Given a signed-in person, when they drop a supported file and pick an account, then the file imports once, the summary is announced, and re-dropping it reports nothing new.
- Given "For <partner>", when imported, then a hand-off exists and the sender's UI shows no account or batch.
- Given an unsupported or oversized file, when chosen, then Import stays disabled with the reason shown.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- "N need review" counts `dupCount + setAsideCount`, but `dupCount` is skipped exact duplicates that raise no item; link hidden for duplicate-only results (blind, edge) -- verdict: medium -- route: intent_gap -- resolved by the human: the route returns `needReviewCount`, the number of open review items the batch raised; frozen text amended; patched in place.
- JSON body cap leaves 2 MiB headroom, so a quote- or CRLF-heavy file under 10 MiB gets a 413 (blind, gap, edge) -- verdict: medium -- route: patch -- scale the cap to the worst typical escaping and test a quote-heavy file.
- Hard-coded "her" in the hand-off message (blind) -- verdict: medium -- route: patch -- neutral wording ("their"); update tests.
- Closing during a pending import loses the outcome (blind) -- verdict: medium -- route: patch -- ignore Esc, Cancel and backdrop while pending.
- Preselected `accountId` absent from the picker still enables Import; `openImport({ accountId })` untested (blind, edge, gap) -- verdict: medium -- route: patch -- clear a preselected id missing from the loaded accounts; add a test of the preselect.
- Summary text drops `dupCount`/singular forms (blind, edge) -- verdict: low -- route: patch -- folded into the `needReviewCount` change: show the skipped-duplicates figure and singular forms.
- UTF-8-only decoding of Windows-1252/UTF-16 exports (blind) -- verdict: medium -- route: defer -- real but outside the plan; logged.
- Conditional provider remount, focus drop on pending, openImport while open, invalidation inside `try`, multi-file drop, default CommBank tips/format, 1024 KB label, uncovered matrix rows, e2e account clutter, MobileNav note (blind, edge, gap, intent) -- verdict: low -- route: reject -- rare, cosmetic, or the fix edits the plan.

## Design Notes

The import call is synchronous, so "progress" is the pending state plus an announced result, not polling; the spec's stage text ("Checking for duplicates…") is shown as one pending label. A bank select appears only for CSV because OFX and QIF need no mapping; the chosen bank also selects the tips shown.

## Verification

**Commands:**
- `npx vitest run packages apps/server apps/web` -- expected: all pass.
- `pnpm typecheck` -- expected: no errors.
- `pnpm lint` -- expected: clean.
- `pnpm test:e2e -- import` and `pnpm test:axe` -- expected: pass (needs Playwright setup).
