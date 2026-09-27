# Installing Pangolin Money on a VM behind Nginx Proxy Manager

This guide takes a fresh Debian VM on Proxmox to the first login, served over https by your
existing Nginx Proxy Manager (NPM). `deploy/install.sh` does almost all of it in one command;
the steps before it (the VM and its encrypted data disk) are yours, because the installer never
formats or binds disks.

Debian 13 is the proven path; Debian 12 is supported. Ubuntu 24.04 and Rocky Linux 9 paths
are written but not yet proven.

## 1. The VM

| Resource | Minimum | Recommended |
| --- | --- | --- |
| Guest type | VM | VM, not LXC (better isolation, simpler disk encryption) |
| OS | Debian 12 | Debian 13 |
| vCPU | 1 | 2, CPU type `host` (exposes AES-NI for encryption) |
| RAM | 1 GB | 2–4 GB |
| System disk | 16 GB | 32 GB |
| Data disk (database, receipts, statements) | 10 GB | 50 GB, a separate virtual disk |

In Proxmox: create the VM with CPU type `host`, tick **QEMU Guest Agent**, and add the data
disk as a second virtual disk. Install Debian with SSH only (no desktop), then:

```sh
apt install -y qemu-guest-agent chrony unattended-upgrades
timedatectl set-timezone Australia/Sydney
# SSH keys only: in /etc/ssh/sshd_config set `PasswordAuthentication no`, then
systemctl restart ssh
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
data root is not a mount point, the installer warns instead.

The alternative, ZFS native encryption on the Proxmox pool, needs a passphrase after every
host reboot. If you use Proxmox Backup Server, turn on its client-side encryption.

## 3. Before you run the installer

- A DNS name for the app (e.g. `money.example.com`) that resolves to your NPM host.
- The NPM host's IP address: it becomes the only address allowed to reach the app.
- The NPM host's address must be IPv4: the app port is published on IPv4 only.
- The network you SSH in from (e.g. `192.168.1.0/24`): SSH from anywhere else is refused once
  the firewall is on. The installer warns if your current SSH session comes from outside it.
- Your Tang server's URL (e.g. `http://tang.lan`), so it can be allowlisted.
- Optional: your restic REST server URL (e.g. `rest:https://nas.lan:8000/pangolin`). It is only
  stored and allowlisted for now; nightly backups arrive in a later release.
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
| `--backup-server URL` | A restic REST URL (stored in `.env` and allowlisted) |
| `--tang-url URL` | The Tang server that unlocks the data disk (stored in `.env` and allowlisted) |
| `--npm-host IP` | The NPM host's IPv4 address; also becomes `PANGOLIN_TRUSTED_PROXIES` |
| `--admin-network CIDR` | Where SSH is allowed from |
| `--ghcr-token-file FILE` / `--ghcr-token TOKEN` | A GHCR read-only token for `docker login ghcr.io` (a file keeps it out of the process list). It is kept in `secrets/ghcr-token`, and `docker login` also stores it in `/root/.docker/config.json` |
| `--dns IP[,IP]` | The resolvers DNS is allowed to (default: from `/etc/resolv.conf`) |
| `--data-root DIR` | The data directory on the encrypted disk (default `/srv/pangolin`); on a re-run it replaces `PANGOLIN_DATA_ROOT` in `.env` |
| `--http-port PORT` | The VM port NPM forwards to (default 3000) |
| `--image REF` | The image (default `ghcr.io/sbwilson/pangolin:latest`); on a re-run it replaces `PANGOLIN_IMAGE` in `.env`. A local image (no `/`, like `pangolin:local`) is never pulled: it must exist |
| `--build [--ref REF] [--repo URL]` | Build `pangolin:local` on the VM from the repository instead (its default branch, or `--ref`), and set `PANGOLIN_IMAGE` to it (needs the build hosts in the allowlist on a re-run) |
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
7. Prints the NPM settings, the optional Proxmox rules, the recovery bundle's path and the
   one-time setup link.

### What it writes

