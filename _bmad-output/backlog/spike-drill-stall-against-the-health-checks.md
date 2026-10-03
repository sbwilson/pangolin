---
id: 3
type: spike
title: "Does the monthly drill's integrity_check stall the server past its health checks?"
parent: none
covers: []
after: []
assignee: ""
refined: false
hitl: false
risk: medium
estimate: ""
---

# Does the monthly drill's integrity_check stall the server past its health checks?

## Description

While the monthly restore drill runs `PRAGMA integrity_check` on the main thread, HTTP and `/healthz` stop answering (4.3 s at 465 MB in spike 11.2); does that, at multi-GB database sizes, fail Docker's health check or an upgrade's health wait?

## Approach

Time `integrity_check` on generated databases of growing size (for example 1, 2 and 5 GB) and measure how long `/healthz` stops answering while the drill runs. Compare with Docker's health check (3 s timeout, 10 s interval, 3 retries) and the 60 s upgrade health wait. A good-enough answer is a recorded timing per size and a verdict: leave it, or move the drill's check off the main thread (a worker, as the snapshot does), with a follow-up ticket if so. Time box: one session.

## References

- findings — _bmad-output/initiative-pangolin-money-v1/epic-platform-hardening/spike-check-the-suspected-seams-findings.md, section 3 (S11b)
