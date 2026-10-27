---
review_of: ../ARCHITECTURE-SPINE.md
lens: privacy + security + data integrity
reviewed: '2026-09-27'
inputs:
  - ../ARCHITECTURE-SPINE.md
  - ../.memlog.md
  - ../../../../specs/spec-pangolin-money/SPEC.md
  - ../../../../specs/spec-pangolin-money/security-and-recovery.md
  - ../../../../specs/spec-pangolin-money/data-model.md
  - ../../../../specs/spec-pangolin-money/deployment-and-ops.md
  - ../../../../specs/spec-pangolin-money/{categorisation,budgets-goals-forecasting,import-pipeline}.md (for the transfer, rule, goal and dedupe mechanics)
verdict: 'Not ready to bind. The skeleton is right (one Viewer in SQL, one redact, one write path), but the stated guarantees leak through channels the ADs never name.'
---

# Privacy, security and data-integrity review: Pangolin Money v1 spine

## Verdict

**Not ready to bind as written.** The spine's structure is sound. A `Viewer` composed into SQL, one `redact()`, one write path through `app`, an outbox for jobs and `allocate()` for money are the right primitives, and most of them can be enforced by lint. The problems are in scope. AD-3 scopes rows by `account_id`, and AD-4 redacts at the boundary. Several paths never meet either:

- derived and person-scoped rows with no `account_id`;
- grouping, filtering, sorting and rule matching on hidden names, which happen *before* the boundary;
- job-built rows that `SystemViewer` computes from private inputs;
- the partner-assisted reset, which gives one partner the other's login.

On integrity, `balanceAsOf` anchors on the latest snapshot, which can hide duplicate or missing history, and the dedupe keys do not in fact stop the cross-format overlap AD-20 claims to prevent. Key escrow for disaster recovery is not specified at all.

About 60% of the fixes are wording and scope edits to existing ADs. The rest are two new rules: **AD-22, derived rows inherit the most restrictive scope of their inputs**, and **AD-23, the trust boundary and key escrow**. A **noninterference test** also makes the whole privacy promise testable (§7).

## Severity summary

| # | Sev | AD | Finding | One-line fix |
| --- | --- | --- | --- | --- |
| F1 | **Critical** | CAP-15, AD-5 | Partner-assisted re-enrolment gives the issuing partner a link that enrols a passkey on the *other* person's login, so the issuer can read all of their private accounts | Cooling-off delay (≥48 h) before the link can be redeemed, out-of-band notice to the affected person, cancel from any live session or recovery code, a permanent "re-enrolled by partner" banner, and the residual risk written down |
| F2 | **High** | AD-4 | Hidden names leak before the boundary: through filters, GROUP BY payee, ORDER BY description, payee pages, recurring series, partner-authored rule and alias matching (and their match-count previews), and receipts on hidden-name transactions | Null the hidden-name fields in a SQL projection (`visibleTxn(viewer)`) that every read, rule evaluation and preview uses; `redact()` then only formats. Attachments on a hidden transaction stay hidden until expiry |
| F3 | **High** | AD-3, AD-7, AD-17, AD-18 | Rows with no `account_id` escape scoping. They include `goal_allocation` for a personal pool containing private savings, the household pay anchor detected from private deposits, the emergency-fund target, `review_item` with a `person_id`, account-less items that default to visible, status-page job payloads and errors, and transfer-match review items that pair shared and private rows | New AD-22: every stored or derived row carries a `privacy_scope`, the most restrictive of its inputs. `review_item` is filtered by account **and** person, and the default is closed |
| F4 | **High** | AD-6, AD-8, Outbound allowlist | The allowlist is void once logos are on (any confirmed payee domain, plus DNS). `is_local` is a self-declared flag that unlocks private categorisation and PDF extraction for any endpoint | Send logos through an egress proxy restricted to GET for icons, or keep logos off by default. Derive `is_local` from the `base_url` resolving into configured LAN CIDRs; changing it needs re-auth |
| F5 | **High** | AD-18, AD-10 | A private-origin rule, alias or activity auto-applies to shared accounts, which promotes it to shared without consent. Unique-name `Conflict` errors reveal private tags and payees, `created_from_account_id` serialises a private account ID, and local-LLM few-shots can draw on private or hidden rows | Private-origin classify rows auto-apply only inside their own scope, and promotion is explicit. Uniqueness is per scope. Never serialise the origin ID. Few-shots come from the intersection of visibility, whatever the provider |
| F6 | **High** | AD-19, AD-20 | Integrity. Fingerprints differ by format (OFX NAME/MEMO vs CSV description), so an overlapping OFX and CSV import double-counts. Pending-to-posted transitions are not deduped. A snapshot-anchored `balanceAsOf` hides both duplicates and gaps before the latest snapshot, and so does the backup manifest | Cross-format candidate match on (account, date, amount), sent to review. A pending-row lifecycle. A **snapshot-chain check** (snapshotᵢ₋₁ + Σ = snapshotᵢ) raised as a review item. A manifest of count plus Σ `amount_cents` per account |
| F7 | **High** | Config and secrets, AD-21, CAP-16 | There is no escrow for the app key file, the auth secret (which also encrypts the TOTP secrets) or the restic password. Restoring onto a new host loses receipts (which the ATO requires to be kept five years), LLM keys and TOTP. The monthly drill uses the live key, so it proves nothing about recovery | An install-time DR bundle kept offline. The drill decrypts a sample attachment using the *escrowed* key. `pangolin status` warns until escrow has been confirmed |
| F8 | Medium | AD-11, AD-14, AD-7 | Backdated imports into closed periods, and changes to an account's privacy or savings flag, have no defined effect on `goal_allocation`, frozen pools, shared history or existing `beneficiary=shared` splits | Closed periods are immutable, so any delta goes to the current period's buffer as an audited adjustment. `accounts.setPrivacy` is a use case that rejects or rewrites shared splits, with the rules written down |
| F9 | Medium | AD-16, AD-6 | The admin socket's permissions and location (on the data volume, and swept into restore and backup), its command allowlist and its peer check are unspecified. The HTTP and job roots share `apps/server`, so the lint cannot tell them apart | Put the socket on its own `/run` tmpfs volume, mode 0600, with an SO_PEERCRED uid check and a fixed command set. The lint works per directory: `apps/server/src/http/**` may not import `SystemViewer` |
| F10 | Medium | Migrations | The FK-off window: `PRAGMA foreign_keys` is a no-op inside a transaction, drizzle-kit emits its own PRAGMAs, FTS triggers fire during table rebuilds, and `foreign_key_check` misses the app invariants | Apply PRAGMAs outside BEGIN in a runner owned by us. Drop and recreate the FTS triggers around a rebuild. Run the invariant suite after migrating, before commit |
| F11 | Medium | AD-4, AD-5 | The "Transfer from <owner>" label reveals a private account by elimination, contrary to the AD's claim. Client-generated ULIDs allow collision oracles, and ULID timestamps date promoted rows | Correct the AD's claim and accept it as a residual. IDs are generated on the server only. Mint a new ID when a row is promoted |
| F12 | Medium | Re-authentication, AD-1 | The freshness window is undefined. The CLI and `SystemViewer` bypass it. better-auth writes its own tables outside AD-1 and audit | `Viewer.authAt` plus a window per action (for example 5 minutes). CLI commands audited as `cli:*`. better-auth hooks write audit rows through `identity` |
| F13 | Low | AD-21 | Blobs named `<sha256 of plaintext>` let anyone holding the disk or backup check for known files, and attachment fetch by hash is an existence oracle | Name blobs by HMAC(key, plaintext). Fetch by link ID only |
| F14 | Low | AD-13, Money | Units × price → cents must round, but AD-13 says "nothing else rounds money" | Add a single `shared.toCents(decimal, mode)` with the rounding mode documented per use |

