# M0 gate rehearsal

The runbook and decision record for the M0 gate of the platform-foundations epic. It runs the
epic's seven Done-when items together against one release tag, on the home server, and records
each result with its evidence. Procedures come from [install.md](install.md) sections 4 to 11;
this page changes none of them.

Who does what: the human cuts the tag, runs the VM steps and pastes the output. The agent prepares
this page and fills the record from pasted output. The agent takes no action on the VM and never
enters credentials. No item counts as demonstrated without pasted output or a CI run URL.

## Rules

- Every item ends as one of: **demonstrated** (output and date in its evidence row), **CI only**
  (the job name and run URL), or **not demonstrated** (a reason and an owner, accepted by the
  human), or **failed** (see below).
- A step whose output differs from the expected output is recorded as **failed**. A failed item
  stays failed in the record, a bug is raised, and the story is not marked done.
- A fix needs a new tag (for example `v0.1.1`), cut and rehearsed again. The record notes each
  attempt with its tag, digest and Release run URL; earlier attempts are kept, not overwritten.
- Gate decision: the gate is **closed** only when every item is demonstrated, CI only, or not
  demonstrated and accepted by the human. Otherwise (any failed item, or any unaccepted gap) it
  is **open**.
- Only the human marks the story done.

## Prerequisites

Have these before starting.

- A VM with the data disk on LUKS, unlocked at boot by Clevis and Tang (install.md section 2).
  Record the Debian version (`cat /etc/debian_version`); the rehearsal runs on whichever Debian
  the VM has (12 or 13) and no document is amended for the difference.
- Nginx Proxy Manager with a TLS certificate for the app's host name (install.md section 5).
- A restic REST server started with `--append-only`, reachable from the VM (install.md section 10).
- Access to GHCR for `ghcr.io/sbwilson/pangolin` (a token with packages: read, if the image is private).
- A real browser and an authenticator app, for the passkey and TOTP steps.
- `cosign.pub` in `/opt/pangolin/` on the VM matches the key the Release workflow signs with.
- A fresh host for item 1: the home server reverted to a clean snapshot, or a rehearsal VM the
  record names. Item 1 installs the previous release, `v0.0.2`, and item 4 upgrades it to the new
  tag, so items 1, 4, 5, 6 and 7 are all judged on that same host. Any snapshot revert happens
  before item 1, never between items 1 and 7.

Shell variables used below (set them in your session):

```sh
TAG=v0.1.0          # the new release under rehearsal (v0.1.1 and so on after a fix)
PREV=v0.0.2         # the previous release, installed in item 1
REPO=ghcr.io/sbwilson/pangolin
HOST=money.example.com      # the app's public host name
```

## Step 0. Cut the release tag

The human, from a clean checkout of current `develop` with CI green:

```sh
git fetch origin && git checkout develop && git pull --ff-only
git log -1 --format='%H %s'
git tag "$TAG"
git push origin "$TAG"
```

Wait for the Release workflow (jobs `ci`, `image`, `upgrade-test`) to go green, then record:

```sh
gh run list --workflow Release --limit 1 --json url,conclusion,headSha
docker buildx imagetools inspect "$REPO:$TAG" | grep -m1 Digest
```

If the Release run is not green, stop: the VM steps do not start.

| Field | Value |
| --- | --- |
| Commit | `40db6356f8f978ee3b3477793e7c44fc79251708` |
| Tag | `v0.1.0` (annotated) |
| Image digest | `sha256:70bf69b5044303a596406880921fb9d62de26a0d04220d60ef13dfd534a120fe` (`ghcr.io/sbwilson/pangolin:v0.1.0`) |
| Release run URL | https://github.com/sbwilson/pangolin/actions/runs/36792497800 (success: ci, image, upgrade-test) |
| Date cut | 2026-09-30 (Release run started 23:42 UTC) |
| VM Debian version | Debian GNU/Linux 13.7 (trixie), dev VM `pang-dev.net5.co`; web host `money-dev.net5.co` |

## Item 1. Fresh install to one-time link to passkey login (M0 gate)

Done when 1: on a fresh Debian VM, `install.sh` goes from nothing to the setup link, then to a
passkey login, in one command.

Procedure, on the fresh host (or the reverted snapshot), as root. It installs the previous release
(`v0.0.2`), so that item 4 can upgrade it to the new tag:

