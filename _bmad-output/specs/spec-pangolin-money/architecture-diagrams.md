# Architecture diagrams

## System architecture

![One app process owns the database](system-architecture.png)

```mermaid
flowchart LR
  B[Browser or phone<br/>React PWA] --> P[Reverse proxy<br/>NPM, or Caddy]
  subgraph App[App container - Node]
    A[API and login<br/>Hono, better-auth]
    D[Domain services<br/>import, rules, budgets]
    J[Job runner<br/>prices, LLM queue, backups]
  end
  P --> A
  D --> S[(SQLite WAL<br/>source of truth)]
  S --> K[Backups<br/>restic to TrueNAS]
  J --> L[LLM endpoint<br/>OpenAI- or Anthropic-style API]
  J --> R[Price pages<br/>ASX, unit prices]
```

One app process owns the database; everything else goes through it. Only the job runner makes outbound calls, and only to an allowlist.

## Milestones

![Each milestone ends at a gate we can check](milestones.png)

See the milestones table in `deployment-and-ops.md` for the text of each milestone and gate.