---

## 1. Privacy side channels (AD-3/4/5/7/18)

### 1.1 Hidden names leak before `redact()` (F2, High)

AD-4 says "`redact()` once, at the `app` boundary". That is correct for *formatting*, but a hidden name can influence a result long before the boundary.

- **Filter.** A ledger URL filter such as `?payee=<id>` or `?q=tiff` (a `LIKE` path, separate from FTS) returns the hidden row under a named payee. The row's *membership* in the result reveals the name even when its label reads "Hidden until…". AD-4 only excludes hidden names from FTS.
- **Grouping.** Reports such as "spending by merchant" and "top payees" group by `payee_id`. The hidden row's amount lands in the group called "Tiffany & Co".
- **Sorting.** `ORDER BY description` puts the redacted row among the T's.
- **Payee detail page.** Payee X's transaction list and total include the hidden row.
- **Recurring series** (`recurring_series.payee_id`). A monthly hidden payment becomes a visible named bill. It is scoped by account, and the account is shared.
- **Rules as an oracle.** The partner writes a rule `description contains "TIFF"` and watches which "Hidden until" row changes category, or reads the "N transactions match" preview. Nothing in AD-4, AD-10 or AD-18 prevents this. `payee_alias` patterns are the same oracle.
- **Receipts.** AD-21 says an attachment's visibility follows its entity. For a hidden-name transaction in a *shared* account, the entity is visible, so the receipt, and the merchant name printed on it, is visible too.
- **Logo.** A shared payee's logo is visible through the payee endpoint even when the transaction row redacts it.
- **Hider identity.** `name_hidden_by` is not specified to be restricted to `performed_by` or the account owner. If either partner can hide any row, the "hide" action becomes a way to vandalise the other's view.

**Fix: amend AD-4.**

1. Hidden-name fields (`description_raw`, normalised description, `payee_id`, `notes`?, logo) are replaced in a SQL projection `visibleTxn(viewer)`: NULL, or a sentinel payee "Hidden". Every read, filter, GROUP BY, ORDER BY, FTS query, rule and alias evaluation, and preview count *authored by or shown to* that viewer goes through it.
2. Rule and alias application at import runs with the *rule author's* projection. A partner-authored rule never matches on a field hidden from that partner, and its preview counts come from the same projection.
3. Attachments linked to a hidden-name transaction are hidden from the partner until `name_hidden_until`.
4. Only the performer or the account owner may hide.
5. Decide explicitly on `notes`, `split.memo` and tags. The spec keeps them visible, but they are the most likely place a name gets typed. Recommendation: hide `notes` and memo together with the name.

Then `redact()` only formats the label.

### 1.2 Rows that AD-3 cannot scope (F3, High)

AD-3's scope is "a direct or transitive `account_id`". These rows carry private data but no account:

