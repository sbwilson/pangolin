---
id: 5
type: story
title: "install.sh checks the backup server is reachable"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: low
estimate: ""
---

# install.sh checks the backup server is reachable

## Description

`install.sh` accepts any well-formed `rest:` URL for `--backup-server` (or at the prompt) without checking that it reaches a restic REST server, so a mistyped URI only shows up later as a dead `backup-push` job. It should check the repository when the backup server is set or changed, after the firewall allows its host, the way `pangolin restore` already does (`checkRepositoryReachable` in `apps/server/src/backup/reachable.ts`), and warn with the URL and the error when it cannot reach it, so the operator can fix it before the first nightly backup. The install continues either way: the server may simply be off.

## Notes

- Seen on `pang-dev`, 2026-10-02: a dead `backup-push` caused by a mistyped restic server URI (user, 2026-10-04).
- Open question: check from the host (curl to the REST endpoint) or from the app image (as `pangolin restore` does through the container).

## References

- code — apps/server/src/backup/reachable.ts, checkRepositoryReachable
- retrospective — _bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/epic-platform-hardening-retrospective.md, Behavior verification
