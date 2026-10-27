---
title: 'Install on the VM behind NPM'
type: 'feature'
ticket: '8'
created: '2026-09-27'
status: done
baseline_revision: '6198edca77ca3f20bbfbb40657f36e16f6603fc4'
route: 'full'
route_source: 'auto'
review: 'thorough'
review_source: 'auto'
lenses_ran: [blind-hunter, edge-case-hunter, verification-gap, intent-alignment]
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
- [x] `apps/server/src/http/app.ts`, `jobs/runner.ts`, `server.ts` + tests -- `/healthz` with per-check failure names; the runner's `lastTickAt` -- health for install and upgrade
- [x] `Dockerfile` -- `ARG`/`ENV PANGOLIN_VERSION`, `HEALTHCHECK` on `/healthz` -- release parity
- [x] `deploy/compose.yaml` -- image from `${PANGOLIN_IMAGE}`, `env_file: .env`, `read_only`, `init`, `/tmp` and `/run` tmpfs, the data bind mount, the secrets mount (read-only), port bound to `0.0.0.0:3000` (the firewall restricts it), `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, health check, restart policy -- the production stack
- [x] `deploy/allowlist.conf.default` -- the default allowlist with comments -- egress config artefact
- [x] `deploy/install.sh` -- the full install flow above, split into functions -- the one-command install
- [x] `deploy/firewall/{render.sh,pangolin-allowlist.service,pangolin-allowlist.timer}` -- render the nftables ruleset (host + `DOCKER-USER`) from `allowlist.conf` and the prompts; resolve hostnames into nft sets; a systemd timer refreshes the sets every 15 min; also render the Proxmox rules text -- inbound and outbound enforcement
- [x] `vitest.config.ts`, `tsconfig.json` (root) -- add `deploy` to the Vitest `include` glob and the root typecheck `include`, so `deploy/*.test.ts` runs and is typechecked -- otherwise the install tests never run
- [x] `deploy/install.test.ts` (Vitest, spawns `sh`) -- `--non-interactive --root <tmp> --no-docker` writes the expected files and modes; a re-run keeps secrets and edits; the firewall output from a fixture allowlist; the failure modes in the matrix -- automated coverage without a VM
- [x] `docs/install.md`, `README.md` -- the VM prerequisites (LUKS plus Clevis/Tang steps), the install, NPM settings, what the bundle is -- the operator guide
- [x] `.github/workflows/ci.yml` -- shellcheck `deploy/*.sh`; the container job waits on `/healthz`; `docker compose -f deploy/compose.yaml config` validates -- CI

**Acceptance Criteria:**
- Given a fresh Debian 13 VM with its data disk LUKS-unlocked by Clevis and Tang, when `install.sh` runs once with answers, then it ends printing NPM settings and a setup link, and that link opens the setup page through NPM over https.
- Given the installed VM, when `/healthz` is requested through NPM, then it returns 200 `{ "ok": true }`.
- Given the firewall, when an outbound connection is attempted from inside the container to a host not on the allowlist, then it fails. Allowlisted hosts succeed, and the app port is unreachable from anything but the NPM host.


## Implementation Notes

- **`/healthz`:** the checks live in a new `app` use case, `system.readiness` (`packages/app/src/system/readiness.ts`), on the existing `SystemHealthPort`: `migrations` (applied count equals the build's migration count), `database` (the write probe; a throwing probe counts as failing) and `jobs`. The runner exposes `liveness()` (`running`, `lastTickAt`, `pollMs`); `lastTickAt` is set by `start()` and by every tick whose claims succeed, read by the injected clock like the rest of the runner. `server.ts` passes a getter, so `/healthz` reports `jobs` until the runner has started and after it stops; demo mode passes `"skip"`. The route is registered before the `/api/*` Origin and session middleware and the SPA fallback.
- **Container firewall (deviation in mechanism, same effect):** containers are filtered by a native nftables `forward` base chain in the `inet pangolin` table (priority `filter - 10`), not by rules inside `DOCKER-USER`. An iptables-nft `DOCKER-USER` rule cannot reference nft sets, so resolved hostnames would have to be rewritten as per-IP iptables rules every 15 minutes. The native chain sees exactly the forwarded packets `DOCKER-USER` sees, a drop in it stands regardless of Docker's own accepts, and it survives Docker restarts and Docker's nftables backend. Published ports are restricted there too (`ct status dnat`), because DNAT'd traffic never reaches `input`.
- **Allowlist syntax:** `host` allows every port on its addresses; `host:port` allows that port over TCP and UDP; IPv4/IPv6 addresses and CIDRs are accepted (`[v6]:port`). `pangolin-allowlist.service` re-renders and reloads the whole table atomically (`delete table` + definition in one `nft -f`); the timer runs it every 15 minutes. Debian's `nftables.service` is left alone (its `flush ruleset` would clear Docker's rules), and install.sh warns if it is enabled.
- **Secrets ownership:** `secrets/` and its three files are owned by uid 1000 (the image's `node` user) so the non-root container can read `auth-secret` through the read-only `/secrets` mount; root can still read them. `ghcr-token` stays root's.
- **A lone `install.sh`:** the release uploads only `install.sh`, so the image now carries `deploy/` at `/app/deploy`; install.sh uses the files next to itself when present, else the `--build` clone, else copies them out of the pulled image.
- **Testing flags:** `--root DIR` writes every file under DIR and never modifies the host (no packages, nft, systemd or Docker), so it needs no root; `--no-docker` skips Docker on a real host. Staged runs write a `--no-resolve` preview of the ruleset and Proxmox rules. For the unhealthy-start row, `PANGOLIN_HEALTH_TIMEOUT` (default 90) shortens the wait, and `PANGOLIN_INSTALL_STUB_DOCKER=1` lets a `--root` run start the stack and wait for it against a stub `docker` on `PATH`; without `--root` that variable is ignored.
- **Review fixes (round 1):**
  - Boot: `pangolin-firewall.service` (`DefaultDependencies=no`, before `network-pre.target` and `docker.service`, WantedBy `sysinit.target`) runs `render.sh boot`, which loads the saved `firewall/pangolin.nft` or, failing that, a fail-closed ruleset (`render.sh fallback`: SSH from the admin network, NPM to the app, DNS, host NTP). `render.sh apply` saves the ruleset atomically; the allowlist service/timer only re-renders.
  - Data disk: `--tang-url` (prompted, optional) is stored as `PANGOLIN_TANG_URL` and allowlisted (re-added if missing); when the data root is a mount point, a `docker.service.d/pangolin-data.conf` drop-in sets `RequiresMountsFor`. Tests answer the mount check with `PANGOLIN_INSTALL_STUB_MOUNTPOINT`, honoured only under `--root`.
  - Settings are settled from `.env` plus flags before the host checks; an explicit `--image`, `--build` or `--data-root` replaces its `.env` value with a notice. A local image ref (no `/`) is never pulled; it must exist (`docker image inspect`). `PANGOLIN_INSTALL_STUB_DOCKER` now also covers the image step.
  - Only `secrets/auth-secret` is mounted (as a file) and owned by uid 1000; `app-key`, `restic-password` and `ghcr-token` stay root's.
  - NTP: the pool names are gone from the allowlist; the host's `output` chain allows `udp dport 123` anywhere (containers do not).
  - render.sh skips an empty port, octets over 255 and malformed IPv6 (strict validators shared with install.sh); DHCPv6 allowed. `--root` resolving to `/` or empty is refused. `/healthz` reuses its answer for 1 s (by the injected clock).
- **Extra flags** beyond the prompts: `--dns`, `--data-root`, `--http-port`, `--ssh-port`, `--ghcr-user`, `--ghcr-token-file`, `--repo`.
- **Verified locally:** lint, typecheck and the full Vitest suite (641 tests, including `deploy/install.test.ts`); shellcheck clean at every severity; the ruleset loads in a scratch network namespace (`unshare -n nft -f`, twice); `docker compose config` on the generated `.env` (also with the SELinux `rw,Z`/`ro,Z` modes); and the production compose file booted a locally built image: healthy, uid 1000, read-only root, no capabilities, `/run` tmpfs, auth secret read from `/secrets`, setup link written, `/healthz` 503 `["database"]` on a read-only database. A full `docker build` could not finish in the sandbox (pnpm hung on network), and the real VM install, NPM, Clevis/Tang and the firewall's live behaviour remain the human-in-the-loop checks.

## Plan Change Log

- 2026-09-27: the human confirmed the native `inet pangolin` forward chain (priority filter − 10) in place of the `DOCKER-USER` chain named in the firewall decision. Its effect is the same: container egress is limited to the allowlist, and published ports admit only the NPM host.

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 52 findings — high 6, medium 19, low 23, false 3, maybe-false 1
- findings:
  - `[medium]` `[patch]` VG: the image's `/app/deploy` is never checked — added a CI container-job step; it runs clean locally against the rebuilt image.
  - `[medium]` `[patch]` VG: the generated ruleset is never parsed by `nft` — CI runs `nft -c` on the saved and fallback rulesets; both pass locally, and the saved one loads twice in a netns.
  - `[low]` `[patch]` VG: a failed claim leaving `lastTickAt` stale is untested — added a runner test.
  - `[medium]` `[patch]` VG: GHCR token storage is untested — test: CRLF stripped, 0600, root-owned, never printed or stored elsewhere.
  - `[medium]` `[patch]` VG: only the unhealthy `wait_healthy` path is tested — added the healthy path via the Docker stub, asserting `compose up -d`.
  - `[low]` `[patch]` VG other: the ruleset test depends on the host's `/etc/hosts` — uses IP literals now.
  - `[low]` `[reject]` Intent: the prompts are untested (every test is non-interactive) — each prompt maps to the same flag code; covered by the manual interactive run and the VM check.
  - `[false]` `[reject]` Intent: Ubuntu and Rocky are barely tested — by design: marked unproven in the plan's constraints.
  - `[false]` `[reject]` Intent: `--root` skips host changes, so packages, firewall load and Docker are untested — by design (Design Notes); the VM run is this ticket's human-in-the-loop step; Docker steps are now stub-tested and nft loads are checked.
  - `[low]` `[reject]` Intent: the production compose file is never booted in CI — validated with `docker compose config` in CI and booted locally from a staged install.
  - `[false]` `[reject]` Intent: the setup link through NPM over https is not proven — the plan's first acceptance criterion needs the VM (human-in-the-loop); it can't be automated here.
  - `[high]` `[patch]` Blind: the firewall is absent at boot and after a failed render, so Docker restarts the app with port 3000 open and egress unrestricted — added the early `pangolin-firewall.service` that loads the saved ruleset before the network and Docker, with a fail-closed fallback; verified in a netns.
  - `[high]` `[patch]` Blind: with Tang not allowlisted and a `nofail` mount, a failed unlock lets the app start on an empty unencrypted data root — `--tang-url` is allowlisted; a docker `RequiresMountsFor` drop-in when the data root is a mount point; docs explain; tested.
  - `[medium]` `[patch]` Blind: the container can read `app-key` and `restic-password`, which it doesn't use — compose mounts only `auth-secret`; the others stay root-owned 0600; verified by booting.
  - `[medium]` `[patch]` Blind: `--build`/`--image` are ignored on a re-run, and a local image is pulled and dies silently — an explicit `--image`/`--build` replaces the `.env` value with a notice; local refs are inspected, never pulled; tested.
  - `[medium]` `[patch]` Blind: `--data-root` is checked and prepared while `.env`'s old value is what's mounted — settled from `.env` and flags before the checks; an explicit `--data-root` replaces it; tested.
  - `[medium]` `[patch]` Blind: render.sh accepts `host:` (empty port → every port), octets > 255 and malformed IPv6, which then break `nft -f` — strict shared validators; invalid or blank-port entries are skipped with a warning; tested.
  - `[medium]` `[patch]` Blind: NTP pool names rotate addresses, so time sync (and TOTP) silently breaks — host-only `udp dport 123` to any address; pool names removed; documented.
  - `[low]` `[patch]` Blind: an IPv6 NPM host is accepted but can't work — an IPv6 `--npm-host` is now rejected with a clear message.
  - `[medium]` `[patch]` Blind: unauthenticated `/healthz` runs a write probe on every request — the readiness result is cached for 1 s; tested.
  - `[medium]` `[patch]` Blind: CI never parses the ruleset — same patch as the VG `nft` row.
  - `[low]` `[patch]` Blind: risky paths untested (claim failure, GHCR token, and more) — the claim-failure and token tests were added; SSH-lockout and backup-URL variants stay low.
  - `[low]` `[reject]` Blind: operator edits to `compose.yaml` and the units are overwritten — by design: settings live in `.env`; override support can come if a need appears.
  - `[low]` `[patch]` Blind: `docker login` also stores the token in `/root/.docker/config.json` — documented.
  - `[low]` `[patch]` Edge: Ctrl-C during the token prompt leaves terminal echo off — `ask_secret` restores echo in its own trap.
  - `[medium]` `[patch]` Edge: a bad NPM host or resolver value is stored and breaks `nft -f` — same patch as the Blind validator row.
  - `[low]` `[reject]` Edge: a flag cannot fix an invalid stored `.env` value — invalid stored values now fail validation loudly; the operator edits `.env` (documented).
  - `[medium]` `[patch]` Edge: `--build`/`--image` are ignored on a re-run, and a local image is pulled and dies silently (`--build` on a re-run) — same patch as the Blind image row.
  - `[medium]` `[patch]` Edge: `--build`/`--image` are ignored on a re-run, and a local image is pulled and dies silently (a local image pulled on a re-run) — same patch as the Blind image row.
  - `[low]` `[reject]` Edge: `--repo` changed on a re-run is ignored by an existing clone — a rare developer path; delete `/opt/pangolin/src` to re-clone.
  - `[low]` `[patch]` Edge: `PANGOLIN_TRUSTED_PROXIES` drifts from an edited NPM host — now warns when they differ.
  - `[medium]` `[patch]` Edge: `--data-root` is checked and prepared while `.env`'s old value is what's mounted — same patch as the Blind data-root row.
  - `[medium]` `[patch]` Edge: `--root /` turns a staging run into a real install — a root of `/` or empty is refused; tested.
  - `[low]` `[reject]` Edge: an SSH client and admin network in different families skip the lockout warning — the plan's Debian path is IPv4; the warning is advisory.
  - `[low]` `[patch]` Edge: a zone-scoped IPv6 resolver makes `detect_dns` die — link-local and zone-scoped resolvers are skipped.
  - `[low]` `[reject]` Edge: os-release without `VERSION_CODENAME` writes a bad docker.list — Debian 12/13 and Ubuntu 24.04 always set it; apt fails loudly.
  - `[low]` `[patch]` Edge: install.sh `--help` prints a stray `set -eu` — reads a marked range now.
  - `[low]` `[patch]` Edge: render.sh `--help` ends mid-sentence — reads a marked range now.
  - `[medium]` `[patch]` Edge: an empty port allows every port — same patch as the Blind validator row.
  - `[medium]` `[patch]` Edge: octets > 255 reach the ruleset — same patch as the Blind validator row.
  - `[maybe-false]` `[reject]` Edge: overlapping prefix+port intervals may make `nft` reject the set — `auto-merge`/interval handling needs a real overlapping allowlist to settle; if true it is low, since the default allowlist has no overlaps and a load failure keeps the old ruleset.
  - `[low]` `[patch]` Edge: render.sh keeps running after INT/TERM — `trap 'exit 130'` added.
  - `[low]` `[patch]` Edge: DHCPv6 is dropped — in 547→546 and out 547 allowed.
  - `[high]` `[patch]` Edge: the firewall is absent at boot and after a failed render, so Docker restarts the app with port 3000 open and egress unrestricted — same patch as the Blind boot row.
  - `[high]` `[patch]` Edge: with Tang not allowlisted and a `nofail` mount, a failed unlock lets the app start on an empty unencrypted data root (the boot race with Clevis) — same patch as the Blind disk row: the early firewall loads the saved rules, which include Tang.
  - `[medium]` `[patch]` Edge: NTP pool names rotate addresses, so time sync (and TOTP) silently breaks — same patch as the Blind NTP row.
  - `[high]` `[patch]` Edge: with Tang not allowlisted and a `nofail` mount, a failed unlock lets the app start on an empty unencrypted data root (the docs' `nofail` mount) — same patch as the Blind disk row.
  - `[low]` `[reject]` Edge: a trailing comment on the backup line gives a false missing warning — cosmetic; only a warning.
  - `[low]` `[reject]` Edge: backup userinfo containing `/` allowlists the wrong host — an unusual credential form; the operator can edit the allowlist.
  - `[low]` `[reject]` Edge: "An account already exists" is inferred from the sqlite file — an advisory message; the server's own setup-link logic is authoritative.
  - `[low]` `[reject]` Edge (claim): nothing is written to DOCKER-USER, as the plan decision says — a native nft forward chain at priority filter − 10 filters the same packets before Docker's chains, so the decision's effect holds; flagged to the human at the checkpoint for explicit confirmation.
  - `[high]` `[patch]` Edge (claim): the app port is reachable during boot or after a failed render — same patch as the Blind boot row.

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