| Row or figure | How private data gets in | Visible to partner today? |
| --- | --- | --- |
| `goal`, `goal_rule`, `goal_allocation`, `stage_event` for a **personal pool** | "Each person has their own [savings], plus shared ones"; the pool may include private savings accounts; `allocated_cents` = share of the private delta | Yes: planning tables are unscoped |
| `budget` scope=person, `pay_anchor`, `forecast_assumption` | The person's pay cadence; `deposit` alignment reads deposits that may land in a private account | Yes |
| Household pay anchor ("whichever payday comes first") and shared-budget period boundaries under `deposit` alignment | Derived from private pay deposits → reveals pay date and irregular pay | Yes, through every shared budget |
| Emergency-fund target "N months of essential spending" for a *shared* goal | Computed from fixed-cost splits over 12 months; under `SystemViewer` that includes private splits | Yes. This also breaks AD-7's "identical for both" in spirit |
| `review_item` with `person_id` but no `account_id` (personal-pool reconciliation shortfall, stage change, partner-assisted reset notice, cap-exceeded warning, SG missed) | AD-17 filters by `account_id` only; "Items with no account are visible to both" | Yes. Default-open |
| Transfer-match review item (import step 6) for a shared transaction whose candidates include a private transaction | Raised by a job under `SystemViewer`, `account_id` = shared side; `entity_ref` or candidates list the private row | Yes |
| Auto-linked `transfer_group` (unique match to a private row) | `transfer_group` is not in the scoped list; the shared row's `transfer_group_id` plus a NotFound on the counterpart confirms that a private account exists | Partially |
| Status page and dead jobs (AD-9) | `job.payload` (file names, `account_id`), `last_error` (may contain PDF text or descriptions) | Yes; both partners see the status page |
| Tax tables (`WFH log`, depreciable assets) and the per-person tax pack | Per person, possibly bought from private accounts | Unspecified |
| Backup and restore-drill results (per-account manifest) | Computed under `SystemViewer` | Yes, if they list per-account figures |
| Settings "LLM request preview" | Which transaction is sampled? | Could show a private or hidden row |

**Fix: a new AD-22, "Derived and person-scoped rows carry a privacy scope".**

- Every stored row that is not a scoped-by-account table carries `scope_person_id` (NULL = household) and, where it came from data, `scope_account_ids` or the most restrictive single account. A row computed from inputs takes the **most restrictive** scope of those inputs, which extends AD-18 from classify rows to all derived rows.
- The job runner computes under `SystemViewer`, but writes *only* through use cases that take the scope from their inputs, never from the job.
- `review_item`: a partner sees an item only if its `account_id` is visible **and** its `person_id` is null or theirs. An item with neither is allowed only for a closed list of household kinds (backup failed, restore drill failed, upgrade). Raising any other kind without a scope throws `Validation`. Badge counts use the same predicate; add a test that the count and the list agree.
- Transfer matching: a candidate pair whose sides have different visibility sets is proposed only to the private side's owner. The item carries the private side's `account_id`, and an automatic link is allowed only if the counterpart's owner is the importer.
- Shared-figure inputs are pinned. The household pay anchor and shared-budget boundaries use `calendar` alignment, or `deposit` alignment on *public* accounts only. Shared-goal targets use non-private splits only. State this in AD-7 as an enumerated list, because "every shared figure" is not self-enforcing.
- The status page shows kind, state and time only. `last_error` is logged, not served. Dead jobs that carry an `account_id` are scoped.
- Per-person reports (tax pack, personal budget and goal pages) are generated only for the viewer who is their subject. Partner B asking for A's tax pack would otherwise get a figure that is **silently incomplete** yet looks authoritative, so this is an integrity risk as well as a privacy one.

### 1.3 AD-18 promotion and cross-account application (F5, High)

- "Once it is used on a visible account, it becomes shared." Rules, `payee_alias`, payee defaults and activity pre-fill (CAP-13: "offers itself as a suggestion for a transaction inside its date range") all run **automatically** at import. So a rule A created from a private transaction ("PSYCH CLINIC → Health") that fires on a shared-account row silently promotes the rule, its pattern, the payee and its logo to B. An activity A created privately ("Ring shopping, 1 Mar–30 Apr") becomes a suggestion on B's shared transactions, and suggestions are visible.
- `created_from_account_id` is a private account ID. If it appears in the payee, rule or tag read model, B learns the ID, which gives an oracle through AD-5's NotFound on other endpoints.
- **Uniqueness oracles.** If `tag.name`, `payee.name`, `category.name`, `activity.name` or `rule.priority` are unique household-wide, B creating tag "Divorce lawyer" gets `Conflict` when A holds it privately.
- **ULID timestamps.** A payee promoted today whose ULID dates from eight months ago tells B that A has shopped there since then.
- **LLM few-shots.** AD-6 limits few-shots to non-private accounts only on a *cloud* provider. With the default local Ollama, categorising a shared transaction can draw on A's private and hidden rows. The model's `payee_name` and `website_domain` output then lands in a B-visible suggestion, and can echo "Tiffany & Co".

**Fix.**

- Amend AD-18: a private-origin row auto-applies only to accounts in its own visibility set. Promotion is an explicit owner action, or the row is forked into a new shared row with a **new ID** and no history.
- The origin ID is never serialised to anyone but the owner.
- Unique indexes include the scope column: `(scope, lower(name))`.
- Amend AD-6: whatever the provider, few-shot candidates = rows visible to *every* viewer who can see the target transaction, excluding name-hidden rows. The same builder produces the preview, under the requesting viewer.