| Path | Mode | Holds |
| --- | --- | --- |
| `/opt/pangolin/compose.yaml` | 0644 | The production stack (replaced on every run; put settings in `.env`) |
| `/opt/pangolin/.env` | 0600 | Every setting: image, public URL, NPM host, admin network, ports, data root, backup repository |
| `/opt/pangolin/allowlist.conf` | 0644 | The outbound allowlist, one `host[:port]` per line |
| `/opt/pangolin/secrets/` | 0700 | Each file 0600: `auth-secret`, owned by the container's user (uid 1000), the only one mounted into the container; `app-key` (32 random bytes, base64) and `restic-password`, root's, held for the stories that use them (attachments, backups); `ghcr-token` (root's) if you gave one |
| `/opt/pangolin/firewall/` | | `render.sh` and the last applied `pangolin.nft`, which loads at boot |
| `/opt/pangolin/proxmox-firewall.txt` | 0644 | The equivalent Proxmox VM rules |
| `/etc/systemd/system/pangolin-firewall.service` | 0644 | Loads the saved ruleset early at boot, before the network and Docker |
| `/etc/systemd/system/pangolin-allowlist.{service,timer}` | 0644 | Re-resolves the allowlist every 15 minutes, reloads and saves the ruleset |
| `/etc/systemd/system/docker.service.d/pangolin-data.conf` | 0644 | Docker waits for the data disk (when the data root is a mount point) |
| `/srv/pangolin/` | 0700 | The database and attachments (the container's `/data`) |
| `/root/pangolin-recovery-bundle-<date>.txt` | 0600 | The recovery bundle (first install, or `--bundle`) |
| `/usr/local/bin/pangolin` | 0755 | The admin command (see [Administration](#9-administration)) |

The container runs as a non-root user with a read-only root filesystem, no capabilities and
`no-new-privileges`. It sees the data root at `/data`, the auth secret read-only at
`/secrets/auth-secret`, and
has a `/run` tmpfs for the admin socket the `pangolin` command talks to.

### Re-running

Re-running is safe and is how you apply changes: it never regenerates an existing secret, keeps
every value you changed in `.env` (it only adds keys that are missing, and warns when a flag
asks for something different from what `.env` holds), keeps your `allowlist.conf` (adding the
Tang server back if it is missing), and then restarts the stack. The exceptions are `--image`,
`--build` and `--data-root`: asked for explicitly, they replace their `.env` value and say so.
To change any other setting, edit `/opt/pangolin/.env` and re-run.

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
curl https://money.example.com/healthz        # {"ok":true}
```

`/healthz` answers 200 `{"ok":true}` when every migration is applied, the database is writable
and the job runner has ticked recently. Otherwise it answers 503 with the failing checks' names
only, e.g. `{"ok":false,"failing":["jobs"]}`. It needs no sign-in, so NPM, Docker and upgrades
can probe it.

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

`sudo sh deploy/install.sh --bundle` writes it again from the secrets on the VM.

## 8. The firewall

`install.sh` turns on an nftables ruleset in the VM (the `inet pangolin` table; Docker's own
tables are never touched):

- **Inbound:** the app port from the NPM host only, SSH from the admin network only (ping too).
  Everything else is dropped.
- **Outbound, for the VM and its containers alike:** only the hosts in `allowlist.conf`, plus
  DNS to the resolvers in `.env` (`PANGOLIN_DNS_SERVERS`). Containers' traffic is filtered on
  the forward path, the same packets Docker's `DOCKER-USER` chain sees.
- **Time:** the VM itself (not its containers) may send NTP (UDP 123) to any server. NTP pool
  names rotate their addresses faster than the allowlist is re-resolved, so allowlisting them
  would let chrony's servers drop out, and a drifting clock breaks authenticator codes.
- **At boot:** `pangolin-firewall.service` loads the last applied ruleset
  (`/opt/pangolin/firewall/pangolin.nft`, with the addresses resolved last time) before the
  network and Docker start, so the app is never reachable unfiltered. If that file is missing
  or does not load, it loads a fail-closed ruleset instead: SSH from the admin network, NPM to
  the app, DNS to the resolvers and NTP, nothing else. The timer then refreshes it once the
  network is up.
- Host names are resolved into nftables sets, refreshed every 15 minutes by
  `pangolin-allowlist.timer`. A host whose addresses change faster than that (some CDNs) can
  fail now and then; allowlist an address range instead if it matters.

The default allowlist covers the Debian mirrors, Docker, GHCR, your backup server, your Tang
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

## 9. Administration

`pangolin` runs the admin CLI inside the container. While the stack runs, it reaches the server
over its admin socket (`/run/pangolin/admin.sock` on the container's `/run` tmpfs, mode 0600,
never on the data disk), so the CLI never opens the database beside the server. It needs root
(it reads `/opt/pangolin/.env`):

```sh
sudo pangolin status                       # version, schema, readiness, job counts, dead jobs
sudo pangolin reset-user alex@example.com  # both of you locked out: reset one person
sudo pangolin --help
```

- **`status`** prints the release, the schema version against the one the build expects,
  readiness (`ok`, or the failing checks as `/healthz` names them) and how many jobs are
  pending, running and dead, with each dead job's kind and time. It exits 0 when ready, 1 when
  not, and 3 with "Pangolin is not running" when the server is down (it then opens nothing).
- **`reset-user <email or person ID>`** is for when both of you are locked out (otherwise your
  partner's link in the app does it). It clears the person's passkeys, authenticator, sessions,
  recovery codes and password at once and prints a one-time link, valid 24 hours, to set them
  up again; the person gets a notice in the app. The link appears only on your console: the
  server never logs it. Every change is in the audit log as `cli:reset-user`. With no person,
  or one that matches nobody, it lists the people who have a login (name and email) and exits 1.
  With the stack stopped, it runs in a one-off container under an exclusive lock on the data
  directory, so a server started meanwhile waits until it is done ("another process holds
  /data"). It refuses a database the release has not migrated yet: start the server once first.

Only the server's own user can use the socket: each request must name a one-time file its
client just created in the socket's directory, which the server checks is its own. Set
`PANGOLIN_ADMIN_SOCKET` in `.env` to move the socket (keep it on a tmpfs), or to an empty value
to turn it off; `pangolin status` then cannot reach the server.

## Ubuntu 24.04 and Rocky Linux 9 (unproven)

The same command works on both, with warnings that the path is not yet proven. Ubuntu uses
apt like Debian and adds its own mirrors to the allowlist. Rocky uses dnf, labels the bind
mounts for SELinux (`:Z`, through `PANGOLIN_DATA_MOUNT_MODE` and
`PANGOLIN_SECRETS_MOUNT_MODE` in `.env`), and adds firewalld rules for the app and SSH
alongside the nftables table.

## Troubleshooting

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
