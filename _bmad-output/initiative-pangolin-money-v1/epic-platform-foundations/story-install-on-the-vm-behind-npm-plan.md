---
title: 'Install on the VM behind NPM'
type: 'feature'
ticket: '8'
created: '2026-09-27'
status: 'draft'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-pangolin-money/deployment-and-ops.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app runs only as a local, CI-oriented Compose stack. There's no way to install it on the Debian VM: no production Compose file, no generated secrets or recovery bundle, no NPM guidance, no egress allowlist or firewall, and no `/healthz` for upgrades and monitoring. That makes the M0 gate "fresh install to first login in one command" impossible.

**Approach:**
- Add `deploy/` with a production `compose.yaml`: non-root, read-only root, a data volume on the encrypted disk, a `/run` tmpfs for the future admin socket, and a health check.
- Add `deploy/install.sh`, idempotent and re-runnable:
  - detects the distro and installs Docker Engine;
  - asks for the proxy mode, public hostname and backup server;
  - generates secrets and a recovery bundle;
  - writes `.env`, the allowlist and the firewall rules, and starts the stack;
  - prints the NPM proxy-host settings and the one-time setup link.
- Add `GET /healthz`.

## Boundaries & Constraints

**Always:**
- **Host layout:**
  - `/opt/pangolin/` holds `compose.yaml`, `.env` (0600) and `allowlist.conf`.
  - Secrets live in `/opt/pangolin/secrets/` (0700, files 0600): `auth-secret`, `app-key` (32 random bytes, base64) and `restic-password`.
  - Data lives in `PANGOLIN_DATA_ROOT`, default `/srv/pangolin`, bind-mounted to `/data`. The container gets `PANGOLIN_AUTH_SECRET_FILE` pointing at the mounted `auth-secret`.
- **Idempotent:** a re-run never regenerates an existing secret, and never overwrites `.env` values the operator has changed. It only adds missing keys, then restarts the stack.
- **Prompts:** proxy mode, public hostname (becomes `PANGOLIN_PUBLIC_URL=https://<host>`), backup server (a restic REST URL, stored and allowlisted only; backups themselves are story 1.10), the NPM host IP (inbound allow, `PANGOLIN_TRUSTED_PROXIES`), the admin SSH network, and an optional GHCR read-only token (`docker login ghcr.io`). Every prompt also has a flag, so a `--non-interactive` run is possible.
- **Recovery bundle (AD-27):**
  - written to `/root/pangolin-recovery-bundle-<date>.txt` (0600), holding the app key, auth secret and restic password;
  - the install prints its path and tells you to store it offline and then delete it;
  - it is re-created only when you pass `--bundle`.
- **Allowlist:**
  - `allowlist.conf` is one `host[:port]` per line, with `#` comments. It is the single config artefact the spine requires.
  - Its defaults: Debian mirrors (`deb.debian.org`, `security.debian.org`), Docker (`download.docker.com`), GHCR (`ghcr.io`, `pkg-containers.githubusercontent.com`), the NTP pool, the backup server, and the Yahoo Finance hosts including the cookie/crumb handshake (`query1.finance.yahoo.com`, `query2.finance.yahoo.com`, `fc.yahoo.com`).
  - The LLM endpoint is left for epic 5.
- **Firewall:** generated only from `allowlist.conf` and the prompts, using the mechanism in Decisions.
  - Inbound: the app port from the NPM host only, and SSH from the admin network only.
  - Outbound: allowlisted hosts only, plus DNS to the configured resolvers.
  - Both apply to container traffic as well as host traffic.
- **`GET /healthz`:**
  - Returns 200 `{ "ok": true }` only when every migration is applied, the database is writable, and the job runner is running and has ticked within 3× its poll interval (demo mode skips the runner check). Otherwise 503 `{ "ok": false, "failing": [<names>] }`.
  - No auth, no details beyond the failing check names.
  - The production compose `healthcheck` uses it.