### 1.4 Transfers, existence and IDs (F11, Medium)

- AD-4 says "Transfer from <owner>" shows "not … that the account is private". It does reveal it: B can see every non-private account, so a counterpart with no account name is private by elimination. The shared account's own `description_raw` from the bank often reads "Transfer from xx1234 A's Saver" anyway, and B could see that in their own banking app. The honest wording is "Pangolin adds no information beyond the shared account's own bank line". Alternatively, drop the transfer label for the partner so the row shows exactly as the bank line.
- AD-5's NotFound must come from the **scoped query** (`WHERE id = ? AND account_id IN visible`), not from fetching the row and then checking. Otherwise timing and error details differ. `details` on any `AppError` must never echo entity state.
- data-model.md says IDs are "safe to generate client-side". Client-chosen IDs make a PK collision an existence oracle, and let a client plant IDs. Add a convention that the server generates all IDs, from a ULID factory taking the injected `Clock` and a seedable RNG (needed for §7 anyway).

### 1.5 Contribution percentages, net-worth deltas and counts

- Contributions: AD-7 plus "transfers into shared accounts" is sound. The inflow is already visible on the shared side. **Keep** the rule that contribution uses only the shared-side row and never the private debit, which may differ, for example because of fees.
- Household totals: they are per viewer by design, so there is no cross-leak. Be careful with any screen that shows B's view of *A's* personal net worth or "A's share" (for example, property equity): that must be the non-private subset, and labelled so.
- Pagination totals, badge counts, `import_batch.dup_count`: fine if they come from the same scoped query. The noninterference test in §7 catches any that do not.
- Account privacy toggles: see §5.3.

---

## 2. Authentication, recovery, SystemViewer and the admin socket

### 2.1 Partner-assisted reset is a takeover path (F1, Critical)

As specified: "the other partner, re-authenticated with their passkey, issues a one-time re-enrolment link". The issuer holds the link, so the issuer can redeem it and enrol their own device as the other person, then read every private account. "It never reveals the other person's private accounts" is true of *issuing* and false of *using*. The in-app notification goes to a person who is, by definition, locked out. SMTP is optional.

**Fix: add to the Re-authentication convention, or a new AD.**

- The link can be redeemed only after a **cooling-off period** (48–72 h, configurable, never 0).
- Notification is out-of-band: SMTP is **required** for this feature, or else a pre-registered second channel.
- The affected person can cancel with any live session, any remaining recovery code, or a password+TOTP login.
- Redeeming kills all old sessions. The recovered account then shows a persistent "re-enrolled via partner on <date>" banner and an audit entry that cannot be dismissed.
- Document the residual: "a partner who can also intercept your email can take over your login".

Apply the same analysis to `pangolin reset-user`. It must print the enrolment link on the console only, expire it, audit it as `cli:reset-user`, raise a person-scoped `review_item` for the affected user, and revoke their sessions.

### 2.2 The trust boundary is unstated (part of F1/F7, High)

The partner who administers the VM has the unlocked LUKS disk, `sqlite3`, the key file, the restic password and the admin socket. They can read everything, whatever AD-3 to AD-7 say. That is inherent to self-hosting, but the non-admin partner is promised "owner-only" privacy. Add **AD-23, Trust boundary**: privacy between partners holds against the *application* (UI, API, exports, jobs, notifications), not against a holder of host shell. Show this once on the "make account private" screen. It is a product-honesty point and costs nothing.

### 2.3 Admin socket (F9, Medium)

- **Location.** "A Unix socket on the data volume" puts it inside the directory that `restore` swaps and that backups sweep. The container root is read-only, so the socket needs a writable directory. Use a dedicated `/run/pangolin` tmpfs or volume, separate from data.
- **Who can reach it.** Anyone with write access to the host path, including a second container mounting the same volume and any user in the `docker` group. Require the directory at mode 0700 and the socket at 0600, owned by the container uid, **plus an SO_PEERCRED uid check** in the server. The CLI runs as that uid, or via `docker exec`.
- **What it exposes.** A fixed allowlist of commands (`status`, `backup`, `reset-user`, `restore-prepare`, …), dispatched to named use cases. It must not be a Hono app sharing routers with HTTP, and it must offer no generic query or export command running as `SystemViewer`. There is no re-auth on the socket, because host shell is the credential, so every command is audited as `cli:<command>`.
- **Lint granularity.** AD-6 says only the job-runner and CLI roots construct `SystemViewer`, but the HTTP API and the job runner share `apps/server`. Make the rule per directory: `apps/server/src/http/**` must not import `system-viewer`. Add a test that walks the `AppType` route table and asserts that no handler runs with `SystemViewer`, by injecting a sentinel.
- **Restore on a stopped stack** takes an exclusive lock and runs `app` use cases. It needs the key file, and it must refuse to swap if the verification in §4 fails.

### 2.4 Re-authentication and better-auth (F12, Medium)

