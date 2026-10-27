---
id: 2
type: bug
title: "Status shows the snapshot's time after a restore"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: low
severity: P3
estimate: ""
---

# Status shows the snapshot's time after a restore

## Description

After `pangolin restore`, `pangolin status` prints the restore time as the last backup's "last at", while the stale-backup warning on the next line is judged on when the restored snapshot was taken. The two disagree. Status, and `/api/system/backup`, which shares `BackupStatus`, should show when the last backup's database was taken.

## Reproduction

Run the `it.fails` S10 test in `apps/server/src/cli.test.ts`: restore a snapshot taken five days earlier, then run `pangolin status`. "last at" shows the restore time, with the stale warning below it. Evidence is in the spike's findings, section 1.

## Cause Hypothesis

`printStatus` in `apps/server/src/cli.ts` prints the snapshot row's push time, which a restore sets to now, while staleness in `packages/app/src/system/backups.ts` uses `takenAt`.

## Acceptance Criteria

1. **Status shows when the database was taken**
   **Given** a restore of a snapshot taken five days ago
   **When** `pangolin status` runs and `/api/system/backup` is read
   **Then** both show the snapshot's `takenAt`, which agrees with the stale warning
2. **Tests cover the condition found and fixed**
   **Given** the test suite
   **When** it runs
   **Then** the S10 test runs as a normal `it` and passes, and a test of `/api/system/backup` after a restore shows the same time as the CLI
3. **Or: no change is needed, with proof**
   **Given** the reproduction
   **When** it is run on the current code
   **Then** the expected behavior already holds, with the evidence recorded in Notes — this supersedes 1 and 2

## References

- findings — _bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/spike-check-the-suspected-seams-findings.md, section 1 (S10)
