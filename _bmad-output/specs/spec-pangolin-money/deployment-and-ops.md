# Deployment, backups and CI/CD

The server runs one app container under Docker Compose, managed by the `pangolin` command. A bundled Caddy is deferred to the next version. Supported hosts start at Debian 13, then Ubuntu 24.04 LTS and Rocky Linux 9, on amd64 or arm64.

## Host: Debian VM on Proxmox

`install.sh` checks these requirements and warns if they're not met. The full step-by-step goes in `docs/install.md`.

| Resource | Minimum | Recommended |
| --- | --- | --- |
| Guest type | VM | VM, not LXC (better isolation, simpler disk encryption) |
| OS | Debian 13 | Debian 13 |
| vCPU | 1 | 2, CPU type `host` (exposes AES-NI for encryption) |
| RAM | 1 GB | 2–4 GB |
| System disk | 16 GB | 32 GB |
| Data disk (database, receipts, statements) | 10 GB | 50 GB, separate virtual disk |
| GPU | none | none; the LLM runs elsewhere |

## Configuration

- **Encryption:** encrypt the data disk with LUKS inside the VM. It unlocks at boot through Clevis + Tang: a small Tang server on another machine (e.g. an LXC or the TrueNAS box). The disk then unlocks only on the home network, so a stolen disk or VM backup stays locked. ZFS native encryption on the Proxmox pool is the alternative, but it needs a passphrase after every host reboot.
- **Firewall** (Proxmox VM firewall or nftables):
  - Inbound: only the NPM host to the app port, and SSH from the admin network.
  - Outbound: an allowlist only (price and unit-price hosts, the LLM endpoint, TrueNAS, Debian and Docker mirrors, GHCR).
- **Private repo:** the server pulls images from GHCR with a fine-grained, read-only token (packages: read), stored with the install's secrets.
- **Proxmox VM backups** (vzdump or PBS) are a useful extra. If you use PBS, turn on its client-side encryption. restic stays the source of truth for data.

## Install and upgrade

- `install.sh` detects the distro (apt or dnf) and installs Docker Engine from Docker's repository if it's missing. On Rocky it also sets SELinux volume labels and firewalld rules. It then asks three things: proxy mode, the public hostname, and the backup server. The existing NPM is the one proxy mode in this version; bundled Caddy and Tailscale-only are deferred to the next version. It then:
  - generates secrets (auth secret, encryption key file, restic password);
  - writes the Compose file and `.env`;
  - starts the stack and prints a one-time setup link for creating the first account. With NPM, it also prints the proxy-host settings to enter.
- `pangolin upgrade` performs these steps:
  1. pull the new signed image tag;
  2. snapshot the database;
  3. start the new version, which runs migrations inside a transaction;
  4. health-check it;
  5. on failure, roll back automatically to the previous image and snapshot.
- `pangolin backup`, `pangolin restore <snapshot>` and `pangolin status` cover the rest.

## Backups and restore

- Nightly: a consistent snapshot (`VACUUM INTO`) plus the attachments folder go to restic. The destination is restic's REST server running as a TrueNAS app, set to append-only. Contents are encrypted before they leave. Pruning runs on the TrueNAS side, so the app host can add backups but never delete them.
- Retention: 7 daily, 4 weekly, 12 monthly. `restic check` runs weekly.
- Restore goes into a fresh directory, then verifies before swapping in:
  - `PRAGMA integrity_check`;
  - row counts;
  - per-account balance sums against the backup's manifest.
- **Tested twice:**
  - CI backs up and restores a synthetic database on every release.
  - The server runs a monthly restore drill into a temporary directory and shows the result on the status page.

## CI/CD (GitHub Actions)

- **Every push:** Biome lint, type-check, Vitest unit tests, migration test, then Playwright end-to-end tests against the mock data.
  - The migration test applies all migrations to an empty database.
  - The release workflow also migrates the database the previous release's image creates (`migrate-previous`).
- **Tagged release:**
  1. build amd64 and arm64 images;
  2. generate a software bill of materials and run a vulnerability scan;
  3. sign with cosign;
  4. push to GHCR.
  - The upgrade command verifies the signature before pulling.
- Renovate opens dependency PRs weekly. `main` is protected and requires green CI.

## Synthetic data and offline CI

- A seeded generator produces a realistic two-person household as the files actually imported:
  - CommBank everyday, offset, home loan and credit card in OFX, CSV and QIF;
  - ubank and Up CSVs;
  - rendered PDF statements with known totals;
  - CMC confirmations and Betashares holdings;
  - QSuper and Aware unit-price histories.
- Mock price and unit-price servers, plus the mock LLM server (see `categorisation.md`), keep CI fully offline.
- The same seed drives local development, CI end-to-end tests and a demo mode, so no real data is ever needed outside the server.
- With no live bank API in v1, no mock banking endpoint is needed. The connector interface stays, so one can be added if a usable API appears.

## Milestones

Five milestones, each ending in a check that can actually be verified. Security, backups and CI come first, because retrofitting them is where self-hosted projects go wrong.

| Milestone | Scope | Gate |
| --- | --- | --- |
| M0 · Foundations | Repo, CI, Debian install script behind NPM, passkey login, seed data, mock LLM server; nightly encrypted backup and automated restore test | Fresh install to first login in one command; restore test passes in CI |
| M1 · Ledger and import | Accounts and ownership, OFX, CSV and QIF import, dedupe, transfer matching, privacy redaction; transaction list with filters, splits, tags, rules and the review inbox | 12 months of our real data imported with no unexplained balance gaps |
| M2 · Insight | Cash flow (Sankey, P&L by group or category), spending by any period, net worth; LLM categorisation (any OpenAI- or Anthropic-style provider), PDF statement import, merchant logos | We use it weekly instead of the spreadsheets |
| M3 · Planning | Fortnightly budgets with pace and projection, recurring bill detection and alerts; goals with percentage allocation rules, cash-flow and net-worth forecasts | One full budget cycle tracked for both of us |
| M4 · Wealth and tax | ETF events, lots and prices; super units, unit prices and contribution caps; tax pack per person per financial year, activities, receipts | — |

M1 is highlighted because it carries the most risk: if import, deduplication and transfer matching aren't trustworthy, every report built on them is wrong. It's worth spending disproportionate time there.

Partner settlement (who owes whom for shared costs paid from personal accounts) follows in v1.1, after M4.

Diagram: `architecture-diagrams.md`.
