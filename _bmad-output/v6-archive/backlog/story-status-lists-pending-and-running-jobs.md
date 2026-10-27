---
id: 4
type: story
title: "pangolin status lists pending and running jobs"
parent: none
covers: []
after: []
assignee: ""
refined: true
hitl: false
risk: low
estimate: ""
---

# pangolin status lists pending and running jobs

## Description

`sudo pangolin status` shows only how many jobs are pending and running. It should also list them, as it lists dead jobs: pending jobs soonest first with their kind and when they are due, and running jobs with their kind and when their lease ends, capped at ten each with a "next 10 of N" header. Kind and time only, never a payload or error text (AD-9). CLI only; the web status page is unchanged.

## References

- spine — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-9
- request — the user, 2026-10-03: "show a list of the pending jobs when we run `sudo pangolin status`"
