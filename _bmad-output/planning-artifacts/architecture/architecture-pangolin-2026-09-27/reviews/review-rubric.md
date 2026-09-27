---
type: architecture-review
target: ../ARCHITECTURE-SPINE.md
lens: good-spine rubric (initiative altitude)
reviewed: '2026-09-27'
inputs:
  - ../ARCHITECTURE-SPINE.md
  - ../.memlog.md
  - ../../../../specs/spec-pangolin-money/SPEC.md (+ all companions)
  - ../../../../initiative-pangolin-money-v1/ (initiative, tickets.toml, 10 epic files)
---

# Rubric review: Architecture Spine for Pangolin Money v1

## Verdict

**Not ready to bind the epics yet. Close to ready.** The spine is strong. It settles all four contracts the initiative asked for (visibility and redaction, jobs, seed modules, periods). It maps all 18 capabilities, and every named version checks out against the registries. The remaining problems are specific:

- Visibility is keyed only on `account_id`, so data scoped to a person has no rule.
- No AD says which viewer a job or a cross-account import step runs as.
- Two ADs contradict each other on backups and outbound calls.
- The disaster-recovery path skips the application encryption key.
- The fingerprint rule does not actually stop duplicates across formats, which is the risk M1 exists to retire.
- Three decisions still conflict with the epic files or the spec, and nothing in the spine records those conflicts.

Severity scale: **High** means two epics will diverge, or a stated guarantee fails. **Medium** means the rule is ambiguous or unenforceable in a way that will cost rework. **Low** means hygiene.

## Summary table