- **Distros:** Debian 12/13 is the proven path. The Ubuntu 24.04 (apt) and Rocky 9 (dnf, SELinux `:Z` labels, firewalld) paths are written but marked unproven.
- **Checks and warnings:** `install.sh` checks the host requirements and warns, never fails, on: RAM, disk, the data root not on a dm-crypt device, LXC instead of a VM, and a missing AES-NI flag.
- **Shell:** POSIX `sh`, shellcheck-clean, `set -eu`. Secrets are never echoed, except the bundle path and the setup link.

**Decisions (2026-09-27):**
- **Firewall: nftables inside the VM, plus printed Proxmox rules.**
  - `install.sh` installs and enables an nftables ruleset. It covers host traffic (`input`/`output`) and container traffic, the latter by hooking Docker's forward path (the `DOCKER-USER` chain via `iptables-nft`) so containers get the same egress allowlist.
  - Allowlisted hostnames are resolved to IPs into nft sets, refreshed every 15 minutes by a systemd timer (`pangolin-allowlist.timer`). DNS is allowed only to the configured resolvers.
  - It also prints the equivalent IP-based Proxmox VM firewall rules, as an optional second layer the operator pastes in.
- **Proxy mode: NPM only.** The prompt offers bundled Caddy and Tailscale-only, answers "not yet supported" for them, and stops without changing anything.
- **Image: `--image <ref>` and `--build`.** `--image` defaults to `ghcr.io/sbwilson/pangolin:latest`, with the optional GHCR token used for `docker login`. `--build` clones the repo at `--ref` (default `main`) into `/opt/pangolin/src` and builds the image locally as `pangolin:local`. Signature verification comes with story 1.11.
- **Disk encryption: documented, not automated.** `docs/install.md` gives the exact LUKS and Clevis/Tang commands, and `install.sh` warns loudly when the data root isn't on a dm-crypt device. `install.sh` never formats or binds disks.

