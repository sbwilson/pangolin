---
epic: epic-platform-hardening
date: 2026-10-03
verdict: accepted-with-open-items
criteria: declared
headless: false
---

# Retrospective: Platform hardening (epic 11)

## Epic summary

- Epic: `epic-platform-hardening` (id 11), initiative `initiative-pangolin-money-v1`. Done when is declared in the epic file (6 checks).
- Tickets, in build order (all `done`; none still `built`, none unfinished): 11.1 Secrets survive uninstall and reinstall; 11.2 Check the suspected seams (spike); 11.3 Bundle survives an interrupted install; 11.4 DNS drift recovery; 11.5 Data-root change clean-up; 11.6 Releases only move forward; 11.8 Rollback keeps the upgraded database aside; 11.9 Re-run takes its files from the pinned image; 11.10 An empty --backup-server turns backups off, and the stop grace outlasts the runner; 11.7 Refactor sweep.
- Going-in focus (user): look at all tickets.
- Plan ranges (baseline to the next baseline in build order; first-parent on develop):

| Ticket | Range | Note |
|---|---|---|
| 11.1 | `ef58194..4da7f54` | |
| 11.2 | `4da7f54..cf6498d` | cut before backlog bug 1 (`cf6498d..44f6f1e`, not this epic) |
| 11.3 | `44f6f1e..dcb9b71` | |
| 11.4 | `dcb9b71..fa1fc01` | |
| 11.5 | `fa1fc01..ab185bb` | |
| 11.6 | `7078a5d..4c82d19` | |
| 11.8 | `4c82d19..ed3d69a` | |
| 11.9 | `ed3d69a..040326f` | cut before backlog story 4 (`040326f..4843b1a`, not this epic) |
| 11.10 | `4843b1a..0c97027` | |
| 11.7 | `0c97027..64ac5e6` | last range ends at the epic's last merge; `deb2d4c` only marks tickets done |

- Evidence inventory:
  - Epic file with Requirements H1–H6, 6 Done-when lines and dated human decisions; `tickets.toml`; the spike findings note (7 seams).
  - A plan for every ticket; no story files (none was refined). Full route with a four-lens review: 11.1, 11.2, 11.3, 11.4, 11.7. Oneshot with a quick review: 11.5, 11.6, 11.8, 11.9, 11.10 (no Verification section, no Plan Change Log). Only 11.4 has a Plan Change Log entry (loop 1). No dated Code Review blocks.
  - The initiative file has no Requirements section; `covers` points at the epic's own H1–H6 (mapping to CAP-15, CAP-16 in `SPEC.md`).
  - Session logs are not in the repository: the process lessons below come from the plans and this run's records only (narrowed).
  - Diffs outside every range: backlog bug 1 (`cf6498d..44f6f1e`), backlog story 4 and a 2-line 11.6 test fix `83ceb93` (`040326f..4843b1a`), and ticket-status commits.
  - Churn per range (git_evidence.py, all merges measured, no binaries): 11.1 +453/−20; 11.2 +809/−3; 11.3 +383/−12; 11.4 +717/−34; 11.5 +126/−2; 11.6 +190/−8; 11.8 +123/−15; 11.9 +135/−10; 11.10 +193/−13; 11.7 +362/−301. `deploy/install.test.ts` and `deploy/install.sh` are the top files in seven of ten ranges.

## Findings

### Diff-scope review (cross-ticket; code lenses run inline, each checked against `64ac5e6`)

`bmad-review`'s adversarial and edge-case lenses reported after the inline pass; their findings are folded in below (F7–F14), each re-checked against `64ac5e6`. The verification-gap lens reported last; its new findings are F15–F19.