| # | Sev | Where | Finding | Fix (one line) |
| --- | --- | --- | --- | --- |
| 1 | High | AD-3 / AD-7 | Visibility is keyed only on `account_id`. Data scoped to a person has no visibility rule: personal goals and `goal_allocation` (a private savings pool), personal budgets, `pay_anchor`, the tax pack, the WFH log, depreciable assets, `forecast_assumption`, and person-targeted `review_item`s and audit rows. | Add a person-scope rule: rows with `person_id` or `scope = person` are visible only to that person when any source account is private (or always). Put the tax pack under that rule too. |
| 2 | High | AD-6 / AD-3 / AD-8 | No AD says which `Viewer` a job handler, an import commit or a cross-account domain step runs as. Transfer matching against the partner's private account, period close for a personal pool, and LLM categorisation all depend on the answer. | Add a rule: jobs run as `SystemViewer` for reads but write only rows whose visibility is derived (AD-3/AD-18), and HTTP-initiated imports match transfers across all accounts through a named system port. Or decide the opposite, but state it. |
| 3 | High | AD-8 (internal) | "Backups, restore drills ... run in the `local` lane" contradicts "Only handlers in the `net` and `llm` lanes call outbound ports". The nightly backup pushes to TrueNAS over WireGuard, and TrueNAS is on the allowlist. | Move backup to `net` (keep the drill in `local`), or split the backup into a local snapshot job plus a `net` push job. |
| 4 | High | Operations / AD-21 / Config | A disaster-recovery gap. Attachments and LLM keys are encrypted with an application key file held outside the DB. The spine never decides whether that key goes into the restic backup, is escrowed elsewhere, or is rotated. A restore onto a fresh host can then return encrypted data with no key to open it. | Decide where the key lives for DR (for example, in the restic backup or printed at install next to the restic password) and make CI's restore test prove it on a fresh host. |
| 5 | High | AD-20 | The Rule does not prevent the divergence it names. OFX, CSV and PDF for the same account carry different descriptions, and PDFs truncate them. The fingerprint (account + date + amount + normalised description + occurrence) therefore won't match across formats, and the occurrence number shifts when a file covers part of a day. | Define cross-format dedupe explicitly, for example a format-independent key (account, date, amount, occurrence) sent to review as a "probable duplicate", or state that each account has one canonical format. Name the table the unique indexes sit on. |
| 6 | Medium | AD-6 | Few-shot examples are restricted to non-private accounts only for cloud providers. With a local provider, partner A's private transactions can serve as examples for partner B's shared transaction and leak through the suggested `payee_name`. | Move the few-shot restriction out of the cloud bullet: examples come only from accounts visible to every viewer of the target account, whatever the provider. |
| 7 | Medium | AD-11 vs AD-17 / ownership map | The "closed list" of stored derived data is already broken. `review_item` rows for over-commitment or mismatch (CAP-7), `goal.completed_at`, `stage_event`, `transaction.needs_review`, the FTS5 indexes and `import_batch` counts are all stored derived state that isn't on the list. Nothing says when a derived `review_item` resolves itself. | Extend the list and add a rule that condition-based review items are re-evaluated and auto-resolved by the owning module's check. |
| 8 | Medium | AD-13 | "Nothing else rounds money" can't hold. Units × price (super, brokerage), the 50% CGT discount, pace and projection, XIRR and interest all turn decimal results into `Cents` without dividing by weights, and no rounding mode is fixed. | Add `shared.toCents(decimal, mode)` with one named mode (for example half-even) as the only conversion from decimal to cents, and have `allocate()` build on it. |
| 9 | Medium | AD-11 (lots) | `lot` is rebuilt from `investment_event`, but manual parcel selection (CAP-9) isn't said to live on the sell event. A rebuild would then lose it or fall back to FIFO. Lot IDs that are regenerated would also break references from the CGT schedule. | State that a sell event stores its parcel selections by `buy_event_id`, and that lots are keyed by `buy_event_id`, which stays stable across rebuilds. |
| 10 | Medium | Stack / AD-14 | `shared/period` is imported by both server and browser, but the spine says the server uses native Temporal and the browser uses `temporal-polyfill`. It doesn't say how `shared` reaches Temporal (global or ponyfill import). Native and polyfill objects aren't interchangeable. | Rule: `shared` uses one import (for example `temporal-polyfill/global` loaded in both entries, or the ponyfill everywhere). Values cross the wire only as `YYYY-MM-DD` strings. |
| 11 | Medium | AD-14 vs epics | AD-14 gives `shared/period` to epic 1. The budgets-bills epic's Boundaries still say epic 6 "owns the period and payday-anchor helpers", and `tickets.toml` has epic 7 depend on epic 6 for them. AD-10 moves CMC parsing to epic 9, but the import-dedupe-transfers epic (epic 3) still lists CMC confirmations. | Add an "Open questions / pending propagation" section listing the epic and ticket edits these ADs require, or make them before the epics are incepted. |
| 12 | Medium | AD-3 vs spec CAP-17 / epic 4 | The spine drops the "shared view" and gives each viewer one view. CAP-17's success line and epic 4's Done-when #2 still require a "shared view" that excludes private accounts. The memlog calls this a spec override, but the spine doesn't record it, so the epic will build a lens the spine forbids. | Record the override explicitly (Open questions, or a note on AD-3) and update CAP-17 and epic 4's Done-when #2. |
| 13 | Medium | AD-6 / AD-16 | "Only the job-runner and CLI composition roots can construct `SystemViewer`" has no enforcement mechanism. `apps/server` hosts HTTP, the job runner and the admin-socket handler in one package. The admin socket has no stated access control (file mode, owner). | Name the mechanism (a factory exported only from `apps/server/jobs` and `admin` entries, plus a lint rule on import paths that bans it under `http/**`) and set the socket to mode 0600, owned by the container user. |
| 14 | Medium | Ops envelope | The upgrade and health-check contract is silent. Nothing defines "healthy" (migrations applied, job runner leased, DB writable), and nothing says how forward-only migrations combine with rollback to the previous image (snapshot restore). The architecture is also silent on amd64 plus arm64 (a spec constraint) and on the image's base libc, which matters for better-sqlite3's native build. | Add a one-row convention for `/healthz` and readiness, state "rollback = previous image + pre-upgrade snapshot, never down-migrations", and name the image base (Debian slim, glibc) and the target architectures. |
| 15 | Low | AD-19 | `brokerage: units from lots × the latest price` needs to be "latest price on or before the date", or historical net worth is wrong. Two more cases are undefined: a snapshot and a transaction on the same day, and an account with no snapshot at all. The rule sums "splits" where the parent transactions are meant. Super has no carry-forward on days without a unit price. | Say "on or before `date`" everywhere. A snapshot `as_of` covers transactions posted up to and including that day. With no snapshot, the opening balance is 0. |
| 16 | Low | AD-16 | "`restore` and `reset-user` for a stopped stack stop the container first" doesn't read coherently. A restore swaps the DB file, so it can't "go through `app` use cases" (AD-1) in any meaningful sense. | Split the rule: `reset-user` runs as a use case (via the socket, or offline under a lock). `restore` is an explicit exception to AD-1: a file swap followed by verification, under the exclusive lock. |
| 17 | Low | AD-17 | Items with no account are visible to both partners, but a person-targeted item (a partner-assisted reset notice) has `person_id` and no visibility rule for it. | Add: when `person_id` is set, only that person sees the item. |
| 18 | Low | AD-21 / AD-2 | The order of attachment writes relative to the DB transaction isn't specified (file first, then commit, so any orphans are harmless). The order of the backup snapshot versus the attachments copy isn't specified either (snapshot first). | Add one line fixing both orders. |
| 19 | Low | Stack | Named tech that has no row: bundled Caddy, Tailscale, Docker Engine, WireGuard, Clevis/Tang and Renovate (the memlog verified Renovate 44, but the row was dropped). Libraries with no choice and no deferral: the PDF-bundle generator (epic 10) and the seed's PDF renderer (two units, so they can diverge), the OFX/QIF parsers, the `.xls` reader for QSuper, the ULID library. | Add rows, or add a Deferred row "Epic N picks X" for each. |
| 20 | Low | Environments | The spec lists a demo mode driven by the seed. The spine lists only live, dev and CI. "Dev and CI run the same image" doesn't fit a dev loop with Vite HMR. | Add demo mode (or defer it). Say that dev uses the same seed and mocks, not necessarily the same image. |
| 21 | Low | Rationale leak | Rationale mixed into Rules and Stack: AD-4 "This shows who moved the money, not which account ...", AD-14 "so that epics 4 and 9 have it before M3", Stack "(compiler API for tooling)", Deferred "(Rocky 10 needs x86-64-v3 CPUs)". | Keep only the Rule. The memlog already holds the why. |
| 22 | Low | Bloat | Some content restates the spec instead of adding a contract: the Web and HTTP security, Re-authentication and Exports convention rows copy `security-and-recovery.md`; AD-8's logo-fetch bullet and AD-21's ATO retention warning are spec behaviour; the Core entities ER diagram duplicates `data-model.md`. The spine is about 31 KB. | Cite the spec for these and keep only the parts that bind more than one unit (enforce in the use case, `img-src 'self'`, redact on export). |

