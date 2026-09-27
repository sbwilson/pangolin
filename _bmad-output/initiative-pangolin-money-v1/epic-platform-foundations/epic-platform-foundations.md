---
type: epic
title: "Platform foundations"
parent: initiative-pangolin-money-v1
covers: [CAP-16, CAP-15]
after: []
assignee: ""
risk: high
---

# Platform foundations

## Description

The repo, CI, install script, passkey login, seed data, mock LLM server, nightly encrypted backup and automated restore test all exist before any finance feature is built. Retrofitting security, backups and CI is where self-hosted projects go wrong, so they come first. Milestone M0.

## Outcome

We can install, log in, back up and restore with confidence before any real data arrives. This is the M0 gate.

## Done when

1. On a fresh Debian 12 VM, `install.sh` goes from nothing to the one-time setup link, and then to a passkey login, in one command. (M0 gate)
2. CI backs up and restores a synthetic database on every release. The restore verifies integrity_check, row counts and balance sums. (M0 gate)
3. Registration closes once both partners exist. Recovery codes and partner-assisted re-enrolment each restore access in a test, and the partner reset link expires after 24 hours.
4. `pangolin upgrade` rolls back automatically when a seeded health check fails. The release image is signed with cosign, and the signature is verified before the image is pulled.
5. The app container runs non-root and read-only. The VM firewall allows inbound traffic only from NPM and outbound traffic only to the allowlist.
6. `install.sh` produces the recovery bundle, and CI restores onto a clean host from the bundle alone, decrypting a sample attachment and logging in with TOTP (spine AD-27).
7. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

Platform baseline: repo scaffold (pnpm workspace per tech-stack.md), CI/CD, deploy/ (compose, install.sh, pangolin CLI), auth and recovery, the service layer with audit_log, the job runner, the admin socket, shared/period (calendar and FY maths, spine AD-14), the seed generator skeleton and the mock servers. No finance tables beyond `person`, `household_settings` and `job`. Owns touch points NPM, TrueNAS restic, Tang and GHCR.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-15 and CAP-16
- ops — _bmad-output/specs/spec-pangolin-money/deployment-and-ops.md, all sections
- security — _bmad-output/specs/spec-pangolin-money/security-and-recovery.md
- stack — _bmad-output/specs/spec-pangolin-money/tech-stack.md, sections Tech stack and Repo layout
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-1, AD-2, AD-6, AD-8, AD-9, AD-14, AD-15, AD-16, AD-17, AD-27, and Consistency Conventions

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