- "A fresh passkey or TOTP" has no window. Put `authAt` on `Viewer` and give each action a maximum age: exports, provider changes, deletes, partner reset, `is_local` or `base_url` changes, account privacy toggle, hiding (maybe).
- **Add the privacy toggle and `cloud_pdf` opt-in to the re-auth list.** They are the two switches that move data across a boundary.
- better-auth writes users, sessions and passkeys itself. That is a write path outside AD-1 and its audit. Use better-auth hooks to write `identity` audit rows (login, failed login, passkey added or removed, TOTP changed, session revoked), and make them visible to the affected person.
- Lockout: apply lockout to the password+TOTP path only. Passkey login must stay available, or an internet attacker can lock out a named partner.

---

## 3. Outbound data and the LLM (F4, High)

- **Logos defeat the allowlist.** Hosts in the outbound allowlist are fixed, except for "confirmed payee domains", which are arbitrary and grow over time. `install.sh` cannot generate firewall rules for them, so in practice the firewall must allow 443 to anywhere once logos are on. That voids the spec's claim that "even compromised code cannot send data anywhere unexpected". DNS is a second exfiltration path the allowlist never mentions. The domain list itself also leaks: the fetch sequence reveals merchants to the network path and the DNS resolver.
  **Fix:**
  - Either default logos **off**, with install-time wording that turning them on opens egress;
  - or route logo fetches through a tiny egress proxy (separate container, its own firewall exception) that performs only `GET https://<domain>/favicon.ico` (or the `<link rel=icon>` target on the same domain), with no query strings, a size cap and no redirects off-domain. The app container keeps its strict allowlist.
  - Pin DNS to one resolver in the allowlist.
- **`is_local` is self-declared.** AD-6 gates private categorisation and all PDF extraction on `is_local`. Mark a cloud endpoint `is_local` and both gates open. Derive it instead: `is_local` is true only if `base_url`'s host resolves to a configured LAN CIDR, or to a host listed as local in the allowlist artefact. Changing it needs re-auth and writes an audit row. Re-check the resolution at call time, which guards against DNS rebinding.
- **Wording gap.** Name-hidden transactions going to a cloud `categorise` provider is not a partner leak, so there is no change there. The gap is on the way back: the spine should say that `pdf_extract` and `categorise` output is written only into the scope of the target transaction, and never into shared classify rows unless §1.3's scope rules allow it.
- SMTP bodies "pass through `redact()`". Specify the **recipient's** `Viewer`, never `SystemViewer`.
- Logging: descriptions and amounts are redacted by default. Add PDF text, LLM prompts and responses, and the `last_error` of jobs.

---

## 4. Key management and disaster recovery (F7, High)

Secrets that `install.sh` generates, and what losing each one costs on a restore to a new host:

| Secret | Protects | If lost with the host |
| --- | --- | --- |
| App key file | Attachments (receipts, statements, logos), LLM API keys | **Receipts unrecoverable.** Tax evidence the ATO requires to be kept five years, which AD-21 itself cites |
| better-auth secret | Session signing; the better-auth two-factor plugin encrypts TOTP secrets with it | TOTP fallback broken; everyone falls back to recovery codes or `reset-user` |
| restic password | The backups | **All backups unusable** |
| LUKS recovery passphrase or Tang binding | Data disk | Disk unreadable if Tang is lost |
| GHCR token | Image pulls | Reissuable |

The spine says only that the key is "read from a key file outside the database". Neither spine nor spec says where copies live. The spec says the restic key is "never stored on the backup target", which by itself leaves the only copy on the host.

**Fix: AD-23, second half.**

- `install.sh` produces a **DR bundle** (restic repo URL, restic password, app key, auth secret, LUKS recovery key), shown once for the user to store offline, for example in a password manager or on paper. It refuses to finish until the user confirms, and `pangolin status` warns while escrow is unconfirmed.
- The key file is **not** in restic. Putting it there makes the restic password the only thing guarding everything; that is acceptable, but decide it deliberately. Recommendation: keep the key out of restic, and escrow it.
- Blobs carry a key-version header, so the key can be **rotated** (`pangolin rotate-key` re-encrypts through a `system` use case).
- **The drill must prove recovery, not just a backup copy.** The monthly drill runs on the same host with the live key file. Add a CI release test that restores onto a *clean* host path using only the DR bundle, then decrypts one attachment and one LLM key and logs in with TOTP. Add a quarterly "enter the escrowed key" check on the live server that compares the escrowed key's fingerprint with the live one, without storing it.
- Restore verification (integrity check, row counts, balance sums) should also check: that every attachment row has a blob that decrypts, FTS5 `integrity-check`, the invariant suite (§5.5), and a per-account `count` and Σ `amount_cents` (see §5.2 for why balance sums are not enough).
- Hygiene:
  - the key file is mounted read-only, mode 0400, and is never in `.env` or `docker inspect` output;
  - `VACUUM INTO` staging files are removed after upload;
  - Proxmox or PBS backups are client-side encrypted (already in the spec) and listed as holding the key file if they capture the host.

---

## 5. Data integrity

### 5.1 Dedupe across formats and pending rows (F6, High)

- AD-20 claims to prevent "overlapping OFX, CSV and PDF files for one account double-importing". But:
  - `external_id` exists only in OFX;
  - the fingerprint uses the **normalised description**, which differs between OFX `NAME`/`MEMO`, the CommBank CSV description and LLM-extracted PDF text;
  - so the same bank line imported once as OFX and once as CSV matches neither unique index, and is imported twice.