```sh
date -u
cat /etc/debian_version
curl -fsSL https://raw.githubusercontent.com/sbwilson/pangolin/$PREV/deploy/install.sh -o install.sh
sudo sh install.sh --non-interactive \
  --image "$REPO:$PREV" \
  --hostname "$HOST" \
  --backup-server rest:https://nas.lan:8000/pangolin \
  --tang-url http://tang.lan \
  --npm-host 192.168.1.10 \
  --admin-network 192.168.1.0/24 \
  --ghcr-token-file /root/ghcr-token.txt
```

Use your own values for the backup server, Tang, NPM host and admin network. Omit
`--ghcr-token-file` if the image is public. Then configure NPM (install.md section 5) and:

```sh
curl https://$HOST/healthz
sudo pangolin status
cat /srv/pangolin/setup-link.txt
```

Open the setup link in the browser over https and complete email, password, passkey,
authenticator and recovery codes. Sign out, then sign in with the passkey.

Expected:

- `install.sh` exits 0 and prints the one-time setup link (valid 24 hours), with no second command.
- `/healthz` prints `{"ok":true}`; `pangolin status` exits 0 and shows the release `v0.0.2`.
- Passkey sign-in succeeds.

Redact the one-time setup link before pasting anything into the record, from the installer output
and from `setup-link.txt` alike. For example:

```sh
sudo sh install.sh ... 2>&1 | tee install.log
sed -E 's#https?://[^ ]*#<setup-link redacted>#g' install.log
sudo sed -E 's#https?://[^ ]*#<setup-link redacted>#g' /srv/pangolin/setup-link.txt
```

Check the redacted text by eye before pasting. Never paste recovery codes or passwords.

| Evidence | |
| --- | --- |
| Command | `install.sh` as above |
| Observed output (link redacted) | `install.sh` exited 0 and printed the setup link (redacted here), the NPM proxy-host instructions, the recovery bundle path and the administration help; it finished with 1 warning: `/srv/pangolin` is on a dm-crypt (LUKS) device but is not a mount point (dev VM; a production host should mount the data disk there). Pulled `ghcr.io/sbwilson/pangolin:v0.0.2` (digest `sha256:44abe15b40ec578e99c2463491d33f2612e28bb76d6df57eb4e11dcfda1961ad`); "Healthy after 6 s". Backup server `rest:https://pangolin@restic.net5.co/pangolin`, NPM host 10.0.1.10, admin network 10.0.0.0/8. |
| `/healthz` and `pangolin status` output | `curl https://money-dev.net5.co/healthz` -> `{"ok":true}` (through NPM). `pangolin status`: `Pangolin Money v0.0.2`, `Schema: 6 (this build expects 6)`, `Readiness: ok`, `Jobs: 1 pending, 0 running, 0 dead`, `Backups: none yet (nightly at 02:30, household time)`. |
| Passkey sign-in (yes/no, screenshot or note) | Yes: reported by the human (setup link, sign out, passkey sign-in on `money-dev.net5.co`); the signed-in page was shown in a screenshot ("Signed in as Simon", Healthy, Schema version 6, No backup yet, 10 unused recovery codes), which does not itself show the sign-in method |
| Date | 2026-10-01 17:52 UTC (`date -u` on the VM) |
| Tag and digest | Installed `v0.0.2` (to be upgraded to `v0.1.0`, digest above) |
| Outcome | Demonstrated (Debian 13.7; passkey sign-in reported by the human, signed-in screenshot seen) |

## Item 2. Backup and restore on every release, verified (M0 gate)

Done when 2: CI backs up and restores a synthetic database on every release, verifying
integrity_check, row counts and per-table checksums.

CI proof: job **Container and end-to-end** in the CI workflow (run by the Release workflow's `ci`
job), steps "Back up the end-to-end household", "Restore into the running stack's volume" and
"Sign in to the restored household". Record the run URL from the Release run of the tag.

Optional proof on the VM, after item 1.

Warning: `pangolin restore latest` replaces the live household data with the snapshot. Run it
only after taking a fresh `pangolin backup` (the first command below), and note in the evidence
row that you did.

```sh
sudo pangolin backup
sudo pangolin restore latest
sudo pangolin status
```

Expected: `backup` prints a snapshot ID and exits 0; `restore` names the verification passing
(integrity_check ok, row counts and checksums match) and starts the stack; `status` exits 0.

