# Installing Pangolin Money on a VM behind Nginx Proxy Manager

This guide takes a fresh Debian VM on Proxmox to the first login, served over https by your
existing Nginx Proxy Manager (NPM). `deploy/install.sh` does almost all of it in one command;
the steps before it (the VM and its encrypted data disk) are yours, because the installer never
formats or binds disks.

Debian 13 is the minimum and the proven path. Ubuntu 24.04 and Rocky Linux 9 paths are written
but not yet proven.

## 1. The VM

| Resource | Minimum | Recommended |
| --- | --- | --- |
| Guest type | VM | VM, not LXC (better isolation, simpler disk encryption) |
| OS | Debian 13 | Debian 13 |
| vCPU | 1 | 2, CPU type `host` (exposes AES-NI for encryption) |
| RAM | 1 GB | 2–4 GB |
| System disk | 16 GB | 32 GB |
| Data disk (database, receipts, statements) | 10 GB | 50 GB, a separate virtual disk |

In Proxmox: create the VM with CPU type `host`, tick **QEMU Guest Agent**, and add the data
disk as a second virtual disk. Install Debian with SSH only (no desktop), then:

```sh
apt install -y qemu-guest-agent
```

`install.sh` checks the RAM, the free disk, AES-NI, whether it runs in LXC and whether the
data root is encrypted. Each shortfall is a warning; none stops the install.

## 2. Encrypt the data disk (LUKS, unlocked by Clevis + Tang)

The data disk is encrypted with LUKS inside the VM and unlocks at boot only when a Tang server
on your home network answers. A stolen disk, or a copy of a VM backup, stays locked.

**Tang server** (another machine, e.g. a small Debian LXC or the TrueNAS box):

```sh
apt install -y tang
systemctl enable --now tangd.socket        # listens on port 80
tang-show-keys                             # note the thumbprint it prints
```

**On the VM**, with the data disk at `/dev/sdb` (check with `lsblk`; everything on it is lost):

```sh
apt install -y cryptsetup clevis clevis-luks clevis-systemd

cryptsetup luksFormat --type luks2 /dev/sdb          # choose a long passphrase: your fallback
cryptsetup open /dev/sdb pangolin-data
mkfs.ext4 -L pangolin-data /dev/mapper/pangolin-data

# Unlock and mount at boot, after the network is up
echo "pangolin-data UUID=$(blkid -s UUID -o value /dev/sdb) none luks,_netdev" >> /etc/crypttab
mkdir -p /srv/pangolin
echo "/dev/mapper/pangolin-data /srv/pangolin ext4 defaults,_netdev,nofail 0 2" >> /etc/fstab
mount /srv/pangolin

# Bind the LUKS volume to Tang (answer the thumbprint prompt with the one tang-show-keys printed)
clevis luks bind -d /dev/sdb tang '{"url":"http://tang.lan"}'
clevis luks list -d /dev/sdb                          # shows the tang binding
systemctl enable clevis-luks-askpass.path
```

Reboot and check that `/srv/pangolin` is mounted without typing the passphrase
(`findmnt /srv/pangolin`, `lsblk` shows `crypt` under `sdb`). Keep the LUKS passphrase in your
password manager: it unlocks the disk when Tang is unreachable
(`cryptsetup open /dev/sdb pangolin-data`, then `mount /srv/pangolin`).

**Tang must be on the allowlist.** The firewall loads early at boot, before the disk unlocks,
and blocks everything not allowlisted, so an unlisted Tang server means the data disk stays
locked. Give the installer `--tang-url http://tang.lan` (it asks too): it writes `tang.lan:80`
into `/opt/pangolin/allowlist.conf`, and adds it back on a re-run if it has gone missing.

**Docker waits for the disk.** When `/srv/pangolin` is a mount point, the installer adds a
Docker drop-in (`/etc/systemd/system/docker.service.d/pangolin-data.conf`,
`RequiresMountsFor=/srv/pangolin`). If the disk does not unlock (the `nofail` mount lets the VM
boot anyway), Docker does not start, rather than starting the app on the empty directory of the
system disk, where it would create a fresh, unencrypted database and a new setup link. If the
data root is not a mount point, the installer warns instead. A drop-in left by an earlier run
for another data root is removed; one for this data root stays even while its disk is not
mounted, so Docker keeps waiting for it.

The alternative, ZFS native encryption on the Proxmox pool, needs a passphrase after every
host reboot. If you use Proxmox Backup Server, turn on its client-side encryption.

## 3. Before you run the installer

- A DNS name for the app (e.g. `money.example.com`) that resolves to your NPM host.
- The NPM host's IP address: it becomes the only address allowed to reach the app.
- The NPM host's address must be IPv4: the app port is published on IPv4 only.
- The network you SSH in from (e.g. `192.168.1.0/24`): SSH from anywhere else is refused once
  the firewall is on. The installer warns if your current SSH session comes from outside it.
