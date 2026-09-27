---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: unclear intent — "epic 1" names an epic that has no tickets yet, and its inception is gated on an unresolved question.

## Details

- Invocation: `/bmad-build-auto epic 1`
- Resolved to: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations` (id 1, "Platform foundations", milestone M0).
- `tickets.py status` reports 0 tickets in the initiative. Epic 1 has no story, spike or bug entries, so there is no single buildable ticket. This workflow builds one ticket per invocation and does not slice epics.
- The epic's Notes record an open question that blocks inception: the architecture spine (bmad-architecture, still pending) must first settle (a) the job table/runner contract and (b) the seed-generator extension format. The initiative Notes also list the `visibleAccounts()`/`redact()` contract and the period/FY helpers as spine items.
- The epic as a whole spans several goals that could each ship on their own: repo scaffold and CI, install.sh and the pangolin CLI, passkey auth and recovery, service layer and audit_log, job runner, seed generator, mock servers, backup/restore, and cosign signing. Building all of it in one unattended pass would mean inventing contracts the spine is supposed to decide.

## Unresolved questions

1. What contract does the job table and runner follow (schema, claim/lease semantics, retries)? This is for the architecture spine to decide.
2. What is the seed-generator extension format that later epics plug into? This is also for the spine.

## Suggested next steps

1. Run `bmad-architecture` to write the architecture spine that settles the contracts above, then cite it in the epic's References.
2. Run `bmad-preview-ticketing` to break epic 1 into stories ("break this into stories").
3. Set `modules.bmm.active_initiative` in `_bmad/custom/config.user.toml`, or pass the initiative folder, so `tickets.py` can resolve refs.
4. Re-run `/bmad-build-auto ticket 1.1` (or a later story) one ticket at a time.