| Evidence | |
| --- | --- |
| CI job and run URL | Release run https://github.com/sbwilson/pangolin/actions/runs/36792497800 (`v0.1.0`): job `ci / Container and end-to-end` succeeded, which runs the backup, restore and restored-household sign-in steps |
| VM output (optional) | On the VM (running v0.0.2): `pangolin backup` -> "Backup done at 2026-10-01T18:10:15.150Z: snapshot f3c1bc24939d..." (pushed with restic in 1 s, exit 0). A fresh backup was taken first, as the warning requires. `pangolin restore latest` -> stopped the stack, fetched snapshot f3c1bc24 (taken 18:10:12Z), `integrity_check: ok`, "Manifest: all 17 tables match (44 rows)", `Schema: version 6`, swapped in the snapshot (replaced files kept in `/data/pre-restore-...`), "Cancelled 0 pending jobs with external effects", started the stack. `pangolin status` afterwards: `Readiness: ok`, last backup 2026-10-01T18:10:30Z. An earlier backup (18:05:57Z) had also pushed, on its third attempt (cause not recorded) |
| Date | 2026-10-01 (CI run 2026-09-30 UTC; VM 18:10 UTC) |
| Tag and digest | CI: `v0.1.0`, `sha256:70bf69b5044303a596406880921fb9d62de26a0d04220d60ef13dfd534a120fe`. VM: `v0.0.2` |
| Outcome | Demonstrated (CI on `v0.1.0`; VM backup and verified restore on `v0.0.2`) |

## Item 3. Registration closes; recovery; 24-hour partner link

Done when 3: registration closes once both partners exist. Recovery codes and partner-assisted
re-enrolment each restore access in a test, and the partner reset link expires after 24 hours.

CI proof:

- Playwright `e2e/auth.spec.ts`, "invites the partner, who registers; then any further sign-up is
  refused".
- Playwright `e2e/recovery.spec.ts`, "a recovery code and the password sign in to a forced new
  passkey; the code works once" and "Alex resets Sam's access: Sam sets a new password, re-enrols
  and alone sees the notice".
- Vitest `packages/app/src/identity/recovery.test.ts`, "expires 24 hours after issue"; and
  `sign-up.test.ts`, "refuses a link older than 24 hours". Expiry of the 24 hour link is
  demonstrated in CI only.