## Detail by rubric criterion

### 1. Fixes the real divergence points, misses none

**Settled well.** One write path (AD-1), synchronous transactions (AD-2), SQL-level visibility (AD-3), a single redaction boundary (AD-4), NotFound for private accounts (AD-5), the job outbox (AD-8), a single status channel (AD-9), table ownership and field precedence (AD-10), sign (AD-12), rounding by weights (AD-13), the Clock and pay calendar (AD-14), seed modules (AD-15), the review inbox (AD-17), privacy of classification rows (AD-18), the balance function (AD-19) and the error, ID and money conventions. The four contracts (a) to (d) that the initiative asked for are all present.

**Missed divergence points:**

- **Visibility for data scoped to a person (#1).** Every scoping rule hangs off `account_id`. `goal`, `goal_allocation`, `budget(scope=person)`, `pay_anchor`, `forecast_assumption`, the tax pack (a per-person read model), the WFH log and depreciable assets have no account. Epics 6, 7, 8 and 10 will each decide on their own whether the partner can see them. A personal goal funded from a private savings account leaks that account's saving rate through `goal_allocation`. Audit rows and review items with a null `account_id` default to visible to both partners, so they leak the same way.
- **Which viewer runs background and cross-account work (#2).** `SystemViewer` exists, but nothing assigns it. Transfer matching (epic 3) must look at other accounts, possibly the partner's private one. Period close (epic 7) reads a pool. LLM categorisation (epic 5) runs as a job. Recurring detection (epic 6) scans payees. Without a rule, epic 3 might run matching under the importing user's viewer, which can never link a transfer into the partner's private account, while epic 5 runs everything as system.
- **Dedupe across formats (#5).** See criterion 2.
- **Rounding from decimal to cents (#8).** Epics 8, 9 and 10 will each pick a rounding mode.
- **How Temporal is loaded in `shared` (#10).**
- **Health and upgrade contract (#14).** Epic 1 builds `pangolin upgrade`, but every epic's Done-when depends on it ("Deployed with `pangolin upgrade`"), and nothing states what a later epic must provide to stay "healthy".

### 2. Every AD's Rule is enforceable and prevents its stated divergence

- **AD-20 does not prevent its stated divergence (#5).** "Prevents: overlapping OFX, CSV and PDF files for one account double-importing." The fingerprint includes the normalised description, which differs between CommBank OFX `NAME`/`MEMO`, CSV description and truncated PDF text. The rule needs either a description-free probable-duplicate key routed to review, or a per-account canonical format. The occurrence number within a day is also not stable when a file starts or ends partway through a day. Separately, the rule never names the table the unique indexes sit on (`transaction` or `import_row`). Putting them on `import_row` would block re-staging.
- **AD-6's "unreachable from HTTP" has no mechanism (#13).** The paradigm table enforces the package rule by lint, but `SystemViewer` construction sits inside `apps/server`, which also hosts HTTP. The admin socket (AD-16) is a SystemViewer entry point with no stated access control.
- **AD-11's closed list is broken on day one (#7),** so it can't be enforced as written.
- **AD-13's "nothing else rounds money" is unenforceable (#8),** because rounding outside `allocate()` is unavoidable.
- **AD-11's lot projection (#9)** drops manual parcel selection unless the event carries it.
- **AD-6's LLM rule (#6)** prevents cloud leakage but not leakage between partners through a local model's few-shot context. The AD's own Prevents line ("private ... data reaching a cloud model") is met. The broader CAP-3 guarantee is not.
- **AD-7** is enforceable, and consistent with AD-4's "transfer still counts towards the owner's contribution" if contribution is read from the shared-account side of the transfer. Say so, or an implementer will read the private side (and AD-3 forbids that for the partner's viewer).

### 3. Nothing under Deferred lets two units diverge

The Deferred list is clean. The logging library and HTTP middleware go to epic 1, which comes first. Holidays only affect future periods, and closed periods are frozen. Drizzle final and `node:sqlite` are contained by committed SQL and sync ports. Multi-currency is safe. One caution: the Stack items with no owner (#19), the PDF generator and the parsers, are neither decided nor deferred. Two units produce PDFs: the seed statement renderer and the tax-pack bundle.

### 4. Named tech is verified current

Checked on 2026-09-27 against the npm registry and nodejs.org. Everything matches.

| Item | Spine | Registry |
| --- | --- | --- |
| typescript | ~6.0 + TS7 checker | latest 7.0.2; 6.0.3 exists |
| pnpm | 12 | 12.6.0 |
| hono | 4.13 | 4.13.9 |
| better-sqlite3 | 13 | 13.0.3 |
| drizzle-orm / drizzle-kit | 1.0 RC | rc 1.0.0-rc.4 (stable 0.45.3 / 0.31.11) |
| zod | 4 | 4.6.5 |
| better-auth / @better-auth/passkey | 1.7 | 1.7.6 / 1.7.6 |
| react | 19.3 | 19.3.0 |
| vite | 8 | 8.3.1 |
| TanStack Query / Router / Table / Virtual | 5 / 1 / 9 / 3 | 5.104 / 1.170 / 9.2.4 / 3.14 |
| tailwindcss / shadcn | 4 / 4 | 4.3.3 / 4.21.0 |
| echarts | 6 | 6.1.0 |
| decimal.js | 10 | 10.6.0 |
| temporal-polyfill | 1.0 | 1.0.5 |
| pdfjs-dist | 6 | 6.3.289 |
| vitest / playwright | 5 / 1.63 | 5.0.2 / 1.63.0 |
| biome | 2 | 2.5.14 |
| Node.js | 26 | v26.10.0, `lts:false` today; the LTS date is stated correctly |

Notes:

- Node 26 is still "Current" while M0 starts, and the spine says so. Fine as a knowing choice.
- The pinned Drizzle RC is a knowing pre-release choice.
- Two type-checkers (TS 6 `tsc` and TS 7 native) can disagree. Name which one gates CI.
- Missing rows: see #19. I did not check the non-npm tools (restic, rest-server, Compose, cosign, distros). The memlog records them as verified that day.

### 5. Covers the driving spec's capabilities

All of CAP-1 to CAP-18 appear in `binds` and in the capability map. Gaps are at the edges of capabilities, not whole capabilities:

- CAP-12: no rule says whose tax pack a partner can see (#1), and no PDF-bundle technology is named (#19).
- CAP-9: manual parcel selection is missing from the lot projection (#9).
- CAP-10: super units between statements (contributions converted at that day's price) aren't placed in AD-11 or AD-19. Are they stored or derived?
- CAP-11: when the loan account is private, the property is hidden, but `split.property_id` on rent splits that land in a shared account can still expose the property. AD-18 doesn't list `property`.
- CAP-17: the spine overrides the spec's "shared view" (#12) without recording it.
- CAP-16: the DR key gap (#4) and the upgrade and health contract (#14).

### 6. Every dimension this altitude owns is decided, deferred or open

| Dimension | State |
| --- | --- |
| Paradigm, module boundaries, dependency rule | Decided |
| Data ownership, consistency, derived data | Decided (with #7, #9) |
| Security, privacy | Decided, except person-scoped data (#1) and viewer assignment (#2) |
| Integration and outbound | Decided (allowlist artefact) |
| Async and jobs | Decided (with #3) |
| Errors, API, IDs, time, money | Decided (with #8, #10) |
| Testing strategy | Decided (Tests row, AD-15) |
| **Deployment and environments** | Partly. Live, dev and CI are listed, but demo mode is missing and the target architectures and image base are silent (#14, #20) |
| **Infra and provider strategy** | Mostly decided in the deployment diagram (Proxmox VM, GHCR, TrueNAS, Tang, Ollama), but only as a diagram. No rule states that the host is self-hosted only and has no cloud dependency beyond GHCR. |
| **Operations** | Partly. Logging, backups (via the spec) and a status page are covered. **Silent:** health and readiness contract, upgrade and rollback semantics against forward-only migrations (#14), key escrow and rotation (#4), backup ordering (#18). |
| Performance and capacity | Silent. Epic 2 has "responsive at 50,000 rows". At initiative altitude, one line is enough ("design for up to about 100k transactions and 2 users; no pagination-free endpoints"). |
| Open questions | **The section is missing.** The spine has no Open Questions section. The spec override (#12) and the pending changes to epic and ticket files (#11) belong there. |

### 7. Internal contradictions

- AD-8: backup in the `local` lane vs "only `net`/`llm` call outbound ports" (#3).
- AD-11 closed list vs AD-17 stored `review_item`, and vs `stage_event` and `goal.completed_at` in the ownership map (#7).
- AD-16 "restore ... through `app` use cases" vs AD-1 and the nature of a file-swap restore (#16).
- AD-14 and AD-10 vs the epic files and `tickets.toml` (#11). These contradict the level below, not the spine itself. The spine still has to flag them.
- The Paradigm table lists `deploy/` CLI entry as a composition root, while AD-16 routes the CLI through the server when it is running. That is consistent, since only the stopped-stack path makes the CLI a root, but worth one clarifying word.

### 8. Rationale leak and bloat

See #21 and #22. The Prevents lines are the right place for motivation. The few inline "so that" and "this shows" clauses, and the Stack parentheticals, should go. The bloat mostly copies security behaviour from the spec. Cutting it, and replacing the ER diagram with a pointer to `data-model.md`, would reduce the spine by roughly 15–20% without losing any contract.

## Suggested order of fixes

1. #1 and #2 (they bind epics 3 and 5–10, and both touch privacy).
2. #5 (the M1 risk).
3. #3 and #4 (M0 depends on them).
4. #11 and #12 (propagate to the epics before inception).
5. The Medium items, then the Low ones.
