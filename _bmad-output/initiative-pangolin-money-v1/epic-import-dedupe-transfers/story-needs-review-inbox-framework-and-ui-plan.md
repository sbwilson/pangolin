---
title: 'Needs Review inbox framework and UI'
type: 'feature'
ticket: 8
created: '2026-10-21'
baseline_revision: 'db50e8e24994bd22ef5e263b71a8d80de7d3eead'
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

**Problem:** Review items pile up with no way to see or act on them: there is no review route, the nav's "Needs review" entries are inert, there is no partner-pending count, and identity notices still live on a separate banner and API.

**Approach:** Add a typed review API (list with per-kind detail, counts, partner-pending, resolve actions) and a `/review` page of cards for every registered kind, a live nav badge, and move the two identity notices onto the page as ordinary review kinds, all inside the privacy suite.

## Boundaries & Constraints

**Always:**
- Every response is built from `reviewItems.listOpenFor(viewer)` and `redact` (AD-3/AD-4); a card never carries data from an account the viewer cannot see.
- Partner-pending = open items visible to both partners (account-scoped on a non-private account, or household), never person-scoped or private-account items; hidden at zero; the count is a number only, never contents. Same value for either partner.
- Each action calls the existing use case: `acceptRuleOffer`/`dismissRuleOffer`, `keepProbableDuplicate`/`removeProbableDuplicate`, `dismissTransferAmbiguity`/`createTransferGroup` (the viewer picks a candidate), `acceptHandoff`/`dismissHandoff`, `fixSetAsideRow`/`discardSetAsideRow`, `dismissNotice`, `revokeMyReEnrolmentLinks`. An item resolves only through its entity changing or its use case; unknown or finished items are `NotFound`/`Conflict`.
- Kinds with no action use case (closing-balance, system.*, job.dead) render as read-only cards. A new route needs a `route-manifest.ts` entry and joins the paired-world privacy scenarios.
- Reuse `rounded-lg border border-border bg-card p-3` card styling, TanStack Query keys, and the Hono typed client.

**Never:**
- No Transactions chip or "N need review" link wiring, no AI suggestions or bulk-accept, no toast component, no undo-from-review, no new review kinds, no schema migration.
- No decrypted attachment content or batch/account detail beyond what the viewer may see; the sender never sees hand-off recipient account.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | Mixed open items across kinds | One card per item, oldest first, header "N things need you" | n/a |
| Resolve | Click "Keep both" on a duplicate | Item gone, `needsReview` cleared, list refetched | `NotFound` if already resolved |
| Private item | A's private-account item, viewer B | Absent from B's list, count and partner chip | n/a |
| Partner chip | Shared-visible open items = 3 | "<partner>: 3 left"; A's private/person items do not change it | n/a |
| Zero | No items | "Nothing needs you. Nice."; nav shows a check | n/a |
| Hand-off | Recipient picks an account, Import | Batch imported, item resolved | `NotFound` for a non-recipient |
| Notice | Partner-reset notice | "Got it" dismisses; "Revoke the link" revokes; banner and old API gone | n/a |
| Unknown kind | A kind with no card | Generic read-only card | n/a |

</frozen-after-approval>

## Code Map