- The occurrence number is computed within a file. A partial-day file and a full-day file for the same day are safe only when descriptions normalise identically.
- **Pending → posted.** CommBank exports can include pending rows, which later post with a different FITID, amount (tips, FX) or date. The spine and spec do not mention `status`-driven replacement.

**Fix: amend AD-20.**

1. After the exact-key checks, a **candidate check** on `(account_id, posted_on ± 2 days, amount_cents)` against rows from a *different* `import_profile`/`source` sends any match to review (`review_item` kind `possible_duplicate`), never to automatic insert.
2. Pending rows are either never imported, or stored with `status = pending` and replaced by their posted counterpart through a `ledger` use case, with an audit row.
3. Occurrence numbering is computed against already-committed rows plus the file, for the same fingerprint version.

### 5.2 `balanceAsOf` opening anchors (F6, High)

- **Snapshot semantics.** Is a `balance_snapshot` at `as_of` the balance at the start or end of that day? Are splits "posted since" counted from `>= as_of` or `> as_of`? An off-by-one here double-counts or drops a day's transactions. Define it as the closing balance at end of `as_of`, plus transactions with `posted_on > as_of`.
- **Anchoring hides errors.** A duplicate or missing transaction *before* the latest snapshot never shows in any balance, but it does inflate spending reports, which sum splits. So balances and reports can disagree silently, and the M1 gate ("no unexplained balance gaps") cannot be measured. **Add a snapshot-chain invariant:** for consecutive snapshots of an account, snapshotᵢ₋₁ + Σ(`posted_on` in (as_ofᵢ₋₁, as_ofᵢ]) = snapshotᵢ, otherwise raise a `review_item` (`balance_gap`) naming both dates and the gap. Run it after every commit and nightly.
- **Conflicting snapshots.** Two snapshots on the same date from different sources (statement, OFX `LEDGERBAL`, manual) need a precedence order (statement > import > manual) and a unique key `(account_id, as_of, source)`.
- **No snapshot.** Define the opening anchor: an explicit `opening` snapshot at `opened_on`, or the first import's opening balance. `balanceAsOf` throws `Validation` rather than silently summing from zero.
- **Sum transactions, not splits.** Use `transaction.amount_cents` for balances. Splits must equal it anyway, and using the parent avoids a split-sum bug moving balances. Exclude soft-deleted transactions and pending ones, per §5.1.
- **Manifest.** The backup manifest uses `balanceAsOf`, which anchors, so it inherits the same blindness. Add the per-account count, Σ`amount_cents` and max(`updated_at`).

### 5.3 Period close vs backdated imports, and scope changes (F8, Medium)

- **Backdated imports into a closed period.** Examples: the first 12 months of history arriving after goals start, a late PDF statement, or a late-posting transaction. The closed period's "new savings" changes, but its `goal_allocation` and boundaries are frozen (AD-11, AD-14). CAP-7's invariant (goals + buffer = real balance) then breaks.
  - The spec's "offer to put the difference in the buffer" is the right *mechanism*, but it has to be the rule, not an offer: closed periods are immutable, and any delta to a closed period's savings goes to the **current** period's buffer as an audited `buffer_adjustment` row (a new stored-derived item, so add it to AD-11's closed list).
  - A negative delta that exhausts the buffer raises the over-commitment item.
  - Re-running allocation for a closed period is forbidden, and the idempotency key `(pool, period_start)` makes that enforceable.
- **Changes to a pool's membership.** An account is newly flagged `is_savings`, unflagged, or moved between shared and personal by an ownership change. Define whether this applies from the next period or re-bases the buffer, and do it through one `accounts` use case that raises the CAP-7 mismatch item.
- **Account privacy toggle.**
  - Public → private: existing `beneficiary=shared` splits violate AD-7, shared history (budgets, contributions) is rewritten retroactively, and classify rows already promoted stay shared. Forcing the splits to the owner, with an audit row, is acceptable; rewriting shared history is not.
  - Private → public reveals the whole history.
  - **Recommendation:** `accounts.setPrivacy` needs re-auth. It either refuses while shared splits exist, or rewrites them to the owner, and the confirm screen states the consequences. Shared figures for closed periods stay frozen.
- **Lots, CGT and lodged years.** AD-11 rebuilds lots on every event write, so a backdated event (DRP, cost-base adjustment) silently changes a capital gain in an FY that may already be lodged. Add an `fy_lock` (lodged) marker. A write that changes a locked FY's figures succeeds, but raises a person-scoped `review_item` showing old and new figures.

### 5.4 Job retry and import-commit idempotency (Medium)

- The commit must be a **compare-and-set** on `import_batch.status` (`ready → committed`) inside the write transaction. That rule is not in the spine. With lease expiry (a long LLM extraction plus `llm` lane concurrency above 1 later), two runners can reach commit. The unique indexes would catch the transaction rows, but not the batch-level side effects (snapshots, follow-up jobs, review items) unless those are keyed too.
- AD-8 says "every handler is idempotent" but asks for no key. Require each job kind to declare its **idempotency key and the unique index that enforces it**:
  - `suggestion`: `(split_id, field, source, model, prompt_version)`;
  - `review_item`: `dedupe_key`;
  - `goal_allocation`: `(pool, period_start, goal_id)`;
  - `balance_snapshot`: `(account_id, as_of, source)`;
  - logo `attachment`: sha;
  - price rows: `(security_id, date, source)`.