| # | Finding | Source | Tickets | Disposition |
|---|---|---|---|---|
| F1 | A reinstall over kept data (secrets kept, `.env` removed) with a different `--backup-server` writes no recovery bundle: `BACKUP_CHANGED` needs a `.env` ("a first install's new secrets already write one"), but 11.1 keeps the secrets, so none are generated; the run adds a bare bundle id and asks to confirm "the bundle you already have", which names the old repository. | `deploy/install.sh:579-585`, `deploy/uninstall.sh:223-235`; test `install.test.ts:1165` covers the same server only | 11.1 × 11.3 | **Fix now** |
| F2 | Turning backups off while DNS is stale dies with the generic "see journalctl": 11.10's allowlist removal calls `apply_allowlist_now` without 11.4's `early` mode, so render.sh's own reason (`--dns`) is never shown, and `.env` is already blanked while the stack keeps the old repository. A re-run recovers. | `deploy/install.sh:1310-1313`, `:1088-1096`, `render.sh:333-342` | 11.4 × 11.10 | Defer (fix: call it `early`) |
| F3 | A re-run on an image pinned before 11.10 keeps a compose.yaml without `stop_grace_period` (11.9 takes it from the image); the fix arrives with the next `pangolin upgrade`. Documented by 11.10. | `install.sh:1245-1262`, `deploy/compose.yaml:47-49`, `docs/install.md` Re-running | 11.9 × 11.10 | Accept |
| F4 | A bundle written in the same run as `--backup-server ""` (with `--bundle`, or a leftover pending mark) omits `RESTIC_REPOSITORY` and gets a new id, steering the user to replace the bundle that names the repository holding the existing backups. | `install.sh:886-925`, `:573-577`; test `install.test.ts:983-990` | 11.3 × 11.10 | Defer |
| F5 | After `--data-root` moves (11.5 warns and leaves the database behind), uninstall knows only the new root: deleting it, or it being absent, removes the secrets the old root's database needs. | `uninstall.sh:93-100, 223-235`, `install.sh:590-596` | 11.1 × 11.5 | Defer |
| F6 | Uninstall removes the GHCR token even when it keeps the secrets, so a reinstall from a private image needs it again. Intended and commented. | `uninstall.sh:229-230` | 11.1 | Accept |
| F7 | `write_files` reloads the firewall from `write_allowlist` (11.10's removal, and adding the backup entry) **before** it copies the new `render.sh`, so that reload runs the previous release's render.sh: on a host installed before 11.4 it has neither the host-resolver widening nor the all-unresolved refusal. | `deploy/install.sh:1374` (`write_allowlist`) before `:1376` (render.sh copy) | 11.4 × 11.10 | **Fix now** (copy render.sh before `write_allowlist`, or defer the reload to `install_firewall`) |
| F8 | The pre-upgrade copies (since 1.11/1.15) and 11.8's `rolled-back-<stamp>/` copies of the household database live under `/opt/pangolin`, on the system disk, not the LUKS data disk: up to four plaintext copies outside the encryption the install checks for. | `deploy/pangolin:18, 131, 195`; `install.sh` dm-crypt warning | 1.15 × 11.8 | **Fix now** (keep them on the data root) |
| F9 | Re-running install.sh on a digest-pinned install takes the `pangolin` command from that image (11.9), replacing a newer checkout's CLI with an older one: the next `pangolin upgrade` then runs without 11.8's kept copy or 11.7's portable `.env` rewrite. | `install.sh:1378-1381` | 11.9 × 11.8, 11.7 | Defer (take only compose.yaml from the image, or warn when the pinned CLI is older) |
| F10 | Changing the backup server from A to B adds B's allowlist entry but never removes A's; turning backups off then removes only B's. | `install.sh:1310-1319` | 11.10 | Defer |
| F11 | After `--backup-server ""`, every later re-run warns "no backup server set … add PANGOLIN_BACKUP_REPOSITORY", undoing nothing but contradicting the operator's choice. | `install.sh:417-433` | 11.10 | Defer |
| F12 | The secrets guard checks only for `pangolin.sqlite`: with the LUKS data disk not yet mounted on a rebuilt host and the secrets missing, install.sh sees no database and generates new secrets and a new bundle. | `install.sh:781-782`, `:655-659` | 11.1 × 11.5 | Defer (refuse when the data root is expected to be a mount point and is not) |
| F13 | The `release.yml` comment says a cancelled waiting run's tag "must then be pushed again"; pushing an existing tag fires nothing. The docs correctly say delete and re-push (or re-run the run). | `.github/workflows/release.yml:7-9`; `docs/install.md:613` | 11.6 | **Fix now** (comment) |
| F14 | Smaller edge cases, verified: a rollback with no `pangolin.sqlite*` leaves an empty kept directory yet names it; a CIDR in `PANGOLIN_DNS_SERVERS` would make the live `nft add element` batch fail (render.sh then warns and continues); the "backups are off" wording keys on `--no-docker` rather than `run_stack` under `--root`. | `deploy/pangolin:197`; `render.sh:247-254`; `install.sh:1012-1017` | 11.8, 11.4, 11.10 | Defer |
| F15 | `detect_dns` (install.sh) has no test and already drifts from render.sh's `host_resolvers`: a non-IP nameserver that render.sh skips with a warning makes a first install without `--dns` die; it also reads the real `/etc/resolv.conf` under `--root`. | `install.sh:345-356, 490-492`; `render.sh:192-208` | 11.4 | Defer |
| F16 | No round-trip test of the `.bundle-pending` name between install.sh and uninstall.sh: uninstall's test writes the name as a literal; the reinstall test never creates a mark. | `uninstall.sh:230`; `uninstall.test.ts:136-149`; `install.test.ts:1165-1180` | 11.1 × 11.3 | Defer |
| F17 | The `latest`/`prerelease` outputs computed in `release.yml`'s tag step are never executed by a test; only their wiring is checked. | `release.yml:174-186`; `release-workflow.test.ts:138-152` | 11.6 | Defer |
| F18 | The stop-grace test compares against a literal 10 s, not the runner's own default, so raising the runner's wait would bring S11c back with the test still green. | `install.test.ts:2069-2076`; `apps/server/src/jobs/runner.ts:141` | 11.10 | Defer |
| F19 | `install.sh --dns`'s repair loads the new resolvers only at `install_firewall`, after `apt-get update` and the image pull, which run under the stale ruleset; with loopback-only host resolvers the pull can fail first with a misleading message. | `install.sh` `main` order (`install_packages`, `obtain_image` before `install_firewall`) | 11.4 | Defer |

Checked and clean: `release-tags.sh`'s line glob (`v1.2.*` does not match `v1.20.0`; pre-releases filtered); 11.8's `.env.new` clean-up on every path; uninstall keeping `.bundle-pending` (11.1 + 11.3) re-triggers the bundle on reinstall.

### Aggregate views

| # | Finding | Source | Disposition |
|---|---|---|---|
| A1 | `deploy/install.sh` grew from 1402 to 1630 lines and 64 to 72 functions; seven of ten tickets touched it. `settle_all` grew from 21 to 48 lines with a branch each from 11.4, 11.5 and 11.10, a growth no single review saw. `settings()` is 149 lines. `deploy/install.test.ts` grew from 1088 to 2077. | `git_evidence` per range; `install.sh:383, 555` | Defer (the epic 1 retro's A1 install.sh split, already deferred) |
| A2 | Resolver parsing exists twice (`detect_dns`, `host_resolvers`), and `BACKUP_CHANGED` repeats `settle`'s comparison. Both rejected in review with reasons; filters aligned. | `install.sh:345`, `render.sh:192`; 11.4 and 11.3 triage logs | Accept |
| A3 | Two new runtime inputs: render.sh reads the host's resolv.conf and widens DNS beyond `.env` (human decision, option b); install.sh re-runs read `/app/deploy` from the pinned image. | 11.4 plan Decision; `install.sh:1245` | Accept (spec reconciliation in S1) |
| S1 | Spec and spine do not record what was built: the spine's allowlist row says one artefact lists the allowed hosts (DNS to host resolvers is now outside it); the spine health/upgrade row and the ops spec's upgrade steps omit 11.8's kept `rolled-back-<stamp>/`; the ops spec's tagged-release steps omit 11.6's tag rules, concurrency and the third-tag limit; the ops spec has no uninstall or secrets-kept text (11.1). No planning file changed in any range. | `ARCHITECTURE-SPINE.md:389, 397`; `deployment-and-ops.md:34-39, 59-64` | **Fix now** (spec reconciliation, human applies) |
| S2 | `deferred-work.md`'s release-concurrency entry (from 1.18) has no disposition though 11.6 fixed it. | `deferred-work.md:93-95` | **Fix now** (tidy) |
| P1 | Deploy-test stubbing diverged per story (`STUB_*` switches, `wrapDocker`, `dockerStubLines`, a `sed` shim); 11.7 unified most of it and made `deploy/pangolin` portable; `uninstall.test.ts` left as is. | 11.7 plan and triage | Accept |

### Patterns across the tickets' reviews (from the plans' triage logs)

| # | Pattern | Source | Lesson |
|---|---|---|---|
| L1 | Tests passing without exercising the real surface was the most common finding: 11.4's `getent` stub ignored the firewall (a high, the only review loop, a full re-plan); 11.1 never asserted kept secrets on the unsafe-root and no-answer paths; 11.9's fallback test ran with `--no-docker`; 11.10's no-bundle test passed without the fix; 11.2's S11a test had no timeout; 11.5's second run was unchecked; 11.7 never checked `.env` stayed 0600. | Each plan's Review Triage Log; 11.4 Plan Change Log | When a stub stands in for a system the change depends on (firewall, Docker, a terminal), the stub must model the dependency the change relies on; plans should say so in the Code Map. |
| L2 | Guards over-reaching against operator state: 11.5's drop-in removal on an unmounted same root (a high), 11.10's removal of an operator's allowlist line, 11.8's empty kept directory crowding out a real copy in pruning. | 11.5, 11.10, 11.8 triage | For any step that deletes, the plan names whose state it may touch and the test includes an operator-owned look-alike. |
| L3 | Oneshot plans kept no Verification section or Plan Change Log, so their checks live only in commit messages and this run. | 11.5–11.10 plans | Acceptable for small stories; the quick review still found a high (11.5). |
| L4 | CI failed once on the 11.3 merge on an app timing test it did not touch, then passed. | CI run on the 11.3 merge (`server.test.ts`, 5002 ms) | A flaky app test; worth a look with the restic timing test that fails locally. |

## Behavior verification

Runtime behaviour was **not exercised end to end by this retrospective**; nothing was run on a host here. What exists:

- CI on develop is green through `64ac5e6` (run 37121966575), including the container and end-to-end jobs. Those do not exercise uninstall/reinstall, a resolver change, a rollback or a release.
- On `pang-dev`, during the epic: the confirm-bundle flow (story 1.17) was run by the user and `/healthz` returned `{"ok":true}`; the Docker Hub CloudFront allowlist issue was diagnosed and fixed live. Neither is a hardening story's behaviour.
**Dev-VM run (2026-10-04, `pang-dev`, by the user):**
- Release v0.1.2 (`845a24a`, run 37149617209) passed every gate: `publish` tagged `v0.1.2`, `v0.1` and `latest` and the release is Latest; `migrate-previous` migrated v0.1.1's database (8 → 8; integrity, manifest, schema ok); `upgrade-test` asserted `upgrade-copies/` is `0 700`.
- `sudo pangolin upgrade v0.1.2` succeeded. The installed command was the old `pangolin:local` one, so the pre-upgrade copy went to `/opt/pangolin` (F9 seen on a real host); the upgrade installed the v0.1.2 command. The user moved both old copies (one still 0755, from before story 1.15) into `/srv/pangolin/upgrade-copies/` by hand: root, 0700.
- Uninstall keeping the data, then reinstall: works; the same passkey signs in, and `sudo pangolin backup` pushed a new snapshot (`c8f431a0…`) with the kept restic password. As documented, the reinstall gave the existing bundle a new id, so the storage warning returned until it is confirmed. TOTP was not exercised.
- `pangolin status` on v0.1.2 shows the pending-jobs list (backlog story 4). One dead `backup-push` from 2026-10-02 17:01 predates the reinstall; the user confirmed it was a mistyped restic server URI at the time, not a defect.
- Not exercised anywhere: 11.1 uninstall-then-reinstall on a real host; 11.4's `nft add element` against real nftables and a real resolver change; 11.8's rollback with real containers; 11.6's tag rules on a real release (the latest tag, v0.1.1, predates the epic).

## Previous-retro follow-through

The previous retrospective is the epic 1 retrospective (`epic-platform-foundations-retrospective.md`), from whose action items this epic was cut. Epic 2 precedes this epic in build order but has not started and has no retrospective.

| # | Item (epic 1 retro) | Landed? | Evidence |
|---|---|---|---|
| 1 | Make the upgrade copy safe (S1–S3) | Yes | story 1.15, `daad9bd` |
| 2 | Decide the remedy for restore and credentials (S4) | Yes | story 1.16, `bc6ad85` |
| 3 | Protect secrets across uninstall and reinstall (S6) | Yes | story 11.1, `14ac270` |
| 4 | Give the AD-27 recovery-bundle warning an owner (R4) | Yes | story 1.17, `cf1548a`; confirmed on `pang-dev` |
| 5 | Add the previous-release migration test (R3) | Yes | story 1.18, `0aa0db4`; ran on v0.1.1 (7 → 8) |
| 6 | Order the release steps (R5) | Yes | story 1.18; `publish` needs every gate |
| 7 | Reconcile the spec and tickets (R1, R6, R7, R8) | Yes | `6f628ad` |
| 8 | Install hardening ticket (S7, S8, S9) | Yes | stories 11.3, 11.4, 11.5 |
| 9 | Check the suspected seams (S10, S11) | Yes | spike 11.2, findings note; follow-ups 11.8–11.10, backlog 1 (done), backlog 2 and 3 (open) |
| 10 | Candidate refactors (A1, A2) | Not landed (deferred by design) | Deferred to the next sweep; 11.7 took only this epic's items |
| Lesson | Make the deploy scripts and tests portable (GNU `sed`) | Yes | story 11.7, `deploy/pangolin:149`; 11 tests now pass on macOS |
| Lesson | Run the e2e suite before pushing a migration | No evidence found | no migration landed in this epic |
| Lesson | Docker Hub pull retry or mirror in CI | Not landed | no change to `ci.yml`'s pulls |

## Action items

1. **Fix F1 (fix now, dev loop).** A reinstall over kept data with a changed backup server must write a bundle: treat "no `.env`, kept secrets, non-empty backup server" as a backup change, or have uninstall leave `.bundle-pending` when it keeps the secrets. Add the test. Owner: dev loop (a hardening follow-up story).
2. **Reconcile the spec and spine with the epic (S1; proposed, human applies).** Spine allowlist row (DNS to the host's resolvers), spine health/upgrade row and ops upgrade steps (kept `rolled-back-<stamp>/`), ops tagged-release steps (tag rules, concurrency, the third-tag limit), ops uninstall (secrets kept with the data). Owner: the user.
3. **Close the stale deferred-work entry (S2).** Add `disposition: fixed (story 11.6)` to the release-concurrency entry. Owner: the user or the next dev session.
4. **Show Done when 6 on a real host.** Cut the next release tag (exercising 11.6's rules and 1.18's gates), `pangolin upgrade` `pang-dev`, then on `pang-dev`: an uninstall keeping data and a reinstall (11.1), a resolver change and one timer run (11.4). Record the outcomes. Owner: the user.
5. **Track the deferred cross-ticket findings.** F2 (call the removal's reload `early`), F4 (keep `RESTIC_REPOSITORY` in a bundle written with an emptied server), F5 (record a previous data root for uninstall) into `deferred-work.md` or the backlog. Owner: the user decides; ticketing files them.
6. **Fix F7 (fix now, dev loop).** Copy the new `render.sh` (and units) before `write_allowlist` reloads the firewall, or defer that reload to `install_firewall`. Owner: dev loop.
7. **Fix F8 (fix now, dev loop; security).** Keep the pre-upgrade and rolled-back database copies on the data root (the LUKS disk), not under `/opt/pangolin`; migrate existing ones on the next upgrade. Owner: dev loop.
8. **Fix F13 (fix now).** Correct the `release.yml` comment: delete and re-push the tag, or re-run the cancelled run. Owner: dev loop.
9. **Track F9–F12, F14** alongside F2, F4, F5 (item 5). Owner: the user decides; ticketing files them.
10. **Accepted, recorded so later retros stop re-flagging:** the DNS widening to the host's resolvers (human decision, option b, 2026-10-03; the lenses flagged it as a DHCP-controlled egress channel); `latest` decided from git tags (documented in 11.6); deploy-file versions mixed between the pinned image and the checkout beyond compose.yaml and the CLI.
11. **Process (L1, L2).** In plans that stub a system the change depends on, state what the stub must model; for deleting steps, name whose state may be touched and test an operator-owned look-alike. Owner: next epic's planning.

Items 2, 4 and 10 are for the human; 1, 3, 5–9 are proposed remediation for the dev loop.

## Acceptance verdict

**Verdict: accepted-with-open-items (human decision, 2026-10-04), criteria declared.** The machine verdict was rejected (not accepted): Every ticket is finished, but Done when 6 is not met and Done when 1 is only partly met in the evidence. No human decision has been recorded yet; a human decision overrides this.

| Done when | Status | Evidence |
|---|---|---|
| 1. Uninstall keeping data, then install.sh, keeps TOTP and restic working; refuses new secrets over a database | Met (TOTP not exercised) | Tests show identical secret files and the refusal (`check_secrets_for_database`, `install.sh:781`); working TOTP and restic need a real host. F1 and F12 are gaps on the same path. |
| 2. A resolver change: re-render restores egress; no empty ruleset saved | Met in tests | Stub `nft`/`getent` modelling the firewall (11.4 loop 1); never run against real nftables |
| 3. Interrupted first install shows the bundle notice; bundle rewritten when backups are added; data-root change warns, no stale drop-in | Met in tests | 11.3 (a real interruption in tests), 11.5 |
| 4. An older-line patch does not move `latest`; two release runs never publish at once | Met in tests, with a documented limit | `release-tags.sh` tests, `release.yml` concurrency; GitHub cancels a third waiting run (11.6 triage) |
| 5. Every S10/S11 seam has a verdict; deploy/ ones fixed here, others in the backlog | Met | Findings note; 11.8–11.10; backlog 1 done, 2 and 3 open |
| 6. Release install.sh and uninstall.sh run on the dev VM (uninstall-reinstall, a resolver change); CI green on the release tag | Partly (resolver change deferred) | v0.1.2 released green (run 37149617209); on `pang-dev`: upgrade, uninstall keeping data and reinstall, passkey sign-in and a new backup (Behavior verification); the resolver change was deferred by the user |

Accepting the epic needs either action item 4 carried out, or a human decision accepting the epic without it (as epic 1's deviations were accepted).

**Human decisions (2026-10-04):** after the dev-VM run, the user deferred the resolver-change check and accepted the epic with open items: the deferred findings in `deferred-work.md`, the resolver-change check on a real host, and the open backlog items (bug 2, spike 3, story 5).

**Human decisions (2026-10-03):** hold the verdict; the user runs the dev-VM checks (action item 4) next. F1, F7 and F8 (with the F13 comment) are fixed now as story 11.11. The deferred findings F2, F4, F5, F9–F12 and F14–F19 go to `deferred-work.md`.

## Open questions

1. Accept the epic now with Done when 6 outstanding (and F1 as a fix-now follow-up), or hold the verdict until a release is cut and the dev-VM checks in action item 4 are run?
2. Should F1, F7 and F8 be fixed before epic 2 starts, as a small hardening follow-up story? F8 puts plaintext database copies on the unencrypted system disk.
3. F2, F4, F5: deferred-work entries, or backlog tickets?