**Never:**
- No `pangolin` CLI or admin socket (story 1.9).
- No backups, restic runs or restore (story 1.10).
- No release, cosign verification or `pangolin upgrade` (story 1.11).
- No LUKS formatting or Clevis binding by `install.sh`.
- Never weaken the image's non-root, read-only posture.
- Never put a secret in `compose.yaml`, or in any file other than `.env`/`secrets/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh install | Debian, answers given | Docker installed, files written with the right modes, stack healthy, NPM settings and setup link printed | — |
| Re-run | installed, operator edited `.env` | secrets unchanged, edits kept, missing keys added, stack restarted | — |
| Not root | run as a normal user | — | exits 1 with a clear message |
| Unsupported distro | e.g. Alpine | — | exits 1 naming the supported ones |
| No encryption | data root on a plain disk | install proceeds | loud warning |
| Unhealthy start | `/healthz` not ok within 90 s | — | prints the container logs' last lines and exits 1 |
| Existing user | a login already exists | setup link section says an account exists instead | — |
| `/healthz` degraded | runner stopped, or DB read-only | 503 with the failing names | — |

</frozen-after-approval>

## Code Map

- `.github/workflows/release.yml`: already uploads `deploy/install.sh` as a release asset and passes `PANGOLIN_VERSION` as a build argument. The `Dockerfile` does not declare `ARG PANGOLIN_VERSION`; add it and expose it as `ENV`.
- `compose.yaml` (root): the local and CI stack. Keep it, and point its comment at `deploy/compose.yaml`.
- `Dockerfile`: `node:26-trixie-slim`, `USER node`, `VOLUME /data`, `HEALTHCHECK` on `/api/system/health`. Switch the check to `/healthz`.
- `apps/server/src`:
  - `config.ts`: the env schema, including `PANGOLIN_AUTH_SECRET_FILE`, `PANGOLIN_TRUSTED_PROXIES` and `PANGOLIN_PUBLIC_URL`.
  - `admin/setup-link.ts` writes `<dataDir>/setup-link.txt` and removes it once a login exists.
  - `jobs/runner.ts`: `createRunner` with `start`/`stop`/`tick`. Expose its last-tick time for `/healthz`.
  - `http/app.ts`: `/api/system/health`. Add `/healthz` beside it; it is public and outside `/api`, so it bypasses the session and Origin checks.
- `packages/app/src/system/health.ts` and the `SystemHealthPort`: reuse them for the migration and writable checks.
- `.github/workflows/ci.yml`:
  - the shellcheck step (add `deploy/*.sh`);
  - the container job's health waits (move to `/healthz`);
  - the demo-boot step.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/server/src/http/app.ts`, `jobs/runner.ts`, `server.ts` + tests -- `/healthz` with per-check failure names; the runner's `lastTickAt` -- health for install and upgrade
- [ ] `Dockerfile` -- `ARG`/`ENV PANGOLIN_VERSION`, `HEALTHCHECK` on `/healthz` -- release parity
- [ ] `deploy/compose.yaml` -- image from `${PANGOLIN_IMAGE}`, `env_file: .env`, `read_only`, `init`, `/tmp` and `/run` tmpfs, the data bind mount, the secrets mount (read-only), port bound to `0.0.0.0:3000` (the firewall restricts it), `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, health check, restart policy -- the production stack
- [ ] `deploy/allowlist.conf.default` -- the default allowlist with comments -- egress config artefact
- [ ] `deploy/install.sh` -- the full install flow above, split into functions -- the one-command install
- [ ] `deploy/firewall/{render.sh,pangolin-allowlist.service,pangolin-allowlist.timer}` -- render the nftables ruleset (host + `DOCKER-USER`) from `allowlist.conf` and the prompts; resolve hostnames into nft sets; a systemd timer refreshes the sets every 15 min; also render the Proxmox rules text -- inbound and outbound enforcement
- [ ] `vitest.config.ts`, `tsconfig.json` (root) -- add `deploy` to the Vitest `include` glob and the root typecheck `include`, so `deploy/*.test.ts` runs and is typechecked -- otherwise the install tests never run
- [ ] `deploy/install.test.ts` (Vitest, spawns `sh`) -- `--non-interactive --root <tmp> --no-docker` writes the expected files and modes; a re-run keeps secrets and edits; the firewall output from a fixture allowlist; the failure modes in the matrix -- automated coverage without a VM
- [ ] `docs/install.md`, `README.md` -- the VM prerequisites (LUKS plus Clevis/Tang steps), the install, NPM settings, what the bundle is -- the operator guide
- [ ] `.github/workflows/ci.yml` -- shellcheck `deploy/*.sh`; the container job waits on `/healthz`; `docker compose -f deploy/compose.yaml config` validates -- CI

**Acceptance Criteria:**
- Given a fresh Debian 13 VM with its data disk LUKS-unlocked by Clevis and Tang, when `install.sh` runs once with answers, then it ends printing NPM settings and a setup link, and that link opens the setup page through NPM over https.
- Given the installed VM, when `/healthz` is requested through NPM, then it returns 200 `{ "ok": true }`.
- Given the firewall, when an outbound connection is attempted from inside the container to a host not on the allowlist, then it fails. Allowlisted hosts succeed, and the app port is unreachable from anything but the NPM host.


## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

**Why `/healthz` sits outside `/api`:** NPM, Docker and the future `pangolin upgrade` probe it with no session or Origin, and it must reveal nothing but check names.

**How install is tested without a VM:** `install.sh` takes `--root` (prefix every path), `--no-docker` and `--non-interactive`, so the Vitest suite exercises file generation, modes, idempotency and firewall rendering. Proving the real install needs your VM, which is this ticket's human-in-the-loop part.

## Verification

**Commands:**
- `pnpm lint && pnpm typecheck && pnpm test` -- expected: all green, including `deploy/install.test.ts` and the `/healthz` tests
- `shellcheck -S warning deploy/*.sh deploy/firewall/*` -- expected: clean
- `docker compose -f deploy/compose.yaml --env-file <generated .env> config` -- expected: valid

**Manual checks (if no CLI):**
- On the Debian VM: run `install.sh`, open the printed link through NPM, check `curl https://<host>/healthz`, and check the firewall with `curl` to an allowlisted and a non-allowlisted host from inside the container.