- Lease: renew or fence. A handler whose lease has expired must fail its commit (check `job.lease_token` in the write transaction).

### 5.5 Migrations: the FK-off window (F10, Medium)

- `PRAGMA foreign_keys` is **a no-op inside a transaction**. The convention must say it is set *before* `BEGIN` and restored after `COMMIT`, by a migration runner we own. drizzle-kit's SQLite output can contain its own `PRAGMA foreign_keys=OFF/ON` statement breakpoints. Strip them or lint for them, or they will silently interleave.
- While FKs are off, `DROP TABLE` does not cascade, which is good. But any `DELETE` a migration performs also skips its cascades, so a data migration can leave orphans that `foreign_key_check` *will* catch. That makes the check a hard gate; keep it.
- **FTS5 triggers fire during the 12-step table rebuild** (`INSERT INTO new SELECT … FROM old`) and on `DROP` or `RENAME`. Drop FTS triggers before a rebuild of `transaction` or `split`, recreate them after, then `INSERT INTO fts(fts) VALUES('rebuild')` and run FTS `integrity-check`.
- Set `legacy_alter_table = OFF`, so `RENAME` updates trigger and view references.
- `foreign_key_check` does not cover the app invariants. After migrating, but before commit, run the **invariant suite**:
  - every transaction's splits sum to it;
  - transfer groups have two sides with opposite amounts;
  - the `lot` projection equals a rebuild;
  - `goal_allocation` sums are ≤ allocated savings;
  - scoped tables have no row whose `account_id` is NULL where required;
  - every `review_item` has a scope (§1.2).

  Run the same suite nightly and during restore verification.
- The job runner and the admin socket must also wait for migrations, not only HTTP.
- A data migration that changes money or scope writes `audit_log` rows with actor `migration:<id>`.

### 5.6 Money arithmetic (F14, Low)

- `allocate()` covers division. Units × price, FX, and `decimal` → `Cents` for valuations, cost bases and CGT all *round*, which contradicts "nothing else rounds money". Add `shared.toCents(decimal, 'half-even' | 'down')` with the mode fixed per use: valuations half-even; cost base per ATO practice.
- `split` sum = parent is enforced in the ledger use case. Add a `transaction_id`-level assertion at the end of every `ledger` transaction, which is cheap, plus the nightly invariant job.
- better-sqlite3: leave `safeIntegers` off for cents, which is fine below 2⁵³, but assert `Number.isSafeInteger` in the `Cents` brand constructor. `UnitsMicro` × micro-prices can exceed 2⁵³, so do that product in `decimal.js`.

---

## 6. Smaller items

- **AD-21 blob naming (F13).** `data/attachments/<sha256(plaintext)>` lets anyone holding the disk image or backup confirm possession of a known file, such as a public PDF or a known favicon. Name blobs `HMAC(appKey, plaintext)` and serve them only by `attachment.id` after a visibility check on the link, never by hash. Deduplication keeps working.
- **CSP.** `img-src 'self'` should also cover `blob:` if receipts are previewed from decrypted bytes. Also serve decrypted attachments with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, because an uploaded HTML or SVG "receipt" is stored XSS on the app origin. Allowlist the MIME types on upload.
- **CSV export.** Also prefix cells starting with TAB and CR, per the OWASP list, not only `= + - @`.
- **Registration.** The one-time setup link printed by `install.sh` needs a short expiry and single use. Say that "registration closes after both exist" is enforced in `identity`, not only in the UI.
- **Audit before/after JSON.** Store it as a per-field diff, and have `redact()` use a per-entity **field-sensitivity registry** that is exhaustive, with a test that fails when an entity has no entry. Each audit row records the `privacy_scope` it had when written (§1.2), so later AD-18 promotion of an entity does not expose history from while it was private.
- **"Hidden until <date>"** reveals when the surprise ends. That is a spec choice, noted as accepted.

---

## 7. Testability: can each rule be checked?

**The key addition is a noninterference test.** For partner B, build world W from the seed. Build W′ by mutating *only* A's private data: private account names, amounts, counts, dates, notes and hidden names, plus A's private-origin classify rows. Call every route in the `AppType` route table as B, run every export, render every notification for B, and capture every request the mock LLM and mock price servers receive for B-visible work. **The two sets of outputs must be byte-identical.**

The test needs deterministic ULIDs and timestamps (a seeded ID factory and the fixed `Clock`), which AD-15 almost provides. It turns AD-3/4/5/7/18 and the new AD-22 from reviewed promises into a single failing test. It also catches every side channel in §1 that nobody enumerated: counts, badge numbers, contribution percentages, sort order, ULID times, error details. Complement it with **canary strings and odd-cent canary amounts** planted in private and hidden data, grepped in logs, job errors, the backup manifest *as served on the status page*, and outbound captures.