- `packages/app/src/system/review-items.ts` -- `listReviewItems` (reuse), add a `countReviewItems`/partner-pending use case; export a kind-to-module list if needed.
- `packages/app/src/ports/unit-of-work.ts`, `packages/db/src/review-item-repo.ts`, `packages/app/src/testing/memory-uow.ts` -- `countSharedVisibleOpen(viewer)` built from a public-account predicate (`privacy.ts`); `ReadRepos` pick; `tx-repos-viewer.test.ts` allow-list.
- `packages/app/src/system/review-view.ts` -- new: per-kind detail projection (transaction description/amount, hand-off file name and status, set-aside rows via `listSetAsideRowsForBatch`, transfer candidates via `listTransferCandidates`) through `redact`.
- `packages/app/src/identity/notices.ts` -- `listNotices` becomes the review projection for `identity.partner-reset` and `identity.recovery-code-used`; remove the notices routes after the move.
- `apps/server/src/http/app.ts`, `apps/server/src/privacy/route-manifest.ts`, `privacy-harness.ts`, `privacy-scenarios.ts`, `privacy.test.ts` -- `/api/review` routes (list, count, one POST per action); the privacy suite compares B's list and count across worlds; supply the attachment store to hand-off routes (`apps/server/src/attachments/file-store.ts`, `config.ts`, `auth/secret.ts`) and to `leaveHousehold`.
- `apps/web/src/routes/review.tsx`, `router.tsx`, `pages/ReviewPage.tsx`, `components/review/*Card.tsx`, `api.ts` -- the page, one card component per kind, mutations invalidating the review keys.
- `apps/web/src/components/AppSidebar.tsx`, `MobileNav.tsx` -- live links to `/review` with a count badge (a check at zero); `RootLayout.tsx` -- drop `Notices`; delete `components/Notices.tsx` and its tests.
- `e2e/review.spec.ts`, `e2e/axe.spec.ts` -- clear an item on the seeded ledger; axe on `/review`.
- Don't change: use-case internals above, `ledger/needs-review.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] Repo count, review-view projection, count/list use cases, parity and viewer tests.
- [ ] `/api/review` routes, manifest entries, attachment-store wiring, privacy scenarios.
- [ ] Notices moved onto review kinds; old banner, route and API removed.
- [ ] `ReviewPage`, cards per kind, nav badge and links, component tests (every kind renders; actions call the API).
- [ ] e2e clear-an-item and axe.

**Acceptance Criteria:**
- Given every registered kind has an open item, when `/review` loads, then each renders its card with its actions.
- Given A's private or person-scoped items, when B loads the page, count or chip, then they are absent and unchanged.
- Given an action succeeds, when the page refetches, then the item is gone and the nav count drops.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- `accept-rule` has no success-path test and the button posts no body (blind, gap) -- verdict: medium -- route: patch -- add a case that accepts an offer (rule row exists, item resolved) and a body-less HTTP POST returning 204.
- `revokeLinksItem` never proves links are revoked (gap) -- verdict: medium -- route: patch -- add a case with a real issued re-enrolment link: `{revoked: 1}` and the link no longer redeems.
- Badge, partner chip and heading never refresh without focus (blind, edge) -- verdict: low -- route: patch -- EXPERIENCE.md asks for a refresh on focus and every minute; add `refetchInterval: 60_000` to the counts query.
- Live-mode attachment store in `server.ts` untested (gap) -- verdict: medium -- route: defer -- needs a non-demo `startServer` hand-off fixture; wiring reads straightforwardly.
- e2e clear-an-item depends on `recovery.spec` leaving a notice, then skips (blind, gap) -- verdict: medium -- route: defer -- the seeded ledger raises no items and no route creates one; needs a seeded review-item fixture.
- Security notices less prominent than the banner (blind, edge) -- verdict: false -- the plan moves notices onto `/review`; the UX spec places them there.
- Orphaned `["identity","notices"]` invalidations (edge) -- verdict: false -- grep finds none; `AccountSettings` invalidates `["review"]`.
- `reviewAction` bypasses the typed client, N+1 list reads, unbounded list, per-click `listOpenFor` scan, a11y name/focus, missing confirm on remove, dead `listNotices` projection (blind, edge) -- verdict: low -- route: reject -- household-scale data, projection still used by the review view, soft-delete is recoverable, fixes add complexity.
- Empty set-aside rows, closed-account hand-off options, stale transfer choice, gone-transaction buttons, >2 persons, soft-deleted account parity, unredacted display names (edge, gap) -- verdict: false/low -- route: reject -- unreachable (an invisible batch's item is not listed), or display names are household-visible.

## Design Notes

Transfer ambiguity cannot link without a partner: the card lists the unlinked opposite-amount candidates within three days (the same repo query) and "Yes, it's a transfer" links the chosen one. The partner chip is a number from `countSharedVisibleOpen`, computed in SQL so it cannot be built from the partner's viewer.

## Verification

**Commands:**
- `npx vitest run packages apps/server apps/web` -- expected: all pass.
- `pnpm typecheck` -- expected: no errors.
- `pnpm lint` -- expected: clean.
- `pnpm test:e2e -- review` and `pnpm test:axe` -- expected: pass (needs the Playwright setup).
