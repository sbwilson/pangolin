---
title: 'M0 gate rehearsal'
type: 'chore'
ticket: '13'
created: '2026-10-01'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The epic's seven Done-when items are each covered by CI or a past VM check, but nothing shows them together on the current code. No structured record exists, and the VM still runs v0.0.2, six commits behind `develop` (which has 1.12 and 1.14).

**Approach:** Write a rehearsal runbook with an evidence table (item, command, observed output, date, tag and image digest, CI run URL) in `docs/`, then the human runs it on the home server against a new release tag and records each result. The agent prepares the runbook and, afterwards, fills the record from output the human pastes in; the agent performs no VM action.

## Boundaries & Constraints

**Always:** A new release tag is cut from current `develop` and its Release run is green before the VM steps. Every Done-when item ends as demonstrated (with evidence), demonstrated in CI only (with the run URL), or explicitly not demonstrated with a reason. Commands run on the VM are given in full.

**Decisions (human, 2026-10-01):**
- Rehearse on whichever Debian the VM runs and record the version; no documents are amended for the 12/13 difference.
- Done when 6's sample-attachment decrypt is recorded as "not demonstrated, epic 5" and M0 closes without it.
- Done when 4's rollback is evidenced by the CI upgrade-test job (B to C); on the VM, show a successful upgrade and a refused unsigned or tampered tag. No one-off unhealthy image is built.
- The tag is `v0.1.0`, cut by the human.

**Never:** The agent does not cut the tag, touch the VM, or enter credentials. No code changes beyond the runbook. No claim of a pass without pasted output or a CI URL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Item demonstrated | Human pastes command output | Recorded with date, tag and digest | No error |
| CI-only item | Proof is a CI job (e.g. expiry of the 24 h link) | Recorded with the job name and run URL | Marked "CI only" |
| Item cannot be shown | No native VM support (attachment decryption, epic 5) | Recorded as not demonstrated, with reason and owner | Needs the human's acceptance |
| Step fails on the VM | Output differs from expected | Recorded as failed; the gate stays open and a bug is raised | Do not mark the story done |

</frozen-after-approval>

## Code Map

- `docs/m0-gate-rehearsal.md` -- new runbook and evidence table, one section per Done-when item (procedures from `docs/install.md` sections 4-11).
- `deploy/install.sh`, `deploy/pangolin`, `docs/install.md` -- source of the commands; do not change.
- `.github/workflows/release.yml`, `ci.yml` -- the CI jobs cited as evidence (container restore, bundle restore, upgrade-test, Playwright).
- Prior VM evidence is only commit messages (6f71b90, b88b8a7); this record replaces that practice.
- Prerequisites to list first in the runbook: VM with LUKS/Clevis/Tang, NPM with TLS, append-only restic REST server, GHCR access, a real browser and authenticator.

## Tasks & Acceptance

**Execution:**
- [ ] `docs/m0-gate-rehearsal.md` -- runbook: prerequisites, then items 1-7 each with exact commands, expected output and an evidence row to fill -- repeatable gate
- [ ] `docs/m0-gate-rehearsal.md` -- a results summary table with one of demonstrated / CI only / not demonstrated per item, and the tag, digest and CI run URL -- the M0 decision record
- [ ] (human) cut the tag, run the runbook on the VM, paste outputs; (agent) fill the record from them

**Acceptance Criteria:**
- Given the runbook, when the human runs items 1-7, then each has a recorded outcome with evidence or a stated reason.
- Given any item marked demonstrated, then its evidence row has the output and date, not just a tick.
- Given all items resolved, then the story is marked done only by the human.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Manual checks:**
- Every Done-when item in the epic maps to one runbook section and one row in the results table.
- `pnpm lint` passes (docs only).