| Rule | Testable as written? | Test that makes it binding |
| --- | --- | --- |
| Import-path lint (ring rules) | Yes | Biome or dependency-cruiser rule in CI |
| AD-1 one write path | Partly | Lint: `db` repositories are importable only from `app`; a test that every mutating route or job produces ≥1 audit row; better-auth hooks for identity writes (§2.4) |
| AD-2 no await in transactions | Yes | Lint forbidding `await` inside `db.transaction` callbacks; repository ports typed sync |
| AD-3 Viewer in SQL | Partly | Noninterference; lint that repository reads take `Viewer` first; a check against the schema that every table with `account_id` (direct or through FK) is in the scoped list, derived from the schema, not a hand list |
| AD-4 redact | **No, not as written** (the before-boundary paths) | Noninterference plus the rule-oracle test (§1.1): a B-authored rule on a hidden substring changes nothing and previews zero |
| AD-5 NotFound | Yes | For each route taking an ID: A's private ID and a random ULID give identical status, body and headers for B |
| AD-6 SystemViewer and LLM | Partly | Per-directory lint; route-table sentinel test; mock-LLM capture asserts no private or hidden canary in any categorise request built for a shared target, local provider included; `is_local` derivation test |
| AD-7 shared figures identical | Yes | Every shared figure computed as A equals the same computed as B, and is unchanged under W′ |
| AD-8 idempotent jobs | **No** (no keys) | Each job kind declares its key; property test runs each handler twice (and concurrently with an expired lease) and asserts a single effect |
| AD-9 status from entities | Yes | Lint: `apps/web` never references `job`; status-page response under W′ is unchanged |
| AD-10 ownership | Yes | Lint mapping table → module for write calls; precedence property test on `setSplitField` |
| AD-11 derived on read | Partly | Lot projection = rebuild; closed-period immutability under backdated import (§5.3) |
| AD-12 sign convention | Yes | Per-profile sample files with expectations |
| AD-13 allocate | Yes | Property test (Σ parts = total); lint banning `Math.round` or `toFixed` on `Cents`; add `toCents` |
| AD-14 clock and periods | Yes | Lint banning `Date.now` and `Temporal.Now` outside `Clock`; period-maths tables |
| AD-15 seed | Yes | Also make the ID factory seeded, so noninterference works |
| AD-16 CLI | Partly | Test that the socket rejects a foreign uid and unknown commands; restore refuses without a lock |
| AD-17 review inbox | **No** (default-open) | Scope predicate plus a closed list of account-less kinds; count = list test |
| AD-18 classify privacy | Partly | Noninterference with a private-origin rule, alias or activity; `Conflict` oracle test on names |
| AD-19 balanceAsOf | Partly | Snapshot-boundary test (a transaction on `as_of`); snapshot-chain gap test |
| AD-20 dedupe | **No** for cross-format | The same seeded bank month as OFX **and** CSV **and** PDF imports once (the rest to review); pending-to-posted test |
| AD-21 attachments | Partly | Receipt on a hidden-name transaction is invisible to B; fetch by hash is impossible; drill decrypts with the escrowed key |
| Re-authentication | **No** (no window) | Stale `authAt` gives `ReauthRequired` for each listed action, including the privacy toggle, `is_local` and `cloud_pdf` |
| Outbound allowlist | Partly | e2e in a network namespace with default-deny; the logo egress proxy rejects anything but an icon GET |
| Migrations | Yes | CI migrates the previous release's DB; add the invariant suite and FTS `integrity-check` |

---

## 8. Suggested spine edits (for the spine's author; the spine is not edited here)

1. **AD-4.** Hidden-name fields are nulled in a SQL projection used for WHERE, GROUP BY, ORDER BY, FTS, rule and alias evaluation and previews. Receipts on hidden transactions are hidden. Only the performer or owner may hide. Correct the "Transfer from" claim.
2. **AD-17.** Visibility is by account **and** person, default closed, with a closed list of household kinds. Badge count = list.
3. **AD-18.** Private-origin rows auto-apply only in their own scope. Promotion is explicit or forks with a new ID. The origin ID is never serialised. Uniqueness is per scope.
4. **AD-6.** Few-shot intersection rule for every provider. `is_local` is derived and needs re-auth. The preview is built as the requesting viewer.
5. **AD-8.** Logo egress proxy (or logos off by default). DNS pinned. Idempotency key and fence token per job kind. SMTP redacted as the recipient.
6. **AD-16.** Socket on `/run`, 0600, SO_PEERCRED, fixed command set, not an HTTP router.
7. **AD-19 and AD-20.** Snapshot semantics, the chain check, the no-snapshot rule, balances summed from transactions. Cross-format candidate dedupe, pending lifecycle, CAS on commit.
8. **AD-11 and AD-14.** Closed periods are immutable, deltas become a buffer adjustment, `fy_lock` review on lot changes. Add `buffer_adjustment` to the stored list.
9. **New AD-22.** Derived and person-scoped rows carry the most restrictive scope of their inputs. Enumerate the inputs to shared figures (pay anchor, shared goal targets). Per-person reports are for their subject only.
10. **New AD-23.** Trust boundary (host admin sees everything; say so), partner-reset cooling-off and out-of-band notice, DR key escrow and a drill that recovers from escrow, key rotation.
11. **Conventions.**
    - IDs are generated on the server only, by a seeded factory.
    - `toCents` rounding.
    - Migration PRAGMA placement, FTS trigger handling, the invariant suite.
    - A re-auth window on `Viewer.authAt`, with the privacy toggle and `cloud_pdf` added.
    - Attachment serving headers and the MIME allowlist.
    - CSV prefix for TAB and CR.
    - Per-field audit diffs with a sensitivity registry.
12. **Tests convention.** Add the **noninterference test** and the canary sweep as release gates from M1.
