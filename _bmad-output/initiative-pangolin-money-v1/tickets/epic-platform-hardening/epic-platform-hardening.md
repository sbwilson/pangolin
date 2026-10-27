---
type: epic
title: "Platform hardening"
parent: initiative-pangolin-money-v1
covers: [CAP-16, CAP-15]
after: []
assignee: ""
risk: high
---

# Platform hardening

## Description

Closes the install, uninstall and release findings that the epic 1 retrospective deferred, so a household can reinstall, have its DNS resolvers or data root change, and receive releases without silent breakage. It also checks the suspected seams nobody has run yet, and gives each a verdict.

## Outcome

Reinstalling, changing hosts' settings and cutting releases never silently break sign-in, backups or egress; the dev VM run of the release's install and uninstall scripts is the signal.

## Requirements

Source: the epic 1 retrospective findings (References). Each line maps to CAP-16; H1 also to CAP-15.

- H1 (S6): an uninstall that keeps the data never leaves a reinstall generating new secrets over it, which would silently break TOTP, the restic repository and the app key.
- H2 (S7): the recovery bundle notice is not lost when a first install dies after secret generation, and a bundle written before backups were configured is rewritten with `RESTIC_REPOSITORY` once they are.
- H3 (S8): changed DNS resolvers never leave an empty allowlist ruleset that blocks all egress.
- H4 (S9): changing `--data-root` removes the stale `RequiresMountsFor` drop-in and warns before the app starts on an empty database.
- H5 (deferred from story 1.18): `latest` and `vX.Y` only move forward, and release runs for two tags never publish at once.
- H6 (S10, S11): each suspected seam is run and gets a verdict, real or not real.

## Done when

1. Uninstalling with the data kept, then running `install.sh`, keeps TOTP sign-in and the restic repository working; `install.sh` refuses to generate new secrets over an existing database.
2. With the resolver IPs changed, re-rendering the firewall restores egress, and an empty ruleset is never saved.
3. A first install interrupted after secret generation shows the bundle notice on its re-run; a bundle written without `RESTIC_REPOSITORY` is rewritten once backups are configured; changing `--data-root` warns and leaves no stale drop-in.
4. A patch release on an older line does not move `latest`, and two release runs never publish at once.
5. Every S10 and S11 seam has a recorded verdict; each real one in `deploy/` is fixed in this epic, and each elsewhere is a backlog ticket.
6. The release's `install.sh` and `uninstall.sh` are run on the dev VM (uninstall keeping data then reinstall, and a resolver change), and CI is green on the release tag.

## Boundaries

`deploy/` (install.sh, uninstall.sh, the firewall) and `.github/workflows/release.yml`, plus running the S10 and S11 checks. Fixes for real seams in app code (`apps/server`, `packages/app`) go to the backlog, not here. Not new features, not the Caddy and Tailscale proxy modes (deferred to the next version), not the install.sh and App.tsx refactors (retro A1 and A2).

## References

- parent — _bmad-output/initiative-pangolin-money-v1/initiative-pangolin-money-v1.md
- retrospective — _bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/epic-platform-foundations-retrospective.md, findings S6 to S11 and action items 3, 8 and 9
- deferred — _bmad-output/implementation-artifacts/deferred-work.md, the release concurrency entry from story 1.18
- ops — _bmad-output/specs/spec-pangolin-money/deployment-and-ops.md, Install and upgrade, CI/CD
- security — _bmad-output/specs/spec-pangolin-money/security-and-recovery.md

## Notes

- Decision (2026-10-03): placed after epic 2 in build order, as the retrospective proposed; entry 1 (S6) goes first.
- Decision (2026-10-03): when the data is kept, `uninstall.sh` keeps the secrets too.
- Decision (2026-10-03): the spike inserts a story before the refactor sweep for each real seam in `deploy/`, and the sweep then waits on it too; real seams in app code become backlog tickets.
- Decision (2026-10-03): the install hardening finding is split three ways (entries 3, 4 and 5) to keep each to one session. There is no tracer bullet: every entry hardens a path that already exists.
- Decision (2026-10-03): reconciling the ops spec and the spine with the release-only migration check is left to the spec reconciliation chore, not this epic.
- Waits on epic 1 because: it hardens epic 1's install, uninstall, firewall and release workflow.
- Decision (2026-10-03): spike 11.2 found S11d, S11e and S11f real and S11c real but harmless; entries 8, 9 and 10 fix them before the refactor sweep, with S11c folded into S11f's entry (10). The app-code seams S10 and S11a, and the unverified drill stall, are backlog tickets 1 to 3.
