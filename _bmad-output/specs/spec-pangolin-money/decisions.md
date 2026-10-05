# Decisions

All are settled.

| Decision | Choice |
| --- | --- |
| Repo | Private GitHub repo; images pulled with a read-only token |
| Exposure | Public domain through our Nginx Proxy Manager (Let's Encrypt); Tailscale-only is deferred to the next version |
| Host | Debian 13 VM on Proxmox, LUKS data disk unlocked by Clevis + Tang; Ubuntu and Rocky Linux also supported |
| Backups | restic REST server on TrueNAS, append-only |
| Account recovery | Recovery codes and partner-assisted reset |
| Savings | Balance of accounts flagged as savings (personal and shared); investments tracked separately |
| Goal priorities | Staged allocation; a completed goal is flagged, its share rescaled, and we're prompted to review |
| Overspending periods | Option A: draw down the buffer only, with an over-committed warning; a shortfall or large purchase is covered by a user-confirmed drawdown (2026-10-05) |
| Mortgage | ~~Repayments as a simple expense; the property view links rent to repayments and shows gearing~~ Superseded by Property (2026-10-05) and Loan interest (2026-10-05) |
| Shared spending | Beneficiary per split; shared costs apportioned by each person's contribution (50/50 as a setting) |
| Privacy | Private accounts (owner only); hidden transaction names in shared accounts for up to 12 months |
| Categories | Sensible Australian default set, fully editable |
| History | From 1 July 2024 |
| Currency | Currency-agnostic ledger, single base currency (AUD) in v1 |
| Pay cycles | Separate anchor per person; shared budgets use a household anchor |
| Partner settlement | v1.1 |
| CommBank format | OFX primary; CSV and QIF supported |
| ASX prices | Yahoo Finance primary, issuer NAV fallback, manual override |
| Betashares Direct | Manual entry in v1; statement parsing in a later version |
| LLM providers | Ollama by default; any OpenAI- or Anthropic-compatible endpoint with an optional key |
| Up | API dropped; one-off CSV history import before the account closes |
| Name | Pangolin Money |
| Host hardening (2026-10-03) | Outside the application. Host hardening and the network tunnel to the NAS are the operator's concern, not requirements of this app |
| Recovery notice (2026-10-03) | In-app notice only in this version; email notification is deferred to the next version |
| Outbound allowlist (2026-10-03) | The firewall `install.sh` generates is the only enforcement in this version; an in-app check and re-authentication to change the list are deferred to the next version |
| Import errors (2026-10-05) | CSV/OFX/QIF commit good rows and set aside unreadable rows; PDF stays all-or-nothing |
| AI row reading (2026-10-05) | `row_interpret` is local by default, cloud only if explicitly enabled, never for a private account's rows; proposes only |
| Import for partner (2026-10-05) | Hand-off, never direct |
| Loan interest (2026-10-05) | User-entered per period; only automatic splitting is a non-goal |
| Lender repayment-plan import (2026-10-05) | Deferred to later work; the schedule is estimated from terms |
| Property (2026-10-05) | Moves to the loans-and-property epic (reverses 2026-09-27); net cash excludes principal |
| Home buying plans (2026-10-05) | Shared, public data only; store typed inputs plus a headline snapshot, recompute the rest |
| Themes (2026-10-05) | Six, per person, light/dark/system |
| Accessibility (2026-10-05) | WCAG 2.2 AA floor |
| Goal kinds (2026-10-05) | Flexible or Protected; one emergency fund per pool |
| Cover an expense (2026-10-05) | Large purchase draws the emergency fund, then Flexible, then Protected (warned); shortfall draws Flexible, then the emergency fund, then Protected (warned); split proposed by Pangolin, adjusted by us; one pool; audited; undoable. Replaces push-out (D2) |
| Large withdrawal (2026-10-05) | A savings withdrawal at or above the pool threshold raises a review item |
| Shortfall buffer divert (2026-10-05) | Kept as an alternative when the stage gives the buffer a share (D8) |
| Hidden rows and search (2026-10-05) | A hidden-name row is excluded from the partner's search entirely, not only its name |

## Periods where spend exceeds income: option A chosen

| Option | How it works | For | Against |
| --- | --- | --- | --- |
| A. Buffer only | The deficit draws down the unallocated buffer; goals are untouched | Goals never go backwards; simplest | Once the buffer is empty, goal balances can add up to more money than we actually have |
| B. Pro-rata from goals | The deficit reduces every goal by its share | Goals always reconcile to reality | One lumpy fortnight (annual insurance, a car repair) knocks the house deposit backwards; noisy |
| C. Carry forward | The deficit is recorded and repaid from the next surpluses before anything is allocated. A check warns if goal balances exceed actual savings | Goals stay stable, the shortfall stays visible, and there's a built-in reality check | Allocations pause until the deficit is repaid; slightly more logic |

- Chosen: **A** — a deficit draws down the unallocated buffer only (see `budgets-goals-forecasting.md` for the reconciliation invariant this feeds). Goal balances never decrease because of overspending, except by an explicit, user-confirmed drawdown (Cover an expense, 2026-10-05).

## Data sources in v1

| Source | Method |
| --- | --- |
| CommBank | OFX preferred (stable transaction IDs); CSV and QIF also supported |
| ubank | CSV / statement export |
| Up (history only) | CSV export taken before the account closes |
| Any bank or broker statement | PDF, extracted by the LLM and checked against the statement's opening and closing balances |
| Betashares Direct | Manual holdings + public prices (statement parsing in a later version) |
| CMC Invest | Trade confirmations CSV |
| QSuper, Aware Super | Units held × published daily unit price; contributions entered or imported from statements |