Record the Release run URL (jobs `ci` > "Lint, types, tests, STRICT" and "Container and
end-to-end").

Optional on the VM (install.md sections 6 and 9): register the partner through the app's invite,
then open the setup link again and confirm sign-up is refused ("Registration is closed").

| Evidence | |
| --- | --- |
| CI jobs and run URL | Release run https://github.com/sbwilson/pangolin/actions/runs/36792497800 (`v0.1.0`): jobs `ci / Lint, types, tests, STRICT` and `ci / Container and end-to-end` succeeded |
| VM observation (optional) | Partial, 2026-10-02: with only the first person registered, the already-used setup link was opened again; the form accepted input (email, password, display name, colour) and "Create account" showed "Registration is closed" (screenshot seen). This shows the one-time setup link cannot be reused. It is not yet the "partner registered, then a further sign-up refused" case: still to do after the partner is invited and registered. 2026-10-02, with both partners registered, two screenshots were seen. (1) A third sign-up from the setup link (display name "Third") shows "Registration is closed". (2) The partner Carissa's page shows two notices: "A one-time recovery link for your account was issued on 2026-10-01 by Simon" (2026-10-01T18:17:16Z, with Revoke and Dismiss), and "One of your recovery codes was used to sign in on 2026-10-01, and your passkeys were removed" (2026-10-01T18:24:12Z). So on the VM: registration stays closed once both partners exist; the partner-issued link and its notice reach the affected person; a recovery code signs in and removes the passkeys (forcing new enrolment). The human reports the flows "work as expected"; for reuse of the setup link, the page still shows the "Set up your sign-in" form and refuses on submit with "Registration is closed". The refused second use of a partner link or recovery code was not captured. |
| Date | 2026-10-02 |
| Tag and digest | VM: `v0.1.0`, `sha256:70bf69b5044303a596406880921fb9d62de26a0d04220d60ef13dfd534a120fe` |
| Outcome (expiry is CI only) | Demonstrated: registration closed with both partners (screenshot), partner link issued and noticed, recovery code used and passkeys removed (screenshot). Expiry: CI only (run URL above). Single-use refusal of a second link or code: reported by the human, not captured |

## Item 4. Signed image verified before pull; upgrade with automatic rollback

Done when 4: `pangolin upgrade` rolls back automatically when a seeded health check fails. The
release image is signed with cosign and the signature is verified before the image is pulled.

Decided by the human on 2026-10-01: rollback is evidenced by the CI upgrade-test job (image B to C). On the VM,
show a successful upgrade and a refused unsigned or tampered tag. No unhealthy image is built.

CI proof: Release workflow job **upgrade-test**, steps "Upgrade to B (must succeed)" and "Upgrade
to C (must fail and roll back to B with B's schema)". Record the job URL.

VM proof A, a successful upgrade on the host item 1 installed, which runs `v0.0.2`:

```sh
date -u
sudo pangolin status
sudo pangolin upgrade "$TAG"
sudo pangolin status
curl https://$HOST/healthz
sudo grep '^PANGOLIN_IMAGE=' /opt/pangolin/.env
```

Expected: the output shows "Pulling", "Verifying ...@sha256:...", "Starting upgraded stack",
exit 0; `status` shows release `$TAG`; `.env` holds the image digest matching the Release run.

VM proof B, a refused wrong-key verification. The signature check runs before the stack is
stopped, so there is no downtime. Use any valid public key that did not sign the image (for
example one made with `cosign generate-key-pair` on another machine), swap it in, try, and
restore the real key through a trap:

```sh
sudo sh -c '
  cp /opt/pangolin/cosign.pub /root/cosign.pub.real
  trap "cp /root/cosign.pub.real /opt/pangolin/cosign.pub" EXIT
  cp /path/to/other-cosign.pub /opt/pangolin/cosign.pub
  pangolin upgrade "$0" > /root/refusal.log 2>&1; echo "exit=$?"; cat /root/refusal.log
' "$TAG"
sudo cmp /root/cosign.pub.real /opt/pangolin/cosign.pub && echo "real key restored"
sudo grep 'bad signature' /root/refusal.log
sudo pangolin status
```

Expected: the output contains `pangolin: bad signature:`, the `grep` finds it, `cmp` prints nothing
before "real key restored", the stack is untouched and `status` exits 0. A non-zero exit without
the signature-refusal message is not a refusal (record it as failed and investigate). If no
refusal message appears, do not record this proof as demonstrated.

| Evidence | |
| --- | --- |
| CI upgrade-test job and run URL (rollback B to C) | Release run https://github.com/sbwilson/pangolin/actions/runs/36792497800: job `upgrade-test` succeeded (its steps upgrade to B and require C to fail and roll back to B) |
| VM upgrade output (proof A) | `pangolin upgrade v0.1.0` on the host running v0.0.2: pulled `ghcr.io/sbwilson/pangolin:v0.1.0`, "Verifying ghcr.io/sbwilson/pangolin@sha256:70bf69b5...a120fe" (the v0.1.0 digest) before stopping the stack, stopped, started the upgraded stack, "Upgrade to v0.1.0 successful. Old image was ghcr.io/sbwilson/pangolin:v0.0.2". `pangolin status` after: `Pangolin Money v0.1.0`, `Schema: 7 (this build expects 7)` (migrated from 6), `Readiness: ok`, `Jobs: 3 pending, 0 running, 0 dead`, last backup unchanged, `Check: no check yet (weekly, Sundays 03:30)`, `Drill: no restore drill yet (monthly, the 1st at 04:00)`. `/healthz` -> `{"ok":true}`. `sudo grep '^PANGOLIN_IMAGE=' /opt/pangolin/.env` -> `PANGOLIN_IMAGE=ghcr.io/sbwilson/pangolin@sha256:70bf69b5044303a596406880921fb9d62de26a0d04220d60ef13dfd534a120fe` (pinned by digest) |
| VM refused-signature output (proof B) | With a different `cosign.pub` (`/home/sim/cosign.pub`) swapped in, `pangolin upgrade v0.1.0` printed `Pulling ...`, `Verifying ghcr.io/sbwilson/pangolin@sha256:70bf69b5...a120fe...`, then `pangolin: bad signature: ... Error: no matching signatures: invalid signature when validating ASN.1 encoded signature`, `exit=1`. It never printed "Stopping stack for upgrade", so the stack was not touched; `pangolin status` afterwards: v0.1.0, schema 7, `Readiness: ok`. `cmp` printed nothing and "real key restored" (the trap restored the real key). The runbook's `grep 'bad signature' /root/refusal.log` failed with "Permission denied" (root-owned file; the command now has `sudo`), but the message is in the `cat` output above |
| Date | 2026-10-01 (proof A 18:16 UTC; proof B later the same session) |
| Tag and digest | `v0.1.0`, `sha256:70bf69b5044303a596406880921fb9d62de26a0d04220d60ef13dfd534a120fe` |
| Outcome | Demonstrated: CI rollback (run URL above), VM upgrade with digest pin, and VM refusal of a bad signature before the stack was touched |

## Item 5. Non-root, read-only container; firewall

Done when 5: the app container runs non-root and read-only. The VM firewall allows inbound only
from NPM and outbound only to the allowlist.

```sh
date -u
sudo docker compose -f /opt/pangolin/compose.yaml exec pangolin id
sudo docker inspect --format 'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}}' \
  $(sudo docker compose -f /opt/pangolin/compose.yaml ps -q pangolin)
sudo docker compose -f /opt/pangolin/compose.yaml exec pangolin sh -c 'touch /probe' ; echo "exit=$?"
sudo nft list table inet pangolin
# From the container: an allowlisted host answers, anything else times out
sudo docker compose -f /opt/pangolin/compose.yaml exec pangolin node -e \
  "fetch('https://query1.finance.yahoo.com', { signal: AbortSignal.timeout(5000) }).then(r => console.log('ok', r.status), e => console.log('blocked', e.name, e.cause?.code))"
sudo docker compose -f /opt/pangolin/compose.yaml exec pangolin node -e \
  "fetch('https://example.com', { signal: AbortSignal.timeout(5000) }).then(r => console.log('ok', r.status), e => console.log('blocked', e.name, e.cause?.code))"
```

From a machine that is not the NPM host (and not on the allowed admin path for port 3000):

```sh
curl -m 5 http://<vm-ip>:3000/healthz; echo "exit=$?"
```

Expected: `id` shows uid 1000 (not 0); `readonly=true`, `capdrop=[ALL]`, `no-new-privileges`;
`touch /probe` fails with "Read-only file system"; the ruleset lists the NPM host and admin
network as the only inbound sources; the Yahoo fetch prints `ok <status>`; the
example.com fetch prints `blocked` with the error name and code (a timeout is `TimeoutError`); the remote curl times out (exit 28).

CI also proves non-root: job "Container and end-to-end", step "The server runs as a non-root user".

| Evidence | |
| --- | --- |
| Container user and read-only output | `id` -> `uid=1000(node) gid=1000(node)`; `docker inspect` -> `user=node readonly=true capdrop=[ALL] secopt=[no-new-privileges:true]`; `touch /probe` -> "Read-only file system", `exit=1`. CI also proves non-root: Release run https://github.com/sbwilson/pangolin/actions/runs/36792497800, job `ci / Container and end-to-end` |
| Firewall ruleset and allow/block outputs | `nft list table inet pangolin` shows `input` and `output` chains with `policy drop`. Inbound accepts: loopback, established, DHCP replies, `ip saddr 10.0.0.0/8` to tcp 22 and ICMP echo (the admin network), and `ip saddr 10.0.1.10 tcp dport 3000` (the NPM host, the only source for the app port); everything else logs and drops. Outbound is allowed only to DNS resolvers (10.0.1.1, 10.0.1.11), NTP, ICMP echo, and the allowlisted address sets (restic 10.0.1.10:443, GHCR/GitHub, Docker, Debian, the API hosts). The `forward` chain drops published-port traffic that is not from 10.0.1.10, and the `containers` chain drops container egress outside the allowlist. From the container: `fetch('https://query1.finance.yahoo.com')` -> `ok 404` (reached; an allowlisted host answers), `fetch('https://example.com')` -> `blocked TimeoutError undefined` (the error code is empty, the error name is the timeout) |
| Closed-port curl from another machine | Pending: not yet run (needs a machine that is neither the NPM host nor on the admin network) |
| Date | 2026-10-01 19:55 UTC (`date -u` on the VM) |
| Tag and digest | `v0.1.0`, `sha256:70bf69b5044303a596406880921fb9d62de26a0d04220d60ef13dfd534a120fe` |
| Outcome | Partial: container hardening and the firewall ruleset with outbound allow/block demonstrated; the closed-port check from another machine still to do |

## Item 6. Recovery bundle and clean-host restore

Done when 6: `install.sh` produces the recovery bundle, and CI restores onto a clean host from the
bundle alone, decrypting a sample attachment and logging in with TOTP.

Decided by the human on 2026-10-01: the sample-attachment decrypt is **not demonstrated, epic 5** (the
attachment store does not exist yet; owner: epic 5). M0 closes without it.

VM proof, after item 1 (install.md section 7; do not paste the contents):

```sh
date -u
sudo ls -l /root/pangolin-recovery-bundle-*.txt
sudo grep -o '^[A-Z_]*=' /root/pangolin-recovery-bundle-*.txt
```

Expected: one file, mode `-rw-------`, owned by root, holding `PANGOLIN_APP_KEY=`, `PANGOLIN_AUTH_SECRET=`, `RESTIC_PASSWORD=` and `RESTIC_REPOSITORY=`
(the grep prints the names only; never paste values).

Order: first store the bundle offline, then fill the evidence row below, and only then shred it
(install.md section 7):

```sh
sudo shred -u /root/pangolin-recovery-bundle-*.txt
```

Shredding earlier loses the only copy of the keys if the row or the offline copy goes wrong.

CI proof: job "Container and end-to-end", steps "Restore onto a clean host from the recovery
bundle's values alone" and "Sign in on the clean host (password and TOTP)". Record the run URL.

| Evidence | |
| --- | --- |
| Bundle listing on the VM (names and mode only) | |
| CI job and run URL (clean-host restore and TOTP login) | |
| Sample-attachment decrypt | Not demonstrated: epic 5 (attachment store). Needs the human's acceptance. |
| Date | |
| Tag and digest | |
| Outcome | |

## Item 7. Deployed with `pangolin upgrade`; CI green on the release tag

Done when 7: deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit,
migration, Playwright) is green on the release tag.

The deployment evidence is item 4's proof A (the VM upgrade from `v0.0.2` to `$TAG`, on the same host items 1 and 4 used, with no snapshot revert in between; record that host). CI evidence is the Release
run of the tag, whose `ci` job runs lint, typecheck, unit, STRICT tables, migrations, shell
scripts, compose validation and Playwright:

```sh
gh run view <run-id> --json conclusion,jobs --jq '{conclusion, jobs: [.jobs[] | {name, conclusion}]}'
```

Expected: `conclusion` is `success` for every job.

| Evidence | |
| --- | --- |
| Release run URL and job conclusions | |
| VM upgrade output (same as item 4, proof A) | |
| Date | |
| Tag and digest | |
| Outcome | |

## Open findings

- **App not running after a reboot (under investigation).** After a reboot on 2026-10-02 04:06 (local), Docker started but `pangolin-pangolin-1` stayed `Exited (0)` and `https://money-dev.net5.co/healthz` returned 502; `pangolin status` said "Pangolin is not running". The container had been started 16 s before the reboot and received SIGTERM at the shutdown. The compose file has `restart: unless-stopped`. A clean reboot test (stack up, nothing else, `sudo reboot`) is pending; if the app does not return on its own, item 1 and item 5 are failed and need a fix and a new tag.

- **Setup page still shows the form when registration is closed (minor).** Reopening the setup link after both partners exist shows the full "Set up your sign-in" form; the refusal comes only on submit. Not a gate failure; a candidate improvement.

## Results summary (the M0 decision record)

Fill this last. One outcome per item: demonstrated, CI only, not demonstrated (with reason and owner), or failed.
For a rehearsal repeated on a new tag, add a row set per attempt and note each attempt's tag.

| # | Done-when item | Outcome | Evidence | Date |
| --- | --- | --- | --- | --- |
| 1 | Fresh install to setup link to passkey login | | | |
| 2 | CI backup and restore on every release | | | |
| 3 | Registration closes; recovery; 24 h partner link | | | |
| 4 | Signed image; upgrade rollback | | | |
| 5 | Non-root, read-only; firewall | | | |
| 6 | Recovery bundle and clean-host restore | Attachment decrypt: not demonstrated, epic 5 | | |
| 7 | Deployed by `pangolin upgrade`; CI green on the tag | | | |

| Field | Value |
| --- | --- |
| Tag | |
| Image digest | |
| Release run URL | |
| Debian version on the VM | |
| Rehearsal dates | |
| Gate decision (open / closed) | |
| Accepted by the human (name, date) | |

Gate decision rule: closed only when every item is demonstrated, CI only, or not demonstrated and
accepted by the human. Otherwise open. If any item failed, list the bug references here, cut a new
tag (for example `v0.1.1`), rehearse again and record that attempt with its tag, digest and run
URL. Do not mark the story done; only the human does.