- Your Tang server's URL (e.g. `http://tang.lan`), so it can be allowlisted.
- Optional but strongly advised: your restic REST server URL (e.g.
  `rest:https://nas.lan:8000/pangolin`), a [rest-server](https://github.com/restic/rest-server)
  started with `--append-only` (the TrueNAS app, or a container). Nightly backups go there; see
  [Backups and restore](#10-backups-and-restore). The VM must reach it directly: on the LAN, or
  over a tunnel you run yourself. Without it, nothing is backed up.
- For a private image: a GitHub fine-grained token with **packages: read** only.

## 4. Run the installer

From a checkout of the repository (or a release's `install.sh`; a lone script takes its
compose file and firewall from the image):

```sh
sudo sh deploy/install.sh
```

It asks for the proxy mode, the public host name, the backup server, the Tang server, the NPM
host, the admin network and, for a private image, the GHCR token (typed without echo). Every question has a
flag, so it can also run unattended:

```sh
sudo sh deploy/install.sh --non-interactive \
  --hostname money.example.com \
  --backup-server rest:https://nas.lan:8000/pangolin \
  --tang-url http://tang.lan \
  --npm-host 192.168.1.10 \
  --admin-network 192.168.1.0/24 \
  --ghcr-token-file /root/ghcr-token.txt
```

| Flag | Meaning |
| --- | --- |
| `--proxy npm` | Proxy mode. Only `npm` works today; `caddy` and `tailscale` answer "not yet supported" and change nothing |
| `--hostname NAME` | The public host name; the app is served at `https://NAME` |
| `--backup-server URL` | A restic REST URL (stored in `.env` and allowlisted). Set or changed on a re-run, it writes a new recovery bundle (new id) that includes it as `RESTIC_REPOSITORY`. An explicit empty value (`--backup-server ""`) turns backups off: on a re-run it empties `PANGOLIN_BACKUP_REPOSITORY` in `.env` and removes the old server's entry that the installer added to `allowlist.conf` (no new bundle is written) |
| `--tang-url URL` | The Tang server that unlocks the data disk (stored in `.env` and allowlisted) |
| `--npm-host IP` | The NPM host's IPv4 address; also becomes `PANGOLIN_TRUSTED_PROXIES` |
| `--admin-network CIDR` | Where SSH is allowed from |
| `--ghcr-token-file FILE` / `--ghcr-token TOKEN` | A GHCR read-only token for `docker login ghcr.io` (a file keeps it out of the process list). It is kept in `secrets/ghcr-token`, and `docker login` also stores it in `/root/.docker/config.json` |
| `--dns IP[,IP]` | The resolvers DNS is allowed to (default: from `/etc/resolv.conf`); on a re-run it replaces `PANGOLIN_DNS_SERVERS` in `.env`. The firewall also allows the VM's current resolvers (see [§8](#8-the-firewall)) |
| `--data-root DIR` | The data directory on the encrypted disk (default `/srv/pangolin`); on a re-run it replaces `PANGOLIN_DATA_ROOT` in `.env`. It does not move the data: when the old directory holds the database and the new one does not, the installer warns that the app will start on an empty database there. The Docker drop-in that waits for the data disk follows the new directory, and the old one is removed when the new directory is not a mount point |
| `--http-port PORT` | The VM port NPM forwards to (default 3000) |
| `--image REF` | The image (default `ghcr.io/sbwilson/pangolin:latest`); on a re-run it replaces `PANGOLIN_IMAGE` in `.env`. A local image (no `/`, like `pangolin:local`) is never pulled: it must exist |
| `--build [--ref REF] [--repo URL]` | Build `pangolin:local` on the VM from the repository instead (its default branch, or `--ref`), and set `PANGOLIN_IMAGE` to it. It adds the build hosts (GitHub, npm, Docker Hub) to `allowlist.conf`, which also lets `git pull` work in the clone |
| `--bundle` | Write the recovery bundle again |
| `--no-docker`, `--root DIR` | For testing: skip Docker; write files under `DIR` and change nothing on the host |

What it does, in order:

1. Checks it runs as root on a supported distribution, asks its questions, and checks the host.
2. Installs Docker Engine from Docker's repository (if missing), nftables and curl.
3. Creates the layout below, generating any secret that does not exist yet.
4. Signs in to GHCR if you gave a token, then pulls the image (or builds it with `--build`). If the
   registry refuses the pull (no release published yet, or a private image), it offers to build
   the image here or take a token; with `--non-interactive` it stops and names both flags.
5. Writes `compose.yaml`, the allowlist and the firewall, and turns the firewall on.
6. Starts the stack and waits up to 90 seconds for `/healthz`. If it is not healthy, it prints
   the container's last log lines and exits 1.
7. Prints the NPM settings, the optional Proxmox rules, the recovery bundle's path and id, and
   the one-time setup link.

### What it writes

| Path | Mode | Holds |
| --- | --- | --- |
| `/opt/pangolin/compose.yaml` | 0644 | The production stack (replaced on every run; put settings in `.env`) |
| `/opt/pangolin/.env` | 0600 | Every setting: image, public URL, NPM host, admin network, ports, data root, backup repository, and the recovery bundle's id (`PANGOLIN_RECOVERY_BUNDLE_ID`, see [The recovery bundle](#7-the-recovery-bundle)) |
| `/opt/pangolin/allowlist.conf` | 0644 | The outbound allowlist, one `host[:port]` per line |
| `/opt/pangolin/secrets/` | 0700 | `auth-secret` (0600) and `restic-password` (0400), owned by the container's user (uid 1000) and each mounted read-only into the container as a single file; `app-key` (0600, 32 random bytes, base64), root's, held for the attachments story; `ghcr-token` (0600, root's) if you gave one |
| `/opt/pangolin/firewall/` | | `render.sh` and the last applied `pangolin.nft`, which loads at boot |
| `/opt/pangolin/proxmox-firewall.txt` | 0644 | The equivalent Proxmox VM rules |
| `/etc/systemd/system/pangolin-firewall.service` | 0644 | Loads the saved ruleset early at boot, before the network and Docker |
| `/etc/systemd/system/pangolin-allowlist.{service,timer}` | 0644 | Re-resolves the allowlist every 15 minutes, reloads and saves the ruleset |
| `/etc/systemd/system/docker.service.d/pangolin-data.conf` | 0644 | Docker waits for the data disk (when the data root is a mount point) |
| `/srv/pangolin/` | 0700 | The database and attachments (the container's `/data`) |
| `/srv/pangolin/backup/` | | Backup staging (`staging/<id>/`: a snapshot waiting to be pushed, removed once pushed) and restic's cache (`cache/`) |
| `/srv/pangolin/pangolin.lock` | | An empty lock file: the server (or `pangolin reset-user` on a stopped stack) holds a lock on it so only one process writes the database. It holds no data and may be left out of backups; never delete it while anything runs |
| `/root/pangolin-recovery-bundle-<date>.txt` | 0600 | The recovery bundle (first install, `--bundle`, a backup server set or changed, or the next run after one of those stopped before the bundle was in place) |
| `/usr/local/bin/pangolin` | 0755 | The admin command (see [Administration](#9-administration)) |

The container runs as a non-root user with a read-only root filesystem, no capabilities and
`no-new-privileges`. It sees the data root at `/data`, the auth secret and the restic password
read-only at `/secrets/auth-secret` and `/secrets/restic-password` (never in `.env`), and has a
`/run` tmpfs for the admin socket the `pangolin` command talks to.

### Re-running

Re-running is safe and is how you apply changes: it never regenerates an existing secret, keeps
every value you changed in `.env` (it only adds keys that are missing, and warns when a flag
asks for something different from what `.env` holds), keeps your `allowlist.conf` (adding the
Tang server back if it is missing), and then restarts the stack. The exceptions are `--image`,
`--build`, `--data-root`, `--backup-server` and `--dns`: asked for explicitly, they replace their
`.env` value and say so. `--backup-server ""` turns backups off (it empties the value and removes
the old backup host's entry from `allowlist.conf`, keeping any line you wrote); a re-run without
`--backup-server` keeps the stored one.
To change any other setting, edit `/opt/pangolin/.env` and re-run.
After a `pangolin upgrade`, `.env` pins the new image by digest; a re-run that does not replace the
image (no `--image` or `--build`) then takes `compose.yaml` and the `pangolin` command from that
image rather than from your checkout, so they always match the image that runs.
Such an install gets a change to `compose.yaml` (like story 11.10's `stop_grace_period: 20s`)
with its next `pangolin upgrade`, not from a re-run of a newer checkout.

## 5. Nginx Proxy Manager

The installer prints the exact values; in NPM choose **Hosts → Proxy Hosts → Add Proxy Host**:

| Tab | Setting | Value |
| --- | --- | --- |
| Details | Domain Names | your host name |
| | Scheme | `http` |
| | Forward Hostname / IP | the VM's IP address |
| | Forward Port | `3000` |
| | Cache Assets | off |
| | Block Common Exploits | on |
| | Websockets Support | off |
| SSL | SSL Certificate | request a new one (or choose yours) |
| | Force SSL, HTTP/2 Support, HSTS Enabled | on |

NPM adds `X-Forwarded-For`, which Pangolin believes only from the NPM host
(`PANGOLIN_TRUSTED_PROXIES`). Check it end to end:

```sh
curl https://money.example.com/healthz        # {"ok":true,"warnings":["recovery-bundle-unconfirmed"]}
```

Right after the install the answer carries the `recovery-bundle-unconfirmed` warning until you
run `sudo pangolin confirm-bundle` ([section 7](#7-the-recovery-bundle)); then it is
`{"ok":true}`.

`/healthz` answers 200 `{"ok":true}` when every migration is applied, the database is writable
and the job runner has ticked recently. Otherwise it answers 503 with the failing checks' names
only, e.g. `{"ok":false,"failing":["jobs"]}`. It needs no sign-in, so NPM, Docker and upgrades
can probe it. Warnings ride along without changing the status or `ok`: `backup-stale`, and
`recovery-bundle-unconfirmed` until you confirm the recovery bundle is stored safely
([section 7](#7-the-recovery-bundle)), e.g. `{"ok":true,"warnings":["recovery-bundle-unconfirmed"]}`
right after the first install.

## 6. First login

The installer prints a one-time setup link (valid 24 hours). Open it through NPM, over https,
and follow the steps: email, password, display name and colour, then a passkey, an
authenticator app and your recovery codes (see the README). If you re-run the installer after
someone has a login, it says an account exists instead. A link that expired unused is replaced
on the next restart: `docker compose -f /opt/pangolin/compose.yaml restart`, then
`cat /srv/pangolin/setup-link.txt`.

## 7. The recovery bundle

On the first install, `install.sh` writes `/root/pangolin-recovery-bundle-<date>.txt` (0600):
the application key, the auth secret and the restic password. Together with a backup, they are
everything a restore onto a new host needs; without them, attachments, authenticator codes and
backups cannot be decrypted. Store the bundle offline (a password manager, or printed and locked
away), then delete it:

```sh
shred -u /root/pangolin-recovery-bundle-*.txt
```

Whenever a bundle is due (secrets generated, `--bundle`, or a backup server set or changed),
`install.sh` first sets a marker beside the secrets (`/opt/pangolin/secrets/.bundle-pending`,
root's only) and removes it only once the bundle is in place, so if the run stops in between,
the next run of `install.sh` writes the bundle (and its id). `uninstall.sh` keeps the marker
with the secrets when it keeps the data. An install interrupted before installers had this
marker gets its bundle with `install.sh --bundle`. So does a backup server added by editing
`.env` by hand, so that the bundle carries `RESTIC_REPOSITORY`.

Every bundle has an id, printed at its top (`Bundle id: 20261003T010203Z-a1b2`) and kept in
`/opt/pangolin/.env` as `PANGOLIN_RECOVERY_BUNDLE_ID`. The id is not a secret, and the bundle
itself never reaches the server. Until you confirm the bundle with that id is stored safely,
`/healthz`, `pangolin status` and the status page in the app warn (a warning only: the server
stays ready). Once the bundle is stored offline, check that the id in `.env` (`grep
PANGOLIN_RECOVERY_BUNDLE_ID /opt/pangolin/.env`) matches the `Bundle id:` line of the bundle you
stored, then, with the stack running, confirm it:

```sh
sudo pangolin confirm-bundle
```

It needs the server running: on a stopped stack it says "Pangolin is not running" and exits 3.

The confirmation is recorded in the database and audited as `cli:confirm-bundle`. A new bundle
(`--bundle`, a secret that had to be generated again, or a backup server set or changed, so the
bundle carries `RESTIC_REPOSITORY`) gets a new id, so the warning comes back until you confirm
that one. An install from before bundle ids gets an id the next time you
re-run `install.sh` (no bundle is written; `pangolin upgrade` does not add one), and then warns
until you confirm the bundle you already have. Restoring a backup taken before your last
confirmation brings the warning back; confirm again.

`sudo sh deploy/install.sh --bundle` writes it again from the secrets on the VM.

## 8. The firewall

`install.sh` turns on an nftables ruleset in the VM (the `inet pangolin` table; Docker's own
tables are never touched):

- **Inbound:** the app port from the NPM host only, SSH from the admin network only (ping too).
  Everything else is dropped.
- **Outbound, for the VM and its containers alike:** only the hosts in `allowlist.conf`, plus
  DNS (port 53) to the resolvers in `.env` (`PANGOLIN_DNS_SERVERS`) and to the VM's current
  resolvers (below). Containers' traffic is filtered on
  the forward path, the same packets Docker's `DOCKER-USER` chain sees.
- **Time:** the VM itself (not its containers) may send NTP (UDP 123) to any server. NTP pool
  names rotate their addresses faster than the allowlist is re-resolved, so allowlisting them
  would let the time servers drop out, and a drifting clock breaks authenticator codes.
- **Ping:** the VM itself (not its containers) may ping any address, to test the network.
- **At boot:** `pangolin-firewall.service` loads the last applied ruleset
  (`/opt/pangolin/firewall/pangolin.nft`, with the addresses resolved last time) before the
  network and Docker start, so the app is never reachable unfiltered. If that file is missing
  or does not load, it loads a fail-closed ruleset instead: SSH from the admin network, NPM to
  the app, DNS to the resolvers and NTP, nothing else. The timer then refreshes it once the
  network is up.
- Host names are resolved into nftables sets, refreshed every 15 minutes by
  `pangolin-allowlist.timer`. A host whose addresses change faster than that (some CDNs) can
  fail now and then; allowlist an address range instead if it matters.

**When the VM's DNS resolvers change** (a new DHCP lease, a router swap), the VM's own firewall
follows them by itself within 15 minutes (with the Proxmox firewall enabled, only once you have
re-pasted its rules; see below): every re-render first adds the VM's current nameservers to the
DNS sets of whatever `inet pangolin` ruleset is in force, including a fail-closed one loaded at
boot, so the new resolver can answer, and then renders a ruleset that allows them. The VM's
nameservers are those in `/etc/resolv.conf` and, when it lists systemd-resolved's `127.0.0.53`
stub, those in `/run/systemd/resolve/resolv.conf`. Loopback, unspecified, IPv4-mapped,
link-local (`fe80::/10`) and zone-scoped addresses are never added; with only loopback resolvers
(dnsmasq or unbound on the VM), a warning says DNS follows `.env` only. The widened DNS (port 53
only) applies to the containers as well as the VM. A resolver added this way that is not in
`.env` is named in a warning in `journalctl -u pangolin-allowlist.service`. The fail-closed
ruleset that `render.sh boot` builds itself holds only the resolvers in `.env`. To allow other
resolvers, or replace stale ones in `.env`, re-run `install.sh --dns IP[,IP...]`.

If no host name in the allowlist resolves at all, `render.sh apply` refuses to load or save the
new ruleset: the one in force and the saved one stay (with only the DNS additions above), the run
fails (`systemctl status pangolin-allowlist.service`, `journalctl -u
pangolin-allowlist.service`), and the message names every resolver it tried: "no allowlist host
resolved: the DNS resolvers tried, in .env (…) and the host's (…), may have changed, or upstream
DNS may be down; re-run install.sh --dns IP[,IP...]". The installer shows that message and stops
before (re)starting the stack: on a first install nothing runs yet, and on a re-run the stack
keeps running on its previous settings. A run in which only some names fail applies as before,
with those hosts blocked and a warning for each.

The Proxmox host's rules are pasted by hand, so they do not follow a resolver change: with the
Proxmox firewall enabled, its old DNS rules block the new resolver whatever the VM allows, so
paste the new `/opt/pangolin/proxmox-firewall.txt` into the VM's Proxmox firewall first. If the
last re-render was refused, `sudo /opt/pangolin/firewall/render.sh --no-resolve proxmox` prints
rules with the new resolvers that need no DNS (host names left out); paste the full file once a
re-render succeeds.

The default allowlist covers the Debian mirrors (and every mirror in this VM's apt sources, which
each run adds if missing), Docker, GHCR, your backup server, your Tang
server and Yahoo Finance (including its cookie/crumb handshake host). The LLM endpoint is added
in a later release. After editing `/opt/pangolin/allowlist.conf`:

```sh
systemctl start pangolin-allowlist.service      # apply now
/opt/pangolin/firewall/render.sh proxmox        # the matching Proxmox rules
```

The installer also prints IP-based **Proxmox VM firewall rules** (kept in
`/opt/pangolin/proxmox-firewall.txt`), an optional second layer outside the VM: paste them into
`/etc/pve/firewall/<vmid>.fw` on the Proxmox host and tick **Firewall** on the VM's network
device. They are a snapshot of today's DNS answers; regenerate them after allowlist changes.

Check it works:

```sh
# From the container: an allowlisted host answers, anything else times out
docker compose -f /opt/pangolin/compose.yaml exec pangolin node -e \
  "fetch('https://query1.finance.yahoo.com').then(r => console.log('ok', r.status), e => console.log('blocked', e.cause?.code))"
docker compose -f /opt/pangolin/compose.yaml exec pangolin node -e \
  "fetch('https://example.com', { signal: AbortSignal.timeout(5000) }).then(r => console.log('ok', r.status), e => console.log('blocked', e.name))"
# From a machine that is not the NPM host: the app port is closed
curl -m 5 http://<vm-ip>:3000/healthz            # times out
```

If `nftables.service` is enabled, the installer warns: its `flush ruleset` on restart clears
Docker's rules and Pangolin's until the next timer run.

Never turn the firewall off with `nft flush ruleset`: it also removes Docker's chains, and the
container then cannot publish its port ("Unable to enable DNAT rule … No chain/target/match").
To pause Pangolin's rules, run `systemctl stop pangolin-allowlist.timer` and
`nft delete table inet pangolin`; `systemctl start pangolin-allowlist.service` puts them back.
After a flush, `systemctl restart docker` rebuilds Docker's chains (install.sh does it when they
are missing).

## 9. Administration

`pangolin` runs the admin CLI inside the container. While the stack runs, it reaches the server
over its admin socket (`/run/pangolin/admin.sock` on the container's `/run` tmpfs, mode 0600,
never on the data disk), so the CLI never opens the database beside the server. It needs root
(it reads `/opt/pangolin/.env`):

```sh
sudo pangolin status                       # version, schema, readiness, jobs, last backup
sudo pangolin backup                       # back up now
sudo pangolin restore latest               # restore the newest backup (see section 10)
sudo pangolin reset-user alex@example.com  # both of you locked out: reset one person
sudo pangolin confirm-bundle               # the recovery bundle is stored safely (section 7)
sudo pangolin --help
```

- **`status`** prints the release, the schema version against the one the build expects,
  readiness (`ok`, or the failing checks as `/healthz` names them), how many jobs are
  pending, running and dead, the next ten pending jobs (kind and due time, soonest first), the
  running jobs (kind and lease end, at most ten), each dead job's kind and time, and the last
  backup (its time and restic snapshot ID, "none yet", or "not configured"). While the
  recovery bundle is not confirmed it adds
  `Warning:   recovery bundle not confirmed stored safely (run sudo pangolin confirm-bundle)`.
  It exits 0 when ready, 1 when not (a warning never changes this), and 3
  with "Pangolin is not running" when the server is down (it then opens nothing).
- **`confirm-bundle`** records that the recovery bundle whose id is in `.env` is stored safely
  offline, which ends the warning ([section 7](#7-the-recovery-bundle)); it is audited as
  `cli:confirm-bundle`. Before running it, check that id matches the `Bundle id:` line of the
  bundle you stored. It needs the stack running (exit 3, "Pangolin is not running", otherwise). Run again, it says the bundle was already confirmed and records
  nothing. With no bundle id set it exits 1 ("no recovery bundle id is set"); re-run
  `install.sh` to add one.
- **`backup`** and **`restore`**: see [Backups and restore](#10-backups-and-restore).
- **`reset-user <email or person ID>`** is for when both of you are locked out (otherwise your
  partner's link in the app does it). It clears the person's passkeys, authenticator, sessions,
  recovery codes and password at once and prints a one-time link, valid 24 hours, to set them
  up again; the person gets a notice in the app. The link appears only on your console: the
  server never logs it. Every change is in the audit log as `cli:reset-user`. With no person,
  or one that matches nobody, it lists the people who have a login (name and email) and exits 1.
  With the stack stopped, it runs in a one-off container under an exclusive lock on the data
  directory; a server started meanwhile exits ("another process holds /data") and Docker
  restarts it, so it comes up once the reset is done. It refuses a database the release has not migrated yet: start the server once first.

Only the server's own user can use the socket: each request must name a one-time file its
client just created in the socket's directory, which the server checks is its own. Set
`PANGOLIN_ADMIN_SOCKET` in `.env` to move the socket (keep it on a tmpfs), or to an empty value
to turn it off; `pangolin status` then cannot reach the server.

## 10. Backups and restore

With `PANGOLIN_BACKUP_REPOSITORY` set in `.env` (`install.sh --backup-server`), the server backs
up every night at **02:30 household time**:

1. A `local` job writes a consistent copy of the database (`VACUUM INTO`, on its own connection,
   so the app keeps working) to `/srv/pangolin/backup/staging/<id>/`, with a manifest: every
   table's row count and a SHA-256 of its rows.
2. A `net` job pushes that directory, and `/srv/pangolin/attachments/` when it exists, with
   restic (0.19, shipped in the image) to the repository, then empties the staging directory.
   restic encrypts everything with the restic password before it leaves the VM.

A failed push is retried with backoff (about an hour in all); if it still fails, the job is
dead, `pangolin status` and the status page list it, and it raises a "job.dead" review item.
The status page and `pangolin status` show the last backup's time and snapshot ID. With
`PANGOLIN_BACKUP_REPOSITORY` empty, nothing is scheduled, both say "not configured", and
`pangolin backup` exits 1.

**The repository.** Run restic's rest-server with `--append-only`: the VM can add backups but
never delete or rewrite them, so a compromised VM cannot destroy its own history. The VM never
runs `forget` or `prune`; apply retention (7 daily, 4 weekly, 12 monthly) on the server itself,
e.g. a TrueNAS cron job running `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12
--prune` against the repository's directory. The first backup initialises the repository with
the restic password. Its host must be in `allowlist.conf` (`install.sh --backup-server` adds it).

Give the NAS rest-server authentication too: create a user with `htpasswd -B` in its
`.htpasswd` (rest-server's default; never `--no-auth` outside a test), and put the credentials in
the repository URL, e.g. `rest:https://pangolin:<password>@nas.lan:8000/pangolin` (quote it in
`.env` if the password has shell characters; Pangolin redacts it from its messages). Serve it over
TLS (`--tls` with a certificate the VM trusts), or at least keep it on a trusted LAN segment:
restic encrypts the data either way, but plain HTTP exposes those credentials. `.env` is 0600,
root's.

**Back up now:**

```sh
sudo pangolin backup
```

It asks the running server for a backup and waits, printing the restic snapshot ID when the push
is done (exit 0). A second `pangolin backup` while one runs joins it. Exit 1 when the backup
failed or is not configured, 3 when the server is not running.

**Restore:**

```sh
sudo pangolin restore             # the newest backup
sudo pangolin restore 1a2b3c4d    # a snapshot by ID, as pangolin backup and status print it
```

Restore asks whether to restore the snapshot's sign-in details (sessions, passkeys, authenticator,
recovery codes) or keep the current ones; the default is to keep them. Without a terminal, pass
`--keep-credentials` or `--restore-credentials` (for example `sudo pangolin restore --keep-credentials latest`).

It stops the stack, then in a one-off container, under the exclusive lock on the data directory:

1. restores the snapshot into a fresh `/srv/pangolin/restore-<time>/`;
2. verifies it: `PRAGMA integrity_check` is `ok`, every table's row count and checksum match
   the manifest, and its schema is not newer than the running release;
3. swaps it in, moving the replaced database and attachments to
   `/srv/pangolin/pre-restore-<time>/` (delete that once you are happy);
4. before the server starts, marks every pending job that reaches outside the VM (a backup push,
   later price fetches and emails) `dead` with reason `restored`, so nothing from the past is
   replayed; the schedules are re-created when the server starts.

Then it starts the stack again. When a check fails, it names it, swaps nothing, exits 1 and
starts the stack on the database it had. It refuses while anything else holds the data
directory. A backup job that was running when the snapshot was taken runs again about a minute
after the restored server starts, so the repository soon holds the restored state too.

**Onto a new host** (the old VM is gone): install as usual with the same `--backup-server`
(it generates new secrets and a new bundle: shred that one, you keep the old bundle), then,
before first use, stop the stack, put the old recovery bundle's values back and restore:

```sh
sudo docker compose -f /opt/pangolin/compose.yaml stop
# The values of PANGOLIN_AUTH_SECRET and RESTIC_PASSWORD in the old recovery bundle:
printf '%s\n' '<PANGOLIN_AUTH_SECRET>' | sudo tee /opt/pangolin/secrets/auth-secret > /dev/null
printf '%s\n' '<RESTIC_PASSWORD>' | sudo tee /opt/pangolin/secrets/restic-password > /dev/null
sudo chown 1000:1000 /opt/pangolin/secrets/auth-secret /opt/pangolin/secrets/restic-password
sudo pangolin restore latest
```

Everyone then signs in as before, with their password and authenticator app (the auth secret
decrypts the authenticator secrets). Passkeys work when the host name is unchanged. CI proves
this on every push: it backs up the end-to-end household to an append-only rest-server, checks
`restic forget` is refused, restores into the running stack, restores onto a fresh volume using
only the bundle's values, and signs in with the saved password and TOTP code.

**Secrets missing over a kept database.** When the data root already holds a database
(`pangolin.sqlite`) but any of the three secrets in `/opt/pangolin/secrets` is missing or blank,
for example after moving the data disk to a new host or deleting `/opt/pangolin` by hand,
`install.sh` stops before writing any secret or starting anything: new secrets would lock the
household out of that database. It names the missing secrets and the data root. Put the old
values back from the recovery bundle, one per file, and run `install.sh` again (no flag needed;
it sets their modes and owners on that run):

| Bundle line            | File                                    |
|------------------------|-----------------------------------------|
| `PANGOLIN_AUTH_SECRET` | `/opt/pangolin/secrets/auth-secret`     |
| `PANGOLIN_APP_KEY`     | `/opt/pangolin/secrets/app-key`         |
| `RESTIC_PASSWORD`      | `/opt/pangolin/secrets/restic-password` |

```sh
sudo mkdir -p -m 0700 /opt/pangolin/secrets
# For each file: paste the value, press Enter, then Ctrl-D. Typed this way, the value stays out
# of your shell history.
sudo tee /opt/pangolin/secrets/auth-secret > /dev/null
sudo tee /opt/pangolin/secrets/app-key > /dev/null
sudo tee /opt/pangolin/secrets/restic-password > /dev/null
```

Once the install is back, `sudo sh install.sh --bundle` writes a new recovery bundle from the
secrets in place, if you need a fresh copy.

Or, to start again with an empty household, move everything in the data root aside (keep it
until you are sure you do not need it) and run `install.sh` again. There is no flag that writes
new secrets over a database. A fresh install gets a new restic password, so the old append-only
backup repository can no longer be used: point the new install at a new repository path
(`--backup-server rest:https://nas.lan:8000/pangolin-2`, say).

Decrypting restored attachments with the application key arrives with the attachment store
(epic 5). The weekly `restic check` and a monthly restore drill come in a later release.

## Ubuntu 24.04 and Rocky Linux 9 (unproven)

The same command works on both, with warnings that the path is not yet proven. Ubuntu uses
apt like Debian and adds its own mirrors to the allowlist. Rocky uses dnf, labels the bind
mounts for SELinux (`:Z`, through `PANGOLIN_DATA_MOUNT_MODE` and
`PANGOLIN_SECRETS_MOUNT_MODE` in `.env`), and adds firewalld rules for the app and SSH
alongside the nftables table.

## Troubleshooting

- **A backup job is dead:** `docker compose -f /opt/pangolin/compose.yaml logs pangolin` shows
  restic's error. Usually the repository is unreachable (check `allowlist.conf` and that the VM
  reaches it), or the restic password does not match the repository's (a repository initialised
  with another password).

- **"not healthy after 90 s":** the printed log lines say why; `docker compose -f
  /opt/pangolin/compose.yaml logs pangolin` shows more, and `curl -s localhost:3000/healthz` on
  the VM names the failing check (`migrations`, `database` or `jobs`).
- **A setting is ignored on re-run:** `.env` wins over flags; edit it and re-run.
- **"another process holds /data" in the log:** another server, or a `pangolin reset-user` on
  the stopped stack, has the data directory; the server exits and Docker restarts it once the
  other process is done. Two stacks must never share a data root.
- **`pangolin status` says the server is not running while it is:** check the log for "admin
  socket unavailable" (the server then keeps serving without the socket); `/healthz` still
  answers.
- **Locked out of SSH:** use the Proxmox console, then fix `PANGOLIN_ADMIN_NETWORK` in `.env`
  and run `systemctl start pangolin-allowlist.service`.
- **The app does not start after a reboot:** check that the data disk unlocked
  (`findmnt /srv/pangolin`). Docker waits for it; unlock it by hand with the LUKS passphrase
  if Tang was unreachable, then `systemctl start docker`.

## 11. Upgrades and releases

Upgrades to new releases are triggered manually on the server:

```sh
sudo pangolin upgrade v1.2.0
```

This verifies the signature of the `v1.2.0` image from GitHub using the public key in `/opt/pangolin/cosign.pub`, extracts its image digest, pulls it, and then orchestrates a safe upgrade:
1. It stops the stack.
2. It takes a pre-upgrade backup of your SQLite database inside the data volume (the encrypted data disk), in `<data root>/upgrade-copies/pre-upgrade-<time>/` (for example `/srv/pangolin/upgrade-copies/…`). `upgrade-copies/` and each copy in it are root's and 0700, never readable by the container's user; the last two copies are kept. Each copy is a full copy of the database, so up to two pre-upgrade and two rolled-back copies now take space on the data disk.
3. It writes the new image digest to `.env` and swaps the compose file.
4. It brings up the stack and waits for it to become healthy.

The wait is 60 seconds by default. A release with a long migration can need more: set `PANGOLIN_UPGRADE_TIMEOUT` to a positive whole number of seconds, for example `sudo PANGOLIN_UPGRADE_TIMEOUT=180 pangolin upgrade v1.2.0`. The health check is polled every 3 seconds, so the wait rounds up to a multiple of 3. A value that is not a positive whole number is refused before anything is stopped.

If the new image fails to become healthy within that time (e.g. bad migrations), the script automatically rolls back to your previous container image, `.env` file, and database copy, leaving a `system.upgrade-failed` review item in the inbox. Anything the new server wrote while it was being checked is not lost: before restoring the copy, the rollback copies the database the new server used into `<data root>/upgrade-copies/rolled-back-<time>/` (0700, the last two kept) and names that directory in its message. If it cannot keep that copy, it stops before restoring: the previous stack is started again on the live database (the one the new server used, possibly already migrated), and the message names the pre-upgrade copy in `<data root>/upgrade-copies/pre-upgrade-<time>/` for a manual restore (`pangolin restore` or copying it back with the stack stopped).

Releases before this one kept these copies in `/opt/pangolin/pre-upgrade-<time>/` and `/opt/pangolin/rolled-back-<time>/`, on the unencrypted system disk. The next `pangolin upgrade` moves them into `upgrade-copies/` (then keeps the last two of each); one it cannot move stays where it is, with a warning, and is never deleted. Moving them to another disk only unlinks them from the system disk: their blocks stay there until overwritten. If that matters, wipe the free space or run `fstrim` on an SSD or thin-provisioned disk.

### Release process

To cut a new release:
1. Once, create the signing key pair and set the secrets (the repository ships a placeholder `deploy/cosign.pub` that cannot verify anything):
   ```sh
   cosign generate-key-pair          # asks for a password; writes cosign.key and cosign.pub
   cp cosign.pub deploy/cosign.pub   # commit it: servers verify upgrades against it
   gh secret set COSIGN_PRIVATE_KEY < cosign.key
   gh secret set COSIGN_PASSWORD     # the password you chose
   ```
   Keep `cosign.key` out of the repository. Servers installed earlier need the new `cosign.pub` in `/opt/pangolin/` before their next upgrade.
2. Push a new Git tag matching `v*.*.*` (e.g. `git tag v1.2.0 && git push origin v1.2.0`).
3. CI builds the image for amd64/arm64, scans it for vulnerabilities, pushes it to GHCR by digest only (untagged), signs it and attaches a signed SBOM. It tags the image and creates the GitHub release only once every gate below has passed.

The release workflow publishes nothing until every gate has passed. The `image` job builds, scans, signs and attests the image by digest only, untagged. Alongside it, `upgrade-test` upgrades a running stack and rolls back a failed upgrade, and `migrate-previous` starts the previous release's image (the `vX.Y.Z` tag just below this one, never a pre-release such as `v1.2.0-rc1`; a pre-release tag is itself checked against the last release) on an empty data directory, then migrates the database it created with this release's migrations and checks it as a restore would: integrity, manifest and schema (`pnpm check:upgrade <db>`; for the first release there is nothing to migrate). Only when all three succeed does `publish` tag the signed digest and create the GitHub release. It always tags `vX.Y.Z`; it moves `vX.Y` only when this is the highest release in its line, and `latest` (and the release's "Latest" badge) only when it is the highest of all, so a patch on an older line never moves them backwards. A pre-release such as `v1.3.0-rc1` gets only its own tag and is marked as a pre-release. One release run publishes at a time and a running one is never cancelled; GitHub keeps only one more waiting, so a third tag pushed meanwhile cancels the waiting run, and pushing that tag again fires nothing: re-run the cancelled run, or delete the tag on the remote and push it again. `vX.Y` and `latest` are decided from the repository's tags, so delete a failed release's tag before releasing again; if a release was published while a higher, failed tag still existed, its `vX.Y` and `latest` were not moved: the next release moves them, or move them by hand with `docker buildx imagetools create`. If any of them fails, there is no release, and the digest is left in GHCR untagged. The git tag remains, though, and it has no image, so the next release's `migrate-previous` would fail to pull it: delete the failed tag (`git push --delete origin vX.Y.Z` and `git tag -d vX.Y.Z`), fix the cause, and push a new tag.

## 12. Uninstalling

`uninstall.sh` (attached to each release beside `install.sh`) reverses the install: it stops the stack, removes the firewall rules and units, the `pangolin` command, the container images and `/opt/pangolin` (except its secrets when the data is kept, below). Run it as root:

```sh
curl -fsSL -o uninstall.sh https://github.com/sbwilson/pangolin/releases/download/<tag>/uninstall.sh
sudo sh uninstall.sh
```

It asks before removing anything, then separately asks whether to delete the data directory (`/srv/pangolin`, or the `PANGOLIN_DATA_ROOT` in `.env`): the household database and attachments. Answer `y`, then type the directory back to confirm. Take a `pangolin backup` first if you might want the data. Any other answer keeps it. `--keep-data` and `--delete-data` answer for you, `--yes` skips the first question, and `--non-interactive` never prompts (and keeps the data unless `--delete-data` is given). The upgrade copies in `<data root>/upgrade-copies/` go with the data directory under `--delete-data` and stay with it under `--keep-data`.

When it keeps an existing data directory, it also keeps the three secrets in `/opt/pangolin/secrets` (the auth secret, the application key and the restic password, with their modes and owners) and says so: the kept database cannot be signed in to, backed up to its repository or have its attachments read without them. Everything else in `/opt/pangolin` goes, the GHCR token included. It also keeps the backup server from `.env` beside them (`/opt/pangolin/secrets/.backup-repository`, root's only). A later `install.sh` finds them and reuses them: it generates no new secret and starts on the old database. It writes no bundle when the backup server is the one kept, or none is given; given another one (or one with nothing kept to compare it with, after an older `uninstall.sh`), it writes a new bundle that names it, to store in place of the old. Deleting the data directory deletes the secrets too (the prompt says so), and with no data directory there is nothing to keep them for, so they go.

`.env` goes with `/opt/pangolin`, so a reinstall no longer knows a custom data directory: when the kept one is not `/srv/pangolin`, reinstall with `--data-root <that directory>` (uninstall's last message names it). Without it, `install.sh` starts an empty household on `/srv/pangolin`, using the kept secrets.

It does not touch Docker or its apt source, the recovery bundle in `/root`, the backup server's repository (append-only, so the VM cannot delete it), the Nginx Proxy Manager host, or any Tang binding or LUKS key slot. Remove those yourself if they were only for Pangolin.
