# Decisions

All are settled.

| Decision | Choice |
| --- | --- |
| Repo | Private GitHub repo; images pulled with a read-only token |
| Exposure | Public domain through our Nginx Proxy Manager (Let's Encrypt); Tailscale-only remains an option |
| Host | Debian VM on Proxmox, LUKS data disk unlocked by Clevis + Tang; Ubuntu and Rocky Linux also supported |
| Backups | restic REST server on TrueNAS, over WireGuard, append-only |
| Account recovery | Recovery codes and partner-assisted reset |
| Savings | Balance of accounts flagged as savings (personal and shared); investments tracked separately |
| Goal priorities | Staged allocation; a completed goal is flagged, its share rescaled, and we're prompted to review |
| Overspending periods | Option A: draw down the buffer only, with an over-committed warning |
| Mortgage | Repayments as a simple expense; the property view links rent to repayments and shows gearing |
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

## Periods where spend exceeds income: option A chosen

| Option | How it works | For | Against |
| --- | --- | --- | --- |
| A. Buffer only | The deficit draws down the unallocated buffer; goals are untouched | Goals never go backwards; simplest | Once the buffer is empty, goal balances can add up to more money than we actually have |
| B. Pro-rata from goals | The deficit reduces every goal by its share | Goals always reconcile to reality | One lumpy fortnight (annual insurance, a car repair) knocks the house deposit backwards; noisy |
| C. Carry forward | The deficit is recorded and repaid from the next surpluses before anything is allocated. A check warns if goal balances exceed actual savings | Goals stay stable, the shortfall stays visible, and there's a built-in reality check | Allocations pause until the deficit is repaid; slightly more logic |

- Chosen: **A** — a deficit draws down the unallocated buffer only (see `budgets-goals-forecasting.md` for the reconciliation invariant this feeds).

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
