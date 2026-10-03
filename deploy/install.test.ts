// install.sh and firewall/render.sh, without a VM: `--root` stages every file under a temporary
// directory and changes nothing on this host, and `--no-docker` skips Docker.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { stub } from "./test-helpers.ts";

// Each test spawns install.sh (a shell script calling many tools) two or more times; under a
// loaded CI runner that can exceed the default 5 s, which is a timeout, not a failure.
vi.setConfig({ testTimeout: 30_000 });

const here = dirname(fileURLToPath(import.meta.url));
const INSTALL = join(here, "install.sh");
const RENDER = join(here, "firewall", "render.sh");

const DEBIAN_13 = [
  'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"',
  "ID=debian",
  'VERSION_ID="13"',
  "VERSION_CODENAME=trixie",
].join("\n");

const ANSWERS = [
  "--non-interactive",
  "--no-docker",
  "--hostname",
  "money.example.com",
  "--backup-server",
  "rest:https://nas.lan:8000/pangolin",
  "--npm-host",
  "192.168.1.10",
  "--admin-network",
  "192.168.1.0/24",
  "--dns",
  "192.168.1.1",
];

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pangolin-install-"));
  mkdirSync(join(root, "etc"));
  writeFileSync(join(root, "etc", "os-release"), `${DEBIAN_13}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, args: readonly string[], env: Record<string, string> = {}): Run {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    // No SSH session, so no lockout warning depends on how the tests are run.
    env: { ...process.env, SSH_CONNECTION: "", ...env },
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function install(...extra: string[]): Run {
  return run("sh", [INSTALL, "--root", root, ...ANSWERS, ...extra]);
}

/**
 * Runs install.sh under --root with the Docker steps on, against a stub `docker` on PATH that
 * logs its arguments to `docker.log`. `STUB_HEALTH` sets what `inspect` reports (default
 * healthy); `STUB_IMAGE_MISSING=1` makes `image inspect` fail. `STUB_PULL_DENIED=1` makes
 * `pull` fail until a `login` has read the token `good-token`. A stub `git` logs to `git.log`.
 */
function installWithDocker(extra: readonly string[], env: Record<string, string> = {}): Run {
  const args = ANSWERS.filter((arg) => arg !== "--no-docker");
  return run("sh", [INSTALL, "--root", root, ...args, ...extra], stubEnv(env));
}

function stubEnv(env: Record<string, string>): Record<string, string> {
  const bin = at("bin");
  mkdirSync(bin, { recursive: true });
  stub(bin, "git", [
    `echo "$*" >> "${at("git.log")}"`,
    'case "$*" in',
    '  clone*) for last; do :; done; mkdir -p "$last/.git" ;;',
    "  *rev-parse*) echo abc1234 ;;",
    "esac",
    "exit 0",
  ]);
  stub(bin, "docker", [
    `echo "$*" >> "${at("docker.log")}"`,
    'case "$*" in',
    `  login*) [ "$(cat)" = good-token ] || exit 1; touch "${at("logged-in")}" ;;`,
    `  pull*) [ "$STUB_PULL_DENIED" = 1 ] && [ ! -f "${at("logged-in")}" ] && { echo "denied" >&2; exit 1; } ;;`,
    '  "image inspect"*) [ "$STUB_IMAGE_MISSING" = 1 ] && exit 1 ;;',
    '  *" ps -q"*) echo stub-container-id ;;',
    '  inspect*) echo "$STUB_HEALTH" ;;',
    '  *" logs "*) echo "STUB-LOG-MARKER: migration failed" ;;',
    "esac",
    "exit 0",
  ]);
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    PANGOLIN_INSTALL_STUB_DOCKER: "1",
    PANGOLIN_HEALTH_TIMEOUT: "1",
    STUB_HEALTH: "healthy",
    STUB_IMAGE_MISSING: "0",
    STUB_PULL_DENIED: "0",
    ...env,
  };
}

/**
 * Runs install.sh interactively under `script`, which gives it a terminal and types `input`
 * (one answer per line) into it. Every answer is given as a flag except `--non-interactive`, so
 * only the questions under test (and the few with no flag) are asked.
 */
function installInteractively(
  input: string,
  extra: readonly string[],
  env: Record<string, string> = {},
): Run {
  const args = ANSWERS.filter((arg) => arg !== "--no-docker" && arg !== "--non-interactive");
  const command = ["sh", INSTALL, "--root", root, ...args, ...extra]
    .map((arg) => `'${arg}'`)
    .join(" ");
  const result = spawnSync("script", ["-qec", command, "/dev/null"], {
    encoding: "utf8",
    input,
    env: { ...process.env, SSH_CONNECTION: "", ...stubEnv(env) },
    timeout: 60_000,
  });
  // script merges both streams into the terminal's output.
  return { status: result.status, stdout: result.stdout, stderr: result.stdout };
}

const dockerLog = () => (existsSync(at("docker.log")) ? read("docker.log") : "");
const uid = process.getuid?.() ?? 0;

const at = (path: string) => join(root, path);
const mode = (path: string) => statSync(at(path)).mode & 0o777;
const read = (path: string) => readFileSync(at(path), "utf8");

/**
 * Pins .env's PANGOLIN_IMAGE by digest, as `pangolin upgrade` leaves it: the digest is `digit`
 * 64 times. Returns the image reference. Throws when .env has no PANGOLIN_IMAGE line.
 */
function pinDigest(digit: number): string {
  const digest = `ghcr.io/sbwilson/pangolin@sha256:${String(digit).repeat(64)}`;
  const env = read("opt/pangolin/.env");
  const line = /^PANGOLIN_IMAGE=.*$/m;
  if (!line.test(env)) throw new Error("pinDigest: .env has no PANGOLIN_IMAGE line");
  writeFileSync(at("opt/pangolin/.env"), env.replace(line, `PANGOLIN_IMAGE=${digest}`));
  return digest;
}

/**
 * Wraps the stub docker `stubEnv` wrote: a copy (mode and all) is kept as `docker-base`, and the
 * new `docker` runs `lines` first, then hands every call they do not end to `docker-base`.
 * Call it once per `stubEnv`: a second call would save the wrapper as `docker-base`, which would
 * then exec itself forever, so it throws when `docker-base` already exists.
 */
function wrapDocker(lines: readonly string[]): void {
  const bin = at("bin");
  if (existsSync(join(bin, "docker-base"))) {
    throw new Error("wrapDocker: docker is already wrapped; call stubEnv first");
  }
  copyFileSync(join(bin, "docker"), join(bin, "docker-base"));
  stub(bin, "docker", [...lines, `exec "${join(bin, "docker-base")}" "$@"`]);
}

const bundles = () =>
  existsSync(at("root"))
    ? readdirSync(at("root")).filter((name) => name.startsWith("pangolin-recovery-bundle-"))
    : [];
const SECRET_NAMES = ["auth-secret", "app-key", "restic-password"] as const;
type SecretName = (typeof SECRET_NAMES)[number];
const secrets = (): Record<SecretName, string> => ({
  "auth-secret": read("opt/pangolin/secrets/auth-secret"),
  "app-key": read("opt/pangolin/secrets/app-key"),
  "restic-password": read("opt/pangolin/secrets/restic-password"),
});

describe("install.sh, fresh install", () => {
  it("writes the files with the right modes, secrets, .env and allowlist", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);

    expect(mode("opt/pangolin/.env")).toBe(0o600);
    expect(mode("opt/pangolin/secrets")).toBe(0o700);
    expect(mode("opt/pangolin/secrets/auth-secret")).toBe(0o600);
    expect(mode("opt/pangolin/secrets/app-key")).toBe(0o600);
    // The container only reads the restic password.
    expect(mode("opt/pangolin/secrets/restic-password")).toBe(0o400);
    // Only the files the container mounts (auth secret, restic password) are its user's.
    expect(statSync(at("opt/pangolin/secrets")).uid).toBe(uid);
    expect(statSync(at("opt/pangolin/secrets/app-key")).uid).toBe(uid);
    if (uid === 0) {
      expect(statSync(at("opt/pangolin/secrets/auth-secret")).uid).toBe(1000);
      expect(statSync(at("opt/pangolin/secrets/restic-password")).uid).toBe(1000);
    }
    const compose = read("opt/pangolin/compose.yaml");
    expect(compose).toContain("./secrets/auth-secret:/secrets/auth-secret:");
    expect(compose).toContain("./secrets/restic-password:/secrets/restic-password:");
    expect(compose).toContain("PANGOLIN_RESTIC_PASSWORD_FILE: /secrets/restic-password");
    expect(compose).not.toMatch(/- \.\/secrets:/);
    expect(mode("srv/pangolin")).toBe(0o700);
    expect(mode("opt/pangolin/compose.yaml")).toBe(0o644);
    expect(mode("opt/pangolin/firewall/render.sh")).toBe(0o755);
    expect(existsSync(at("etc/systemd/system/pangolin-allowlist.service"))).toBe(true);
    expect(read("etc/systemd/system/pangolin-allowlist.timer")).toContain("OnUnitActiveSec=15min");

    const { "auth-secret": auth, "app-key": appKey, "restic-password": restic } = secrets();
    expect(auth.trim().length).toBeGreaterThanOrEqual(32);
    expect(Buffer.from(appKey.trim(), "base64")).toHaveLength(32);
    expect(restic.trim().length).toBeGreaterThanOrEqual(32);

    const env = read("opt/pangolin/.env");
    expect(env).toContain("PANGOLIN_PUBLIC_URL=https://money.example.com\n");
    expect(env).toContain("PANGOLIN_TRUSTED_PROXIES=192.168.1.10\n");
    expect(env).toContain("PANGOLIN_IMAGE=ghcr.io/sbwilson/pangolin:latest\n");
    expect(env).toContain("PANGOLIN_DATA_ROOT=/srv/pangolin\n");
    expect(env).toContain("PANGOLIN_BACKUP_REPOSITORY=rest:https://nas.lan:8000/pangolin\n");
    // No secret value in .env or compose.yaml.
    for (const value of [auth, appKey, restic]) {
      expect(env).not.toContain(value.trim());
      expect(read("opt/pangolin/compose.yaml")).not.toContain(value.trim());
    }

    const allowlist = read("opt/pangolin/allowlist.conf");
    for (const host of [
      "deb.debian.org",
      "security.debian.org",
      "download.docker.com",
      "ghcr.io",
      "pkg-containers.githubusercontent.com",
      "query1.finance.yahoo.com",
      "query2.finance.yahoo.com",
      "fc.yahoo.com",
      "nas.lan:8000",
    ]) {
      expect(allowlist).toContain(host);
    }
    // NTP goes to any server from the host instead: pool names rotate addresses.
    expect(allowlist).not.toMatch(/^[^#]*pool\.ntp\.org/m);

    // The firewall preview admits only the NPM host to the app and the admin network to SSH.
    const ruleset = read("opt/pangolin/firewall/pangolin.nft");
    expect(ruleset).toContain("ip saddr 192.168.1.10 tcp dport 3000 accept");
    expect(ruleset).toContain("ip saddr 192.168.1.0/24 tcp dport 22 accept");
    expect(ruleset).toContain("udp dport 123 accept");
    expect(read("opt/pangolin/proxmox-firewall.txt")).toContain(
      "IN ACCEPT -source 192.168.1.10 -p tcp -dport 3000",
    );
  });

  it("writes a 0600 recovery bundle, prints only its path, and never echoes a secret", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    const [bundle] = bundles();
    expect(bundle).toMatch(/^pangolin-recovery-bundle-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(mode(`root/${bundle}`)).toBe(0o600);
    const text = read(`root/${bundle}`);
    const values = secrets();
    expect(text).toContain(`PANGOLIN_APP_KEY=${values["app-key"].trim()}`);
    expect(text).toContain(`PANGOLIN_AUTH_SECRET=${values["auth-secret"].trim()}`);
    expect(text).toContain(`RESTIC_PASSWORD=${values["restic-password"].trim()}`);
    expect(result.stdout).toContain(`/root/${bundle}`);
    expect(result.stdout).toMatch(/offline/);
    for (const value of Object.values(values)) {
      expect(result.stdout + result.stderr).not.toContain(value.trim());
    }
  });

  it("prints the NPM proxy-host settings and the setup link", () => {
    mkdirSync(at("srv/pangolin"), { recursive: true });
    const link = "https://money.example.com/setup?token=abc123";
    writeFileSync(at("srv/pangolin/setup-link.txt"), `${link}\n`);
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Domain Names\s+money\.example\.com/);
    expect(result.stdout).toMatch(/Scheme\s+http\n/);
    expect(result.stdout).toMatch(/Forward Port\s+3000/);
    expect(result.stdout).toContain(link);
  });

  it("says an account exists when the server has run and removed the setup link", () => {
    // A first install writes the secrets the database needs; a re-run finds the database.
    expect(install().status).toBe(0);
    writeFileSync(at("srv/pangolin/pangolin.sqlite"), "");
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("An account already exists");
    expect(result.stdout).not.toContain("setup?token=");
  });

  it("proceeds with a loud warning when the data root is not encrypted", () => {
    const result = install();
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/NOT on a dm-crypt \(LUKS\) device/);
  });
});

describe("the pangolin command", () => {
  const WRAPPER = join(here, "pangolin");

  it("is installed to /usr/local/bin (0755) under --root, and the summary names it", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(mode("usr/local/bin/pangolin")).toBe(0o755);
    expect(read("usr/local/bin/pangolin")).toBe(readFileSync(WRAPPER, "utf8"));
    expect(result.stdout).toContain("Installed the pangolin command to /usr/local/bin/pangolin");
    expect(result.stdout).toMatch(/sudo pangolin status/);
    expect(result.stdout).toMatch(/sudo pangolin reset-user <email>/);
  });

  /** Runs the wrapper against a stub `docker` that logs its arguments; `stack` sets `ps`. */
  function wrapper(
    args: readonly string[],
    stack: "running" | "stopped" | "broken",
    runExit = 0,
  ): Run {
    const home = at("opt/pangolin");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "compose.yaml"), "services: {}\n");
    writeFileSync(join(home, ".env"), "", { mode: 0o600 });
    const bin = at("bin");
    mkdirSync(bin, { recursive: true });
    stub(bin, "docker", [
      `echo "$*" >> "${at("docker.log")}"`,
      'case "$*" in',
      '  *" ps "*)',
      `    [ "${stack}" = broken ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }`,
      `    [ "${stack}" = running ] && echo stub-container-id ;;`,
      // runExit -1: the run is interrupted (SIGTERM to the wrapper, the stub's parent).
      runExit === -1
        ? `  *" run "*) kill -TERM $PPID; exit 143 ;;`
        : `  *" run "*) exit ${runExit} ;;`,
      "esac",
      "exit 0",
    ]);
    return run("sh", [WRAPPER, ...args], {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PANGOLIN_HOME: home,
    });
  }

  it("runs the CLI in the running container over the admin socket", () => {
    const result = wrapper(["status"], "running");
    expect(result.status, result.stderr).toBe(0);
    const home = at("opt/pangolin");
    expect(dockerLog().trim().split("\n")).toEqual([
      `compose --project-directory ${home} -f ${home}/compose.yaml ps -q --status running pangolin`,
      `compose --project-directory ${home} -f ${home}/compose.yaml exec -T pangolin node dist/cli.js status`,
    ]);
  });

  it("passes confirm-bundle to the running container's CLI, with no terminal (-T)", () => {
    const result = wrapper(["confirm-bundle"], "running");
    expect(result.status, result.stderr).toBe(0);
    const home = at("opt/pangolin");
    expect(dockerLog().trim().split("\n").at(-1)).toBe(
      `compose --project-directory ${home} -f ${home}/compose.yaml exec -T pangolin node dist/cli.js confirm-bundle`,
    );
  });

  it("runs the CLI in a one-off container when the stack is stopped", () => {
    const result = wrapper(["reset-user", "alex@example.com"], "stopped");
    expect(result.status, result.stderr).toBe(0);
    expect(dockerLog()).toContain(
      "run --rm --no-deps -T pangolin node dist/cli.js reset-user alex@example.com",
    );
    expect(dockerLog()).not.toContain(" exec ");
  });

  it("restore stops the stack, restores in a one-off container, and starts the stack again", () => {
    const home = at("opt/pangolin");
    const compose = `compose --project-directory ${home} -f ${home}/compose.yaml`;
    const result = wrapper(["restore", "--keep-credentials", "latest"], "running");
    expect(result.status, result.stderr).toBe(0);
    expect(dockerLog().trim().split("\n")).toEqual([
      `${compose} stop pangolin`,
      `${compose} run --rm --no-deps -T pangolin node dist/cli.js restore --keep-credentials latest`,
      `${compose} up -d pangolin`,
    ]);
  });

  it("restore with no flag and no terminal refuses before stopping anything", () => {
    const result = wrapper(["restore", "latest"], "running");
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--restore-credentials or --keep-credentials/);
    expect(existsSync(at("docker.log"))).toBe(false);
  });

  it("restore starts the stack again after a failed check, and keeps the CLI's exit code", () => {
    const result = wrapper(["restore", "--restore-credentials"], "running", 1);
    expect(result.status).toBe(1);
    expect(dockerLog().trim().split("\n").at(-1)).toMatch(/ up -d pangolin$/);
  });

  it("restore refuses bad arguments with a usage error before stopping anything", () => {
    for (const args of [
      ["restore", "../x"],
      ["restore", "latest", "extra"],
      ["restore", "XYZ"],
      ["restore", "--keep-credentials", "--restore-credentials"],
      ["restore", "--keep-credentials", "--keep-credentials"],
      ["restore", "--nope"],
    ]) {
      const result = wrapper(args, "running");
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/usage: pangolin restore/);
    }
    expect(existsSync(at("docker.log"))).toBe(false);
  });

  it("restore starts the stack again when the one-off run is interrupted", () => {
    const result = wrapper(["restore", "--keep-credentials", "latest"], "running", -1);
    expect(result.status).toBe(143);
    expect(dockerLog().trim().split("\n").at(-1)).toMatch(/ up -d pangolin$/);
  });

  it("stops clearly when docker compose ps fails, never falling through to run", () => {
    const result = wrapper(["reset-user", "alex@example.com"], "broken");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/docker compose ps failed/);
    expect(dockerLog()).not.toContain(" run ");
    expect(dockerLog()).not.toContain(" exec ");
  });

  it("stops clearly when Pangolin Money is not installed", () => {
    const result = run("sh", [WRAPPER, "status"], { PANGOLIN_HOME: at("nowhere") });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/is Pangolin Money installed/);
  });
});

describe("install.sh, re-run", () => {
  it("keeps the secrets and the operator's .env edits, and only adds missing keys", () => {
    expect(install().status).toBe(0);
    const before = secrets();
    const envPath = at("opt/pangolin/.env");
    const edited = read("opt/pangolin/.env")
      .replace(
        "PANGOLIN_PUBLIC_URL=https://money.example.com",
        "PANGOLIN_PUBLIC_URL=https://cash.example.com",
      )
      .replace(/^PANGOLIN_HTTP_PORT=.*\n/m, "")
      .concat("PANGOLIN_AUTH_RATE_LIMIT=20\n");
    writeFileSync(envPath, edited);
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));

    const result = install("--hostname", "other.example.com");
    expect(result.status, result.stderr).toBe(0);
    expect(secrets()).toEqual(before);
    const env = read("opt/pangolin/.env");
    expect(env).toContain("PANGOLIN_PUBLIC_URL=https://cash.example.com\n");
    expect(env).not.toContain("other.example.com");
    expect(env).toContain("PANGOLIN_AUTH_RATE_LIMIT=20\n");
    expect(env).toContain("PANGOLIN_HTTP_PORT=3000\n");
    expect(env.match(/^PANGOLIN_NPM_HOST=/gm)).toHaveLength(1);
    expect(mode("opt/pangolin/.env")).toBe(0o600);
    expect(result.stderr).toMatch(/kept PANGOLIN_PUBLIC_URL=https:\/\/cash\.example\.com/);
    // The bundle is written again only on request.
    expect(bundles()).toEqual([]);
  });

  it("re-runs with no answers, from the existing .env", () => {
    expect(install().status).toBe(0);
    const result = run("sh", [INSTALL, "--root", root, "--non-interactive", "--no-docker"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Nothing to add");
  });

  it("keeps an edited allowlist, adding only the backup server it lacks", () => {
    expect(install().status).toBe(0);
    writeFileSync(at("opt/pangolin/allowlist.conf"), "example.org:443\n");
    expect(install().status).toBe(0);
    const allowlist = read("opt/pangolin/allowlist.conf");
    expect(allowlist.startsWith("example.org:443\n")).toBe(true);
    expect(allowlist).not.toContain("deb.debian.org");
  });

  it("replaces PANGOLIN_BACKUP_REPOSITORY for --backup-server and allowlists its host", () => {
    expect(install("--backup-server", "rest:https://old.example.com/p").status).toBe(0);
    const result = install("--backup-server", "rest:https://restic.example.net/pangolin");
    expect(result.status, result.stderr).toBe(0);
    const env = read("opt/pangolin/.env");
    expect(env).toContain("PANGOLIN_BACKUP_REPOSITORY=rest:https://restic.example.net/pangolin\n");
    expect(env.match(/^PANGOLIN_BACKUP_REPOSITORY=/gm)).toHaveLength(1);
    expect(result.stdout).toMatch(/Replacing PANGOLIN_BACKUP_REPOSITORY in \.env/);
    expect(read("opt/pangolin/allowlist.conf")).toContain("restic.example.net:443\n");
  });

  it("replaces PANGOLIN_DNS_SERVERS for --dns, and renders the firewall with it", () => {
    expect(install().status).toBe(0);
    expect(read("opt/pangolin/.env")).toContain("PANGOLIN_DNS_SERVERS=192.168.1.1\n");
    const result = install("--dns", "10.0.0.9");
    expect(result.status, result.stderr).toBe(0);
    const env = read("opt/pangolin/.env");
    expect(env).toContain("PANGOLIN_DNS_SERVERS=10.0.0.9\n");
    expect(env.match(/^PANGOLIN_DNS_SERVERS=/gm)).toHaveLength(1);
    expect(result.stdout).toMatch(/Replacing PANGOLIN_DNS_SERVERS in \.env/);
    expect(result.stderr).not.toMatch(/kept PANGOLIN_DNS_SERVERS/);
    expect(read("opt/pangolin/firewall/pangolin.nft")).toMatch(
      /set dns4 \{[^}]*elements = \{ 10\.0\.0\.9 \}/,
    );
  });

  it("renders a staged install's firewall with the host resolvers under --root", () => {
    writeFileSync(at("etc/resolv.conf"), "nameserver 10.0.0.9\n");
    expect(install().status).toBe(0);
    expect(read("opt/pangolin/firewall/pangolin.nft")).toMatch(
      /set dns4 \{[^}]*elements = \{ 10\.0\.0\.9, 192\.168\.1\.1 \}/,
    );
    expect(read("opt/pangolin/proxmox-firewall.txt")).toContain(
      "OUT ACCEPT -dest 10.0.0.9 -p udp -dport 53 # DNS",
    );

    // Behind systemd-resolved's stub, its upstream file under the root is read instead.
    writeFileSync(at("etc/resolv.conf"), "nameserver 127.0.0.53\n");
    mkdirSync(at("run/systemd/resolve"), { recursive: true });
    writeFileSync(at("run/systemd/resolve/resolv.conf"), "nameserver 10.0.0.7\n");
    const result = run("sh", [INSTALL, "--root", root, "--non-interactive", "--no-docker"]);
    expect(result.status, result.stderr).toBe(0);
    const ruleset = read("opt/pangolin/firewall/pangolin.nft");
    expect(ruleset).toMatch(/set dns4 \{[^}]*elements = \{ 10\.0\.0\.7, 192\.168\.1\.1 \}/);
    expect(ruleset).not.toContain("127.0.0.53");
    expect(read("opt/pangolin/proxmox-firewall.txt")).toContain(
      "OUT ACCEPT -dest 10.0.0.7 -p tcp -dport 53 # DNS",
    );
  });

  it("keeps PANGOLIN_DNS_SERVERS on a plain re-run", () => {
    expect(install().status).toBe(0);
    const result = run("sh", [INSTALL, "--root", root, "--non-interactive", "--no-docker"]);
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).toContain("PANGOLIN_DNS_SERVERS=192.168.1.1\n");
    expect(result.stdout).not.toMatch(/Replacing PANGOLIN_DNS_SERVERS/);
  });

  it("replaces PANGOLIN_IMAGE when --image is given, and says so", () => {
    expect(install().status).toBe(0);
    const result = install("--image", "ghcr.io/sbwilson/pangolin:1.2.3");
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).toContain("PANGOLIN_IMAGE=ghcr.io/sbwilson/pangolin:1.2.3\n");
    expect(read("opt/pangolin/.env").match(/^PANGOLIN_IMAGE=/gm)).toHaveLength(1);
    expect(result.stdout).toMatch(/Replacing PANGOLIN_IMAGE in \.env/);
    const build = install("--build");
    expect(build.status, build.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).toContain("PANGOLIN_IMAGE=pangolin:local\n");
  });

  it("replaces PANGOLIN_DATA_ROOT for --data-root, and checks and prepares the new one", () => {
    expect(install().status).toBe(0);
    const result = install("--data-root", "/srv/other");
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).toContain("PANGOLIN_DATA_ROOT=/srv/other\n");
    expect(result.stdout).toMatch(
      /Replacing PANGOLIN_DATA_ROOT in \.env: \/srv\/pangolin -> \/srv\/other/,
    );
    expect(result.stdout).toContain("Preparing /opt/pangolin and /srv/other");
    expect(result.stderr).toMatch(/data root \/srv\/other is NOT on a dm-crypt/);
    expect(mode("srv/other")).toBe(0o700);
    // No database was left behind, so there is nothing to warn about.
    expect(result.stderr).not.toMatch(/holds the household database/);
  });

  it("warns when a changed data root leaves the household database behind", () => {
    expect(install().status).toBe(0);
    writeFileSync(at("srv/pangolin/pangolin.sqlite"), "household");
    const result = install("--data-root", "/srv/other");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(
      /data root moves from \/srv\/pangolin, which holds the household database, to \/srv\/other, which has none/,
    );
    // A new data root that already holds a database is not warned about.
    writeFileSync(at("srv/other/pangolin.sqlite"), "household");
    const back = install("--data-root", "/srv/pangolin");
    expect(back.status, back.stderr).toBe(0);
    expect(back.stdout).toMatch(
      /Replacing PANGOLIN_DATA_ROOT in \.env: \/srv\/other -> \/srv\/pangolin/,
    );
    expect(back.stderr).not.toMatch(/holds the household database/);
  });

  it("writes the bundle again with --bundle", () => {
    expect(install().status).toBe(0);
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    expect(install("--bundle").status).toBe(0);
    expect(bundles()).toHaveLength(1);
  });

  // Seam S11e (spike "Check the suspected seams"), fixed by story 11.9. A re-run of install.sh
  // from a checkout (or the --build clone) used to copy its own compose.yaml and pangolin command
  // over the ones a later `pangolin upgrade` installed from the new image, while .env kept that
  // image's digest. While .env pins an image by digest and the run does not replace the image,
  // they now come from that image, as a lone script already does.
  it("S11e: takes compose.yaml and the pangolin command from the image .env pins", () => {
    expect(install().status).toBe(0);
    // As `pangolin upgrade` leaves it: the new image's digest pinned in .env.
    const digest = pinDigest(1);
    // The stub docker, plus an image whose /app/deploy carries marked compose.yaml and command.
    const env = stubEnv({});
    wrapDocker([
      'case "$1" in',
      `  create) echo "$*" >> "${at("docker.log")}"; echo stub-container; exit 0 ;;`,
      "  cp)",
      `    echo "$*" >> "${at("docker.log")}"`,
      `    cp -R "${here}" "$3"`,
      `    echo "# compose.yaml from the pinned image" > "$3/compose.yaml"`,
      `    printf '#!/bin/sh\n# pangolin from the pinned image\n' > "$3/pangolin"`,
      "    exit 0 ;;",
      "esac",
    ]);
    const args = ANSWERS.filter((arg) => arg !== "--no-docker");
    const result = run("sh", [INSTALL, "--root", root, ...args], env);
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).toContain(`PANGOLIN_IMAGE=${digest}\n`);
    expect(dockerLog()).toContain(`create ${digest}`);
    expect(read("opt/pangolin/compose.yaml")).toBe("# compose.yaml from the pinned image\n");
    expect(read("usr/local/bin/pangolin")).toContain("# pangolin from the pinned image");
    expect(result.stdout).toContain(
      `Taking compose.yaml and the pangolin command from the pinned image ${digest}`,
    );
  });

  it("keeps the checkout's files for a tag-pinned image, and warns when the pinned image is unreadable", () => {
    expect(installWithDocker([]).status).toBe(0);
    const checkoutCompose = read("opt/pangolin/compose.yaml");
    // Tag-pinned (as install.sh writes it): the image is not read.
    const tagged = installWithDocker([]);
    expect(tagged.status, tagged.stderr).toBe(0);
    expect(tagged.stdout).not.toContain("from the pinned image");
    expect(dockerLog()).not.toMatch(/^create .*@sha256:/m);
    expect(read("opt/pangolin/compose.yaml")).toBe(checkoutCompose);
    // Digest-pinned, but the image cannot be read: a warning, and the checkout's files.
    const digest = pinDigest(2);
    const env = stubEnv({});
    wrapDocker([`[ "$1" = create ] && { echo "$*" >> "${at("docker.log")}"; exit 1; }`]);
    const args = ANSWERS.filter((arg) => arg !== "--no-docker");
    const unreadable = run("sh", [INSTALL, "--root", root, ...args], env);
    expect(unreadable.status, unreadable.stderr).toBe(0);
    expect(unreadable.stderr).toContain(`could not read the pinned image ${digest}`);
    expect(dockerLog()).toContain(`create ${digest}`);
    expect(read("opt/pangolin/compose.yaml")).toBe(checkoutCompose);
  });

  it("never reads the pinned image with --no-docker", () => {
    expect(install().status).toBe(0);
    pinDigest(3);
    const noDocker = install();
    expect(noDocker.status, noDocker.stderr).toBe(0);
    expect(noDocker.stdout).not.toContain("from the pinned image");
    expect(noDocker.stderr).not.toContain("pinned image");
  });

  // Seam S11f (spike "Check the suspected seams"), fixed by story 11.10. `--backup-server ""`
  // used to be taken as "no answer": the existing PANGOLIN_BACKUP_REPOSITORY was kept (with two
  // contradictory warnings), so the flag could not turn backups off. It now empties the value,
  // drops the old repository's allowlist entry and says, once, that backups are off.
  it('S11f: --backup-server "" turns backups off in .env', () => {
    expect(install().status).toBe(0);
    expect(read("opt/pangolin/.env")).toContain(
      "PANGOLIN_BACKUP_REPOSITORY=rest:https://nas.lan:8000/pangolin\n",
    );
    const result = install("--backup-server", "");
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).not.toMatch(/^PANGOLIN_BACKUP_REPOSITORY=\S/m);
  });

  it('--backup-server "" drops the old allowlist entry and says once that backups are off', () => {
    expect(install().status).toBe(0);
    expect(read("opt/pangolin/allowlist.conf")).toMatch(/^nas\.lan:8000$/m);
    const result = install("--backup-server", "");
    expect(result.status, result.stderr).toBe(0);
    const allowlist = read("opt/pangolin/allowlist.conf");
    expect(allowlist).not.toMatch(/^nas\.lan:8000$/m);
    expect(allowlist).not.toContain("# Backup server");
    expect(allowlist).toContain("deb.debian.org");
    expect(`${result.stdout}${result.stderr}`.match(/backups are off/gi)).toHaveLength(1);
    expect(result.stderr).not.toContain("kept PANGOLIN_BACKUP_REPOSITORY");
    expect(result.stderr).not.toContain("no backup server set");
  });

  it("keeps the stored backup server on a re-run without --backup-server", () => {
    expect(install().status).toBe(0);
    const args = ANSWERS.filter(
      (arg) => arg !== "--backup-server" && arg !== "rest:https://nas.lan:8000/pangolin",
    );
    const result = run("sh", [INSTALL, "--root", root, ...args]);
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).toContain(
      "PANGOLIN_BACKUP_REPOSITORY=rest:https://nas.lan:8000/pangolin\n",
    );
    expect(read("opt/pangolin/allowlist.conf")).toMatch(/^nas\.lan:8000$/m);
    expect(result.stdout).not.toMatch(/backups are off/i);
  });

  it("writes no recovery bundle when the backup server is emptied", () => {
    expect(install().status).toBe(0);
    const id = read("opt/pangolin/.env").match(/^PANGOLIN_RECOVERY_BUNDLE_ID=.*$/m)?.[0];
    expect(id).toBeDefined();
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    const result = install("--backup-server", "");
    expect(result.status, result.stderr).toBe(0);
    expect(bundles()).toEqual([]);
    expect(read("opt/pangolin/.env").match(/^PANGOLIN_RECOVERY_BUNDLE_ID=.*$/m)?.[0]).toBe(id);
    expect(existsSync(at("opt/pangolin/secrets/.bundle-pending"))).toBe(false);
  });

  it("keeps a backup host the operator listed themselves when backups are turned off", () => {
    expect(install().status).toBe(0);
    writeFileSync(at("opt/pangolin/allowlist.conf"), "# my NAS\nnas.lan:8000\nexample.org:443\n");
    const result = install("--backup-server", "");
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/allowlist.conf")).toBe("# my NAS\nnas.lan:8000\nexample.org:443\n");
    expect(result.stdout).toContain(
      "Kept nas.lan:8000 in allowlist.conf: install.sh did not write it there",
    );
  });

  it("keeps an operator-added allowlist line when backups are turned off", () => {
    expect(install().status).toBe(0);
    writeFileSync(
      at("opt/pangolin/allowlist.conf"),
      `${read("opt/pangolin/allowlist.conf")}\n# my own\nnas.lan:9000\nexample.org:443\n`,
    );
    expect(install("--backup-server", "").status).toBe(0);
    const allowlist = read("opt/pangolin/allowlist.conf");
    expect(allowlist).not.toMatch(/^nas\.lan:8000$/m);
    expect(allowlist).toContain("# my own\nnas.lan:9000\nexample.org:443\n");
  });

  it('treats --backup-server "" on a first install as no backups, with one line', () => {
    const result = install("--backup-server", "");
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/.env")).not.toMatch(/^PANGOLIN_BACKUP_REPOSITORY=\S/m);
    expect(read("opt/pangolin/allowlist.conf")).not.toMatch(/^nas\.lan:8000$/m);
    expect(`${result.stdout}${result.stderr}`.match(/backups are off/gi)).toHaveLength(1);
    expect(result.stderr).not.toContain("no backup server set");
  });
});

describe("install.sh, recovery bundle id", () => {
  const BUNDLE_ID = /^PANGOLIN_RECOVERY_BUNDLE_ID=(\d{8}T\d{6}Z-[0-9a-f]{4})$/m;
  const bundleId = (): string | undefined => read("opt/pangolin/.env").match(BUNDLE_ID)?.[1];
  const bundleText = () => {
    const [bundle] = bundles();
    return bundle === undefined ? "" : read(`root/${bundle}`);
  };

  it("gives the first bundle an id in .env, prints it in the bundle, and says to confirm it", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    const id = bundleId();
    expect(id).toBeDefined();
    expect(read("opt/pangolin/.env").match(/^PANGOLIN_RECOVERY_BUNDLE_ID=/gm)).toHaveLength(1);
    expect(bundleText()).toContain(`Bundle id: ${id}\n`);
    expect(result.stdout).toContain(`Its id is ${id}`);
    expect(result.stdout).toContain("sudo pangolin confirm-bundle");
    expect(result.stdout).toMatch(/sudo pangolin confirm-bundle +the recovery bundle/);
    // The bundle sets the id; no throwaway id is added first.
    expect(result.stdout).not.toMatch(/Added:.*PANGOLIN_RECOVERY_BUNDLE_ID/);
  });

  it("keeps the id on a plain re-run, which writes no bundle", () => {
    expect(install().status).toBe(0);
    const id = bundleId();
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(bundles()).toEqual([]);
    expect(bundleId()).toBe(id);
    expect(result.stdout).not.toContain("now tracks whether its recovery bundle");
  });

  it("gives a bundle written again with --bundle a new id, so the warning comes back", () => {
    expect(install().status).toBe(0);
    const first = bundleId();
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    const result = install("--bundle");
    expect(result.status, result.stderr).toBe(0);
    const second = bundleId();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(read("opt/pangolin/.env").match(/^PANGOLIN_RECOVERY_BUNDLE_ID=/gm)).toHaveLength(1);
    expect(bundleText()).toContain(`Bundle id: ${second}\n`);
    expect(mode("opt/pangolin/.env")).toBe(0o600);
  });

  it("gives a regenerated secret's bundle a new id", () => {
    expect(install().status).toBe(0);
    const first = bundleId();
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    rmSync(at("opt/pangolin/secrets/app-key"));
    expect(install().status).toBe(0);
    expect(bundles()).toHaveLength(1);
    expect(bundleId()).not.toBe(first);
  });

  it("adds an id to an install that has none, without writing a bundle", () => {
    expect(install().status).toBe(0);
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    writeFileSync(
      at("opt/pangolin/.env"),
      read("opt/pangolin/.env").replace(/^PANGOLIN_RECOVERY_BUNDLE_ID=.*\n/m, ""),
    );
    expect(bundleId()).toBeUndefined();
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    const id = bundleId();
    expect(id).toBeDefined();
    expect(bundles()).toEqual([]);
    expect(result.stdout).toContain("Added: PANGOLIN_RECOVERY_BUNDLE_ID");
    expect(result.stdout).toContain(`bundle id${"\n"}  ${id} in .env`);
    expect(result.stdout).toContain("sudo pangolin confirm-bundle");
  });

  it("replaces an empty id line with an id, without writing a bundle", () => {
    expect(install().status).toBe(0);
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    writeFileSync(
      at("opt/pangolin/.env"),
      read("opt/pangolin/.env").replace(
        /^PANGOLIN_RECOVERY_BUNDLE_ID=.*$/m,
        "PANGOLIN_RECOVERY_BUNDLE_ID=",
      ),
    );
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(bundleId()).toBeDefined();
    expect(read("opt/pangolin/.env").match(/^PANGOLIN_RECOVERY_BUNDLE_ID=/gm)).toHaveLength(1);
    expect(bundles()).toEqual([]);
    expect(result.stdout).toMatch(/Added:.*PANGOLIN_RECOVERY_BUNDLE_ID/);
    expect(result.stdout).toContain("sudo pangolin confirm-bundle");
  });
});

describe("install.sh, a bundle that survives an interrupted install", () => {
  const BUNDLE_ID = /^PANGOLIN_RECOVERY_BUNDLE_ID=(\d{8}T\d{6}Z-[0-9a-f]{4})$/m;
  const bundleId = (): string | undefined => read("opt/pangolin/.env").match(BUNDLE_ID)?.[1];
  const bundleText = () => {
    const [bundle] = bundles();
    return bundle === undefined ? "" : read(`root/${bundle}`);
  };
  const PENDING = "opt/pangolin/secrets/.bundle-pending";
  const removeBundles = () => {
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
  };
  const dropBundleId = () =>
    writeFileSync(
      at("opt/pangolin/.env"),
      read("opt/pangolin/.env").replace(/^PANGOLIN_RECOVERY_BUNDLE_ID=.*\n/m, ""),
    );
  // The acceptance criterion: .env names the bundle last written, and that bundle says so.
  const expectIdMatchesBundle = () => {
    const id = bundleId();
    expect(id).toBeDefined();
    expect(read("opt/pangolin/.env").match(/^PANGOLIN_RECOVERY_BUNDLE_ID=/gm)).toHaveLength(1);
    expect(bundles()).toHaveLength(1);
    expect(bundleText()).toContain(`Bundle id: ${id}\n`);
    return id;
  };

  it("writes the bundle on the re-run after a first install that died before writing it", () => {
    // /root as a file: write_bundle fails after the secrets and .env are written.
    writeFileSync(at("root"), "not a directory");
    const died = install();
    expect(died.status).not.toBe(0);
    expect(died.stdout).toContain("Generated the secret auth-secret");
    expect(existsSync(at(PENDING))).toBe(true);
    expect(mode(PENDING)).toBe(0o600);
    expect(statSync(at(PENDING)).uid).toBe(uid);
    expect(bundleId()).toBeUndefined();
    const before = secrets();

    rmSync(at("root"));
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(secrets()).toEqual(before);
    const id = expectIdMatchesBundle();
    expect(result.stdout).toContain(`Its id is ${id}`);
    expect(result.stdout).not.toContain("now tracks whether its recovery bundle");
    expect(result.stdout).not.toContain("the bundle you already have");
    expect(result.stdout).not.toMatch(/Added:.*PANGOLIN_RECOVERY_BUNDLE_ID/);
    expect(existsSync(at(PENDING))).toBe(false);
    for (const name of SECRET_NAMES) expect(bundleText()).toContain(before[name].trim());

    // Bundled now: a plain re-run writes nothing.
    removeBundles();
    const again = install();
    expect(again.status, again.stderr).toBe(0);
    expect(bundles()).toEqual([]);
    expect(bundleId()).toBe(id);
  });

  it("writes the bundle while the pending mark is there, instead of only adding an id", () => {
    expect(install().status).toBe(0);
    const first = bundleId();
    removeBundles();
    dropBundleId();
    writeFileSync(at(PENDING), "");
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    const id = expectIdMatchesBundle();
    expect(id).not.toBe(first);
    expect(result.stdout).toContain(`Its id is ${id}`);
    expect(result.stdout).not.toContain("now tracks whether its recovery bundle");
    expect(existsSync(at(PENDING))).toBe(false);
  });

  it("leaves no pending mark after an uninterrupted first install; a re-run writes nothing", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expectIdMatchesBundle();
    expect(existsSync(at(PENDING))).toBe(false);
    removeBundles();
    expect(install().status).toBe(0);
    expect(bundles()).toEqual([]);
  });

  it("writes a new bundle with RESTIC_REPOSITORY when a backup server is added later", () => {
    expect(install("--backup-server", "").status).toBe(0);
    const first = bundleId();
    expect(bundleText()).not.toContain("RESTIC_REPOSITORY=");
    removeBundles();
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    const id = expectIdMatchesBundle();
    expect(id).not.toBe(first);
    expect(bundleText()).toContain("RESTIC_REPOSITORY=rest:https://nas.lan:8000/pangolin\n");
    expect(result.stdout).toContain(`Its id is ${id}`);
    expect(result.stdout).toContain("Rewritten to include the backup repository");
  });

  it("writes a new bundle with the new repository when the backup server changes", () => {
    expect(install().status).toBe(0);
    const first = bundleId();
    removeBundles();
    const result = install("--backup-server", "rest:https://restic.example.net/pangolin");
    expect(result.status, result.stderr).toBe(0);
    const id = expectIdMatchesBundle();
    expect(id).not.toBe(first);
    expect(bundleText()).toContain("RESTIC_REPOSITORY=rest:https://restic.example.net/pangolin\n");
    expect(bundleText()).not.toContain("nas.lan");
    expect(result.stdout).toContain("Rewritten to include the backup repository");
  });

  it("writes no bundle when the backup server is unchanged or not given", () => {
    expect(install().status).toBe(0);
    const id = bundleId();
    removeBundles();
    const same = install();
    expect(same.status, same.stderr).toBe(0);
    expect(bundles()).toEqual([]);
    expect(same.stdout).not.toContain("Rewritten to include the backup repository");
    const bare = run("sh", [INSTALL, "--root", root, "--non-interactive", "--no-docker"]);
    expect(bare.status, bare.stderr).toBe(0);
    expect(bundles()).toEqual([]);
    expect(bare.stdout).not.toContain("Rewritten to include the backup repository");
    expect(bundleId()).toBe(id);
    expect(existsSync(at(PENDING))).toBe(false);
  });

  it('takes --backup-server "" on an install with a repository as no backup change', () => {
    expect(install().status).toBe(0);
    removeBundles();
    const result = install("--backup-server", "");
    expect(result.status, result.stderr).toBe(0);
    expect(bundles()).toEqual([]);
    expect(existsSync(at(PENDING))).toBe(false);
  });

  it("retries the bundle for a backup change whose run died before writing it", () => {
    expect(install().status).toBe(0);
    const first = bundleId();
    rmSync(at("root"), { recursive: true });
    writeFileSync(at("root"), "not a directory");
    const died = install("--backup-server", "rest:https://restic.example.net/pangolin");
    expect(died.status).not.toBe(0);
    expect(read("opt/pangolin/.env")).toContain(
      "PANGOLIN_BACKUP_REPOSITORY=rest:https://restic.example.net/pangolin\n",
    );
    expect(existsSync(at(PENDING))).toBe(true);

    rmSync(at("root"));
    const result = run("sh", [INSTALL, "--root", root, "--non-interactive", "--no-docker"]);
    expect(result.status, result.stderr).toBe(0);
    const id = expectIdMatchesBundle();
    expect(id).not.toBe(first);
    expect(bundleText()).toContain("RESTIC_REPOSITORY=rest:https://restic.example.net/pangolin\n");
    expect(existsSync(at(PENDING))).toBe(false);
  });

  it("says the bundle includes the backup repository for --bundle with a changed server", () => {
    expect(install().status).toBe(0);
    removeBundles();
    const result = install(
      "--bundle",
      "--backup-server",
      "rest:https://restic.example.net/pangolin",
    );
    expect(result.status, result.stderr).toBe(0);
    expectIdMatchesBundle();
    expect(bundleText()).toContain("RESTIC_REPOSITORY=rest:https://restic.example.net/pangolin\n");
    expect(result.stdout).toContain("Rewritten to include the backup repository");
  });

  it("writes a bundle, not just an id, for an install with no id and a changed backup server", () => {
    expect(install().status).toBe(0);
    removeBundles();
    dropBundleId();
    const result = install("--backup-server", "rest:https://restic.example.net/pangolin");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/Added:.*PANGOLIN_RECOVERY_BUNDLE_ID/);
    expect(result.stdout).not.toContain("now tracks whether its recovery bundle");
    expectIdMatchesBundle();
  });

  it("marks the bundle pending when a later run regenerates a secret", () => {
    expect(install().status).toBe(0);
    rmSync(at("opt/pangolin/secrets/app-key"));
    rmSync(at("root"), { recursive: true });
    writeFileSync(at("root"), "not a directory");
    const died = install();
    expect(died.status).not.toBe(0);
    expect(died.stdout).toContain("Generated the secret app-key");
    expect(existsSync(at(PENDING))).toBe(true);
    expect(mode(PENDING)).toBe(0o600);

    rmSync(at("root"));
    expect(install().status).toBe(0);
    expectIdMatchesBundle();
    expect(bundleText()).toContain(`PANGOLIN_APP_KEY=${secrets()["app-key"].trim()}\n`);
    expect(existsSync(at(PENDING))).toBe(false);
  });

  it("only adds an id to a pre-existing install with no mark and no backup change", () => {
    expect(install().status).toBe(0);
    removeBundles();
    dropBundleId();
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(bundleId()).toBeDefined();
    expect(bundles()).toEqual([]);
    expect(result.stdout).toContain("now tracks whether its recovery bundle");
  });
});

describe("install.sh, secrets over an existing database", () => {
  const UNINSTALL = join(here, "uninstall.sh");
  // What the server leaves in the data root once it has run.
  const database = () => writeFileSync(at("srv/pangolin/pangolin.sqlite"), "household");
  const secretModes = () =>
    Object.fromEntries(SECRET_NAMES.map((name) => [name, mode(`opt/pangolin/secrets/${name}`)]));

  // Each damage, and what the refused run must leave app-key as (null: absent).
  it.each([
    ["missing", (file: string) => rmSync(at(file)), null],
    ["empty", (file: string) => writeFileSync(at(file), ""), ""],
    ["blank (whitespace only)", (file: string) => writeFileSync(at(file), " \n"), " \n"],
  ] as const)(
    "refuses a %s secret before writing any, naming it and the way back",
    (_, damage, after) => {
      expect(install().status).toBe(0);
      database();
      for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
      const before = secrets();
      const modes = secretModes();
      damage("opt/pangolin/secrets/app-key");

      const result = install();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("the data root /srv/pangolin already holds a database");
      expect(result.stderr).toMatch(/missing or empty\n.*: app-key\n/);
      expect(result.stderr).toContain("PANGOLIN_AUTH_SECRET -> /opt/pangolin/secrets/auth-secret");
      expect(result.stderr).toContain("PANGOLIN_APP_KEY     -> /opt/pangolin/secrets/app-key");
      expect(result.stderr).toContain(
        "RESTIC_PASSWORD      -> /opt/pangolin/secrets/restic-password",
      );
      expect(result.stderr).toContain("move everything in /srv/pangolin aside");
      expect(result.stderr).toContain("sudo mkdir -p -m 0700 /opt/pangolin/secrets");
      expect(result.stderr).toContain("sudo tee /opt/pangolin/secrets/auth-secret > /dev/null");
      expect(result.stderr).toContain("new repository path");
      expect(result.stdout).not.toContain("Generated the secret");
      // No secret written (app-key exactly as damaged, no half-written file), the others
      // untouched, no bundle.
      const left = readdirSync(at("opt/pangolin/secrets"));
      expect(left.filter((name) => name.endsWith(".new"))).toEqual([]);
      if (after === null) expect(left).not.toContain("app-key");
      else expect(read("opt/pangolin/secrets/app-key")).toBe(after);
      expect(read("opt/pangolin/secrets/auth-secret")).toBe(before["auth-secret"]);
      expect(read("opt/pangolin/secrets/restic-password")).toBe(before["restic-password"]);
      expect(mode("opt/pangolin/secrets/auth-secret")).toBe(modes["auth-secret"]);
      expect(mode("opt/pangolin/secrets/restic-password")).toBe(modes["restic-password"]);
      expect(bundles()).toEqual([]);

      // Put back from the recovery bundle, a plain re-run (no flag) keeps them all.
      writeFileSync(at("opt/pangolin/secrets/app-key"), before["app-key"]);
      const again = install();
      expect(again.status, again.stderr).toBe(0);
      expect(secrets()).toEqual(before);
      expect(secretModes()).toEqual(modes);
      expect(bundles()).toEqual([]);
    },
  );

  it("names every missing secret, and creates nothing when /opt/pangolin is gone", () => {
    // Only the data root, as on a host the data disk was moved to.
    mkdirSync(at("srv/pangolin"), { recursive: true });
    database();
    const result = install();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(": auth-secret app-key restic-password\n");
    expect(result.stdout).not.toContain("Preparing");
    expect(existsSync(at("opt/pangolin"))).toBe(false);
    expect(existsSync(at("etc/systemd"))).toBe(false);
    expect(bundles()).toEqual([]);
    expect(readdirSync(at("srv/pangolin"))).toEqual(["pangolin.sqlite"]);
  });

  it("refuses before touching an install directory that lost its secrets", () => {
    expect(install().status).toBe(0);
    database();
    rmSync(at("opt/pangolin/secrets"), { recursive: true });
    rmSync(at("opt/pangolin/firewall"), { recursive: true });
    const env = read("opt/pangolin/.env");
    expect(install().status).toBe(1);
    // prepare_dirs never ran: neither directory it creates is back.
    expect(existsSync(at("opt/pangolin/secrets"))).toBe(false);
    expect(existsSync(at("opt/pangolin/firewall"))).toBe(false);
    expect(read("opt/pangolin/.env")).toBe(env);
  });

  it("keeps every secret over an existing database, and writes no bundle", () => {
    expect(install().status).toBe(0);
    database();
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    const before = secrets();
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(secrets()).toEqual(before);
    expect(bundles()).toEqual([]);
  });

  it("reinstalls on the data and secrets uninstall.sh kept, with the same secrets", () => {
    expect(install().status).toBe(0);
    database();
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    const before = secrets();
    const modes = secretModes();
    const removed = run("sh", [UNINSTALL, "--root", root, "--non-interactive"]);
    expect(removed.status, removed.stderr).toBe(0);
    expect(existsSync(at("opt/pangolin/.env"))).toBe(false);

    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(secrets()).toEqual(before);
    expect(secretModes()).toEqual(modes);
    expect(bundles()).toEqual([]);
    expect(read("srv/pangolin/pangolin.sqlite")).toBe("household");
  });

  it("generates the secrets as before when the data root holds no database", () => {
    mkdirSync(at("srv/pangolin/backup"), { recursive: true });
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Generated the secret auth-secret");
    expect(bundles()).toHaveLength(1);
  });
});

describe("install.sh, boot safety", () => {
  it("stages the early firewall unit, enabled, with the saved ruleset it loads", () => {
    expect(install().status).toBe(0);
    const unit = read("etc/systemd/system/pangolin-firewall.service");
    expect(unit).toContain("DefaultDependencies=no");
    expect(unit).toContain("Before=network-pre.target docker.service");
    expect(unit).toContain("ExecStart=/opt/pangolin/firewall/render.sh boot");
    expect(unit).toContain("WantedBy=sysinit.target");
    const wants = "etc/systemd/system/sysinit.target.wants/pangolin-firewall.service";
    expect(readlinkSync(at(wants))).toBe("/etc/systemd/system/pangolin-firewall.service");
    expect(
      readlinkSync(at("etc/systemd/system/timers.target.wants/pangolin-allowlist.timer")),
    ).toBe("/etc/systemd/system/pangolin-allowlist.timer");
    expect(read("opt/pangolin/firewall/pangolin.nft")).toContain("policy drop;");
  });

  it("allowlists the Tang server, and adds it back to an edited allowlist", () => {
    expect(install("--tang-url", "http://tang.lan").status).toBe(0);
    expect(read("opt/pangolin/.env")).toContain("PANGOLIN_TANG_URL=http://tang.lan\n");
    expect(read("opt/pangolin/allowlist.conf")).toMatch(/^tang\.lan:80$/m);
    writeFileSync(at("opt/pangolin/allowlist.conf"), "example.org:443\n");
    const rerun = install();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(read("opt/pangolin/allowlist.conf")).toMatch(/^example\.org:443$/m);
    expect(read("opt/pangolin/allowlist.conf")).toMatch(/^tang\.lan:80$/m);
  });

  it("makes Docker wait for a mounted data root, and warns when it is not a mount point", () => {
    const mounted = run("sh", [INSTALL, "--root", root, ...ANSWERS], {
      PANGOLIN_INSTALL_STUB_MOUNTPOINT: "1",
    });
    expect(mounted.status, mounted.stderr).toBe(0);
    expect(read("etc/systemd/system/docker.service.d/pangolin-data.conf")).toContain(
      "RequiresMountsFor=/srv/pangolin",
    );
    rmSync(at("etc/systemd/system/docker.service.d"), { recursive: true });
    const plain = run("sh", [INSTALL, "--root", root, ...ANSWERS], {
      PANGOLIN_INSTALL_STUB_MOUNTPOINT: "0",
    });
    expect(plain.status).toBe(0);
    expect(existsSync(at("etc/systemd/system/docker.service.d"))).toBe(false);
    expect(plain.stderr).toMatch(/is not a mount point/);
  });

  it("removes the drop-in for a data root that is no longer a mount point", () => {
    const mounted = run("sh", [INSTALL, "--root", root, ...ANSWERS], {
      PANGOLIN_INSTALL_STUB_MOUNTPOINT: "1",
    });
    expect(mounted.status, mounted.stderr).toBe(0);
    const moved = run("sh", [INSTALL, "--root", root, ...ANSWERS, "--data-root", "/srv/other"], {
      PANGOLIN_INSTALL_STUB_MOUNTPOINT: "0",
    });
    expect(moved.status, moved.stderr).toBe(0);
    expect(existsSync(at("etc/systemd/system/docker.service.d"))).toBe(false);
    expect(moved.stdout).toContain("Removed the Docker drop-in");
  });

  it("keeps the drop-in for the same data root while its disk is not mounted", () => {
    expect(
      run("sh", [INSTALL, "--root", root, ...ANSWERS], { PANGOLIN_INSTALL_STUB_MOUNTPOINT: "1" })
        .status,
    ).toBe(0);
    const unmounted = run("sh", [INSTALL, "--root", root, ...ANSWERS], {
      PANGOLIN_INSTALL_STUB_MOUNTPOINT: "0",
    });
    expect(unmounted.status, unmounted.stderr).toBe(0);
    expect(read("etc/systemd/system/docker.service.d/pangolin-data.conf")).toContain(
      "RequiresMountsFor=/srv/pangolin",
    );
    expect(unmounted.stdout).not.toContain("Removed the Docker drop-in");
  });

  it("rewrites the drop-in for a new data root that is a mount point, leaving one", () => {
    const env = { PANGOLIN_INSTALL_STUB_MOUNTPOINT: "1" };
    expect(run("sh", [INSTALL, "--root", root, ...ANSWERS], env).status).toBe(0);
    const moved = run(
      "sh",
      [INSTALL, "--root", root, ...ANSWERS, "--data-root", "/srv/other"],
      env,
    );
    expect(moved.status, moved.stderr).toBe(0);
    expect(readdirSync(at("etc/systemd/system/docker.service.d"))).toEqual(["pangolin-data.conf"]);
    const dropIn = read("etc/systemd/system/docker.service.d/pangolin-data.conf");
    expect(dropIn).toContain("RequiresMountsFor=/srv/other");
    expect(dropIn).not.toContain("/srv/pangolin");
  });
});

describe("install.sh with Docker (a stub docker)", () => {
  it("starts the stack and reports it healthy", () => {
    const result = installWithDocker([]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Healthy after \d+ s/);
    expect(dockerLog()).toMatch(/compose .*up -d/);
    expect(dockerLog()).toContain("pull ghcr.io/sbwilson/pangolin:latest");
  });

  it("never pulls a local image, and stops clearly when it does not exist", () => {
    const missing = installWithDocker(["--image", "pangolin:local"], { STUB_IMAGE_MISSING: "1" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/the local image pangolin:local does not exist here/);
    expect(dockerLog()).not.toContain("pull");
    const present = installWithDocker([]);
    expect(present.status, present.stderr).toBe(0);
    expect(present.stdout).toContain("Using the local image pangolin:local");
    expect(dockerLog()).not.toContain("pull");
  });

  it("stores a --ghcr-token-file token without CR/LF, root's and 0600, and never prints it", () => {
    const token = "github_pat_TESTTOKEN0123456789";
    writeFileSync(at("token.txt"), `${token}\r\n`);
    const result = installWithDocker(["--ghcr-token-file", at("token.txt")]);
    expect(result.status, result.stderr).toBe(0);
    expect(read("opt/pangolin/secrets/ghcr-token")).toBe(token);
    expect(mode("opt/pangolin/secrets/ghcr-token")).toBe(0o600);
    expect(statSync(at("opt/pangolin/secrets/ghcr-token")).uid).toBe(uid);
    expect(dockerLog()).toContain("login ghcr.io --username sbwilson --password-stdin");
    const [bundle] = bundles();
    for (const text of [
      result.stdout,
      result.stderr,
      read("opt/pangolin/.env"),
      read(`root/${bundle}`),
      dockerLog(),
    ]) {
      expect(text).not.toContain(token);
    }
  });

  it("names --build and --ghcr-token-file when a registry refuses the pull, with --non-interactive", () => {
    const result = installWithDocker([], { STUB_PULL_DENIED: "1" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not pull ghcr.io/sbwilson/pangolin:latest");
    expect(result.stderr).toMatch(/re-run with --build .* or with --ghcr-token-file FILE/);
    expect(dockerLog()).not.toMatch(/compose .*up -d/);
  });

  it("builds the repository's default branch unless --ref names one", () => {
    const result = installWithDocker(["--build"]);
    expect(result.status, result.stderr).toBe(0);
    expect(read("git.log")).toMatch(/^clone --quiet --depth 1 https:\S+ \S+\/opt\/pangolin\/src$/m);
    expect(dockerLog()).toContain("build --build-arg PANGOLIN_VERSION=abc1234 -t pangolin:local");
    expect(dockerLog()).not.toContain("pull");
    rmSync(at("opt/pangolin/src"), { recursive: true });
    expect(installWithDocker(["--build", "--ref", "v1.2.0"]).status).toBe(0);
    expect(read("git.log")).toMatch(/^clone --quiet --depth 1 --branch v1\.2\.0 /m);
    expect(dockerLog()).toContain("PANGOLIN_VERSION=v1.2.0");
  });

  const BUILD_HOSTS = [
    "github.com:443",
    "release-assets.githubusercontent.com:443",
    "objects.githubusercontent.com:443",
    "registry.npmjs.org:443",
    "registry-1.docker.io:443",
    "auth.docker.io:443",
    "production.cloudflare.docker.com:443",
    "production.cloudfront.docker.com:443",
  ];

  it("allowlists the build hosts with --build, on a first install and on a re-run", () => {
    expect(installWithDocker(["--build"]).status).toBe(0);
    const entries = () => read("opt/pangolin/allowlist.conf").split("\n");
    for (const host of BUILD_HOSTS)
      expect(entries().filter((line) => line === host)).toHaveLength(1);

    // An allowlist from an install without --build gains them before the build, only once.
    writeFileSync(
      at("opt/pangolin/allowlist.conf"),
      entries()
        .filter((line) => !BUILD_HOSTS.includes(line))
        .join("\n"),
    );
    const rerun = installWithDocker(["--build"]);
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.stdout).toMatch(/Added to allowlist\.conf: github\.com:443/);
    expect(rerun.stdout.indexOf("Added to allowlist.conf: github.com")).toBeLessThan(
      rerun.stdout.indexOf("Building pangolin:local"),
    );
    for (const host of BUILD_HOSTS)
      expect(entries().filter((line) => line === host)).toHaveLength(1);
    expect(installWithDocker(["--build"]).stdout).not.toContain("Added to allowlist.conf");
  });

  it("allowlists the apt mirrors this VM uses, on a first install and on a re-run", () => {
    mkdirSync(at("etc/apt/sources.list.d"), { recursive: true });
    writeFileSync(
      at("etc/apt/sources.list"),
      [
        "deb http://ftp.au.debian.org/debian trixie main",
        "# deb http://commented.example.org/debian trixie main",
        "deb [signed-by=/k.asc] https://deb.debian.org/debian-security trixie-security main",
      ].join("\n"),
    );
    writeFileSync(
      at("etc/apt/sources.list.d/debian.sources"),
      "Types: deb\nURIs: http://mirror.example.net:8080/debian\nSuites: trixie\n",
    );
    expect(install().status).toBe(0);
    const entries = () => read("opt/pangolin/allowlist.conf").split("\n");
    expect(entries()).toContain("ftp.au.debian.org:80");
    expect(entries()).toContain("mirror.example.net:8080");
    expect(entries().filter((line) => line === "deb.debian.org:443")).toHaveLength(1);
    expect(entries()).not.toContain("commented.example.org:80");

    // A mirror added later is allowlisted on the next run, before apt runs.
    writeFileSync(
      at("etc/apt/sources.list.d/extra.list"),
      "deb http://mirror.aarnet.edu.au/debian trixie main\n",
    );
    const rerun = install();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.stdout).toContain("Added to allowlist.conf: mirror.aarnet.edu.au:80");
    expect(entries().filter((line) => line === "ftp.au.debian.org:80")).toHaveLength(1);
  });

  it("leaves the build hosts out without --build", () => {
    expect(installWithDocker([]).status).toBe(0);
    const entries = read("opt/pangolin/allowlist.conf").split("\n");
    // The GitHub hosts gh needs are in the default list; the rest are build-only.
    const GH_HOSTS = [
      "github.com:443",
      "release-assets.githubusercontent.com:443",
      "objects.githubusercontent.com:443",
    ];
    for (const host of BUILD_HOSTS.filter((h) => !GH_HOSTS.includes(h))) {
      expect(entries).not.toContain(host);
    }
    for (const host of ["api.github.com:443", "uploads.github.com:443", ...GH_HOSTS]) {
      expect(entries).toContain(host);
    }
  });

  it("offers to build when the pull is refused, and switches .env to the built image", () => {
    // Proxy mode, Tang server and GHCR token (empty: a public image) are asked first.
    const result = installInteractively("\n\n\nb\n", [], { STUB_PULL_DENIED: "1" });
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("Could not pull ghcr.io/sbwilson/pangolin:latest");
    expect(result.stdout).toContain("Replacing PANGOLIN_IMAGE in .env: pangolin:local");
    expect(read("opt/pangolin/.env")).toMatch(/^PANGOLIN_IMAGE=pangolin:local$/m);
    expect(dockerLog()).toContain("-t pangolin:local");
    expect(result.stdout).toMatch(/Healthy after \d+ s/);
  });

  it("asks again for a refused token, then stores a good one 0600 and pulls with it", () => {
    const result = installInteractively("\n\n\nt\nbad-token\nt\ngood-token\n", [], {
      STUB_PULL_DENIED: "1",
    });
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain("ghcr.io did not accept that token.");
    expect(read("opt/pangolin/secrets/ghcr-token")).toBe("good-token");
    expect(mode("opt/pangolin/secrets/ghcr-token")).toBe(0o600);
    expect(dockerLog().match(/^pull /gm)).toHaveLength(2);
    // The terminal echoes all the typed input before the installer starts; nothing after it.
    const printed = result.stdout.slice(result.stdout.indexOf("Pangolin Money installer"));
    expect(printed).not.toContain("good-token");
    expect(result.stdout).toMatch(/Healthy after \d+ s/);
  });
});

describe("install.sh, failures", () => {
  it("exits 1 when not run as root", () => {
    // A copy anyone can read, run as a normal user (dropping root first when tests run as root).
    const dir = mkdtempSync(join(tmpdir(), "pangolin-install-user-"));
    try {
      chmodSync(dir, 0o755);
      copyFileSync(INSTALL, join(dir, "install.sh"));
      chmodSync(join(dir, "install.sh"), 0o755);
      const script = join(dir, "install.sh");
      const result =
        process.getuid?.() === 0
          ? run("setpriv", ["--reuid=65534", "--regid=65534", "--clear-groups", "sh", script])
          : run("sh", [script]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/run install\.sh as root/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the container's last log lines and exits 1 when /healthz is not ok in time", () => {
    // The stub's container exists but stays unhealthy, and its logs carry a marker.
    const result = installWithDocker([], { STUB_HEALTH: "unhealthy" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not healthy after 1 s \(status: unhealthy\)/);
    expect(result.stderr).toContain("STUB-LOG-MARKER: migration failed");
    expect(result.stderr).toMatch(/did not become healthy/);
  });

  it("rejects a --root that is / or empty, which would install for real", () => {
    for (const args of [["--root", "/"], ["--root=//"], ["--root="]]) {
      const result = run("sh", [INSTALL, ...args, ...ANSWERS]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/--root must be/);
    }
  });

  it("rejects an IPv6 NPM host: the app port is published on IPv4 only", () => {
    const result = install("--npm-host", "2001:db8::10");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/published on IPv4 only/);
  });

  it("exits 1 on an unsupported distribution, naming the supported ones", () => {
    writeFileSync(
      at("etc/os-release"),
      'ID=alpine\nVERSION_ID=3.20.0\nPRETTY_NAME="Alpine Linux v3.20"\n',
    );
    const result = install();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unsupported distribution: Alpine Linux v3\.20/);
    expect(result.stderr).toMatch(/Debian 13.*Ubuntu 24\.04.*Rocky Linux 9/);
    expect(existsSync(at("opt"))).toBe(false);
  });

  it("refuses a Debian release older than 13, the minimum", () => {
    writeFileSync(
      at("etc/os-release"),
      'ID=debian\nVERSION_ID="12"\nPRETTY_NAME="Debian GNU/Linux 12"\n',
    );
    const result = install();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unsupported distribution: Debian GNU\/Linux 12/);
    expect(existsSync(at("opt"))).toBe(false);
  });

  it("treats Debian 13 as the proven path, with no unproven warning", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toMatch(
      /Distribution: Debian GNU\/Linux 13 \(trixie\) \(apt\)/,
    );
    expect(result.stderr).not.toMatch(/not yet proven/);
  });

  it("marks Ubuntu 24.04 and Rocky 9 as unproven, and labels Rocky's mounts for SELinux", () => {
    writeFileSync(
      at("etc/os-release"),
      'ID=rocky\nVERSION_ID="9.4"\nPRETTY_NAME="Rocky Linux 9.4"\n',
    );
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/not yet proven/);
    const env = read("opt/pangolin/.env");
    expect(env).toContain("PANGOLIN_DATA_MOUNT_MODE=rw,Z\n");
    expect(env).toContain("PANGOLIN_SECRETS_MOUNT_MODE=ro,Z\n");
    expect(read("opt/pangolin/allowlist.conf")).toContain("dl.rockylinux.org:443");
  });

  it("stops without changing anything for the proxy modes not yet supported", () => {
    for (const proxy of ["caddy", "tailscale"]) {
      const result = install("--proxy", proxy);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/not yet supported/);
      expect(existsSync(at("opt"))).toBe(false);
    }
  });

  it("exits 1 when a required answer is missing with --non-interactive", () => {
    const result = run("sh", [INSTALL, "--root", root, "--non-interactive", "--no-docker"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--hostname is required/);
    expect(existsSync(at("opt"))).toBe(false);
  });

  it("rejects an IP address as the public host name, and a bad backup URL", () => {
    const ip = run("sh", [
      INSTALL,
      "--root",
      root,
      ...ANSWERS.map((arg) => (arg === "money.example.com" ? "192.168.1.20" : arg)),
    ]);
    expect(ip.status).toBe(1);
    expect(ip.stderr).toMatch(/not a public host name/);
    const backup = install("--backup-server", "ftp://nas.lan/pangolin");
    expect(backup.status).toBe(1);
    expect(backup.stderr).toMatch(/not a restic REST URL/);
  });
});

describe("firewall/render.sh", () => {
  /**
   * Runs render.sh with stubs on PATH that model the firewall. `nft -f FILE` "loads" FILE: it is
   * appended to `nft.log` (every call fails when `STUB_NFT_FAIL=1`,
   * `add` alone when `STUB_NFT_ADD_FAIL=1`; each call is logged to `nft-calls.log`), and clears what `nft add element`
   * added since, which is logged to `nft-add.log` one `SET ADDRESS` per line; `nft list table`
   * succeeds once something is loaded. `getent` answers for `*.good.example` names only, and
   * only when DNS gets through: with nothing loaded it always does; with a ruleset loaded, the
   * resolver this host uses (`STUB_RESOLVER`, else the fixture resolver file's first nameserver,
   * else .env's 192.168.1.1) must be in the last loaded `dns4` set or added since. `id` reports
   * root. The host's resolver files are the fixtures `resolv.conf` and `resolved.conf` (absent
   * unless a test writes them), never this machine's.
   */
  function render(args: readonly string[], env: Record<string, string> = {}): Run {
    const bin = at("render-bin");
    mkdirSync(bin, { recursive: true });
    const nftLog = at("nft.log");
    const addLog = at("nft-add.log");
    stub(bin, "getent", [
      "resolver=$STUB_RESOLVER",
      'if [ -z "$resolver" ]; then',
      "  conf=$PANGOLIN_RESOLV_CONF",
      '  if grep -q \'^nameserver 127.0.0.53\' "$conf" 2>/dev/null && [ -r "$PANGOLIN_RESOLVED_CONF" ]; then',
      "    conf=$PANGOLIN_RESOLVED_CONF",
      "  fi",
      '  resolver=$(awk \'$1 == "nameserver" { print $2; exit }\' "$conf" 2>/dev/null)',
      "fi",
      '[ -n "$resolver" ] || resolver=192.168.1.1',
      `if [ -s "${nftLog}" ]; then`,
      "  allowed=0",
      `  line=$(grep 'set dns4 {' "${nftLog}" | tail -n 1)`,
      '  case "$line" in *" $resolver,"* | *" $resolver }"*) allowed=1 ;; esac',
      `  grep -qxF "dns4 $resolver" "${addLog}" 2>/dev/null && allowed=1`,
      '  [ "$allowed" = 1 ] || exit 2',
      "fi",
      'case "$2" in',
      '  *.good.example) [ "$1" = ahostsv4 ] && echo "203.0.113.5     STREAM $2"; exit 0 ;;',
      "esac",
      "exit 2",
    ]);
    stub(bin, "id", ["echo 0"]);
    stub(bin, "nft", [
      `echo "$*" >> "${at("nft-calls.log")}"`,
      '[ "$STUB_NFT_FAIL" = 1 ] && exit 1',
      'case "$1" in',
      `  -f) cat "$2" >> "${nftLog}"; rm -f "${addLog}" ;;`,
      `  list) [ -s "${nftLog}" ] ;;`,
      "  add)",
      `    [ -s "${nftLog}" ] || exit 1`,
      '    [ "$STUB_NFT_ADD_FAIL" = 1 ] && exit 1',
      "    set=$5",
      `    for address in $(printf '%s\\n' "$6" | tr -d '{},'); do echo "$set $address" >> "${addLog}"; done`,
      "    ;;",
      "  *) exit 1 ;;",
      "esac",
    ]);
    return run("sh", [RENDER, ...args], {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PANGOLIN_RESOLV_CONF: at("resolv.conf"),
      PANGOLIN_RESOLVED_CONF: at("resolved.conf"),
      STUB_NFT_FAIL: "0",
      STUB_NFT_ADD_FAIL: "0",
      STUB_RESOLVER: "",
      ...env,
    });
  }

  /** The last ruleset the stub `nft` loaded. */
  function lastLoaded(): string {
    const log = read("nft.log");
    return log.slice(log.lastIndexOf("#!/usr/sbin/nft -f"));
  }

  function fixture(allowlist: string) {
    writeFileSync(
      at("env"),
      [
        "PANGOLIN_NPM_HOST=192.168.1.10",
        "PANGOLIN_ADMIN_NETWORK=192.168.1.0/24",
        "PANGOLIN_DNS_SERVERS=192.168.1.1,2001:db8::53",
        "PANGOLIN_HTTP_PORT=3000",
        "",
      ].join("\n"),
    );
    writeFileSync(at("allowlist.conf"), allowlist);
    return ["--env", at("env"), "--allowlist", at("allowlist.conf")];
  }

  const ALLOWLIST = [
    "# a comment",
    "10.20.0.0/16",
    "10.1.2.3:8000   # restic",
    "[2001:db8::1]:443",
    "2001:db8:1::/48",
    "192.0.2.7:443",
    "not a host",
    "",
  ].join("\n");

  it("renders the nftables ruleset from the allowlist and .env", () => {
    const result = render([...fixture(ALLOWLIST), "ruleset"]);
    expect(result.status, result.stderr).toBe(0);
    const ruleset = result.stdout;
    expect(ruleset).toContain("delete table inet pangolin");
    expect(ruleset).toMatch(/set dns4 \{[^}]*elements = \{ 192\.168\.1\.1 \}/);
    expect(ruleset).toMatch(/set dns6 \{[^}]*elements = \{ 2001:db8::53 \}/);
    expect(ruleset).toMatch(/set hosts4 \{[^}]*elements = \{ 10\.20\.0\.0\/16 \}/);
    expect(ruleset).toMatch(/set hosts6 \{[^}]*elements = \{ 2001:db8:1::\/48 \}/);
    expect(ruleset).toMatch(/set ports4 \{[^}]*10\.1\.2\.3 \. 8000, 192\.0\.2\.7 \. 443 \}/);
    expect(ruleset).toMatch(/set ports6 \{[^}]*2001:db8::1 \. 443 \}/);
    // Inbound: the app from NPM only, SSH from the admin network only; everything else drops.
    expect(ruleset).toContain("type filter hook input priority filter; policy drop;");
    expect(ruleset).toContain("ip saddr 192.168.1.10 tcp dport 3000 accept");
    expect(ruleset).toContain("ip saddr 192.168.1.0/24 tcp dport 22 accept");
    // Outbound, for the host and the containers: the allowlist only.
    expect(ruleset).toContain("type filter hook output priority filter; policy drop;");
    expect(ruleset).toContain("type filter hook forward priority filter - 10;");
    expect(ruleset).toContain("ct status dnat ip saddr 192.168.1.10 tcp dport 3000 accept");
    expect(ruleset).toContain('iifname "br-*" jump containers');
    expect(ruleset.match(/jump allowed/g)).toHaveLength(2);
    // Ping from the host only: the rule sits in the output chain, not the containers' chain.
    const output = ruleset.slice(ruleset.indexOf("chain output"), ruleset.indexOf("chain forward"));
    expect(output).toContain("icmp type echo-request accept");
    expect(output).toContain("icmpv6 type echo-request accept");
    expect(ruleset.slice(ruleset.indexOf("chain containers"))).not.toContain("echo-request");
    expect(result.stderr).toMatch(/skipped, not a host name or address: not a host/);
  });

  it("renders the Proxmox rules with the same addresses", () => {
    const result = render([...fixture(ALLOWLIST), "proxmox"]);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.split("\n");
    expect(lines).toContain("policy_in: DROP");
    expect(lines).toContain("policy_out: DROP");
    expect(lines).toContain("IN ACCEPT -source 192.168.1.10 -p tcp -dport 3000 # NPM to the app");
    expect(lines).toContain(
      "IN ACCEPT -source 192.168.1.0/24 -p tcp -dport 22 # SSH from the admin network",
    );
    expect(lines).toContain("OUT ACCEPT -dest 192.168.1.1 -p udp -dport 53 # DNS");
    expect(lines).toContain("OUT ACCEPT -dest 10.20.0.0/16 # 10.20.0.0/16");
    expect(lines).toContain("OUT ACCEPT -dest 10.1.2.3 -p tcp -dport 8000 # 10.1.2.3:8000");
    expect(lines).toContain("OUT ACCEPT -dest 2001:db8::1 -p tcp -dport 443 # [2001:db8::1]:443");
    expect(lines).toContain("OUT ACCEPT -p icmp -icmp-type echo-request # ping from the VM");
  });

  it("skips an empty port, an octet over 255 and a malformed IPv6 address, with a warning", () => {
    const bad = [
      "example.org:",
      "10.0.0.1:",
      "[2001:db8::1]:",
      "10.0.0.256",
      "10.0.0.0/33",
      ":",
      "::::",
      "1::2::3",
    ];
    const result = render([...fixture(`${bad.join("\n")}\n10.9.9.9:443\n`), "ruleset"]);
    expect(result.status, result.stderr).toBe(0);
    for (const entry of bad) expect(result.stderr).toContain(`: ${entry}\n`);
    expect(result.stderr.match(/skipped, not a/g)).toHaveLength(bad.length);
    expect(result.stdout).not.toMatch(/set hosts[46] \{[^}]*elements/);
    expect(result.stdout).toMatch(/set ports4 \{[^}]*elements = \{ 10\.9\.9\.9 \. 443 \}/);
    expect(result.stdout).not.toContain("256");
  });

  it("prints a fail-closed fallback ruleset that needs no allowlist", () => {
    const args = fixture("10.9.9.9:443\n");
    rmSync(at("allowlist.conf"));
    const result = render([...args, "fallback"]);
    expect(result.status, result.stderr).toBe(0);
    const ruleset = result.stdout;
    expect(ruleset).toContain("FAIL-CLOSED");
    expect(ruleset).toContain("type filter hook input priority filter; policy drop;");
    expect(ruleset).toContain("type filter hook output priority filter; policy drop;");
    expect(ruleset).toContain("ip saddr 192.168.1.0/24 tcp dport 22 accept");
    expect(ruleset).toContain("ip saddr 192.168.1.10 tcp dport 3000 accept");
    expect(ruleset).toMatch(/set dns4 \{[^}]*elements = \{ 192\.168\.1\.1 \}/);
    // No allowlisted host or port: containers and the host reach only DNS (and the host NTP).
    expect(ruleset).not.toMatch(/set (hosts|ports)[46] \{[^}]*elements/);
    expect(ruleset).not.toContain("10.9.9.9");
  });

  it("lists a host name it could not resolve, and blocks it, when another one resolves", () => {
    const result = render([...fixture("nothing.invalid:443\napi.good.example:443\n"), "ruleset"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("# did not resolve: nothing.invalid:443");
    expect(result.stderr).toMatch(/nothing\.invalid did not resolve; it is blocked until it does/);
    expect(result.stdout).toMatch(/set ports4 \{[^}]*elements = \{ 203\.0\.113\.5 \. 443 \}/);
    expect(result.stdout).not.toContain("nothing.invalid:443 }");
  });

  describe("the host's current resolvers", () => {
    it("allows DNS to them as well as to the resolvers in .env", () => {
      writeFileSync(
        at("resolv.conf"),
        "search lan\nnameserver 10.0.0.9\nnameserver 2001:db8::99\n",
      );
      const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/set dns4 \{[^}]*elements = \{ 10\.0\.0\.9, 192\.168\.1\.1 \}/);
      expect(result.stdout).toMatch(/set dns6 \{[^}]*elements = \{ 2001:db8::53, 2001:db8::99 \}/);
      const proxmox = render([...fixture("10.9.9.9:443\n"), "proxmox"]).stdout.split("\n");
      expect(proxmox).toContain("OUT ACCEPT -dest 10.0.0.9 -p udp -dport 53 # DNS");
      expect(proxmox).toContain("OUT ACCEPT -dest 10.0.0.9 -p tcp -dport 53 # DNS");
      expect(proxmox).toContain("OUT ACCEPT -dest 192.168.1.1 -p udp -dport 53 # DNS");
    });

    it("reads systemd-resolved's upstream file behind the stub, and never adds a local address", () => {
      writeFileSync(at("resolv.conf"), "nameserver 127.0.0.53\noptions edns0\n");
      writeFileSync(
        at("resolved.conf"),
        [
          "nameserver 10.0.0.9",
          "nameserver 127.0.0.1",
          "nameserver ::1",
          "nameserver fe80::1",
          "nameserver FE80::2",
          "nameserver fe90::1",
          "nameserver FEBF::3",
          "nameserver 2001:db8::7%eth0",
          "nameserver 10.0.0.0/8",
          "nameserver not-an-ip",
          "nameserver 0.0.0.0",
          "nameserver ::",
          "nameserver ::ffff:10.0.0.8",
          "nameserver ::FFFF:a00:7",
          "nameserver 2001:DB8::53",
          "",
        ].join("\n"),
      );
      const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/set dns4 \{[^}]*elements = \{ 10\.0\.0\.9, 192\.168\.1\.1 \}/);
      // .env's 2001:db8::53 written in capitals is the same resolver: added once, no warning.
      expect(result.stdout).toMatch(/set dns6 \{[^}]*elements = \{ 2001:db8::53 \}/);
      expect(result.stdout).not.toMatch(
        /127\.0\.0\.|fe80|fe90|febf|10\.0\.0\.0\/8|not-an-ip|0\.0\.0\.0|ffff|10\.0\.0\.8|[{ ]::[,} ]/i,
      );
      expect(result.stderr.match(/DNS also allowed to the host's resolver/g)).toHaveLength(1);
      expect(result.stderr).toMatch(
        /warning: DNS also allowed to the host's resolver 10\.0\.0\.9, which is not in PANGOLIN_DNS_SERVERS/,
      );
      expect(result.stderr).toMatch(/skipped the host resolver 10\.0\.0\.0\/8: not an IP address/);
      expect(result.stderr).toMatch(/skipped the host resolver not-an-ip: not an IP address/);
    });

    it("adds a resolver listed twice, or in two spellings, once", () => {
      writeFileSync(
        at("resolv.conf"),
        "nameserver 10.0.0.9\nnameserver 10.0.0.9\nnameserver 2001:db8::99\nnameserver 2001:DB8::99\n",
      );
      const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/set dns4 \{[^}]*elements = \{ 10\.0\.0\.9, 192\.168\.1\.1 \}/);
      expect(result.stdout).toMatch(/set dns6 \{[^}]*elements = \{ 2001:db8::53, 2001:db8::99 \}/);
      expect(result.stderr.match(/DNS also allowed to the host's resolver/g)).toHaveLength(2);
    });

    it("takes real nameservers listed beside the stub, and the stub's upstream ones", () => {
      writeFileSync(at("resolv.conf"), "nameserver 10.0.0.5\n  nameserver 127.0.0.53\n");
      writeFileSync(at("resolved.conf"), "nameserver 10.0.0.7\n");
      const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(
        /set dns4 \{[^}]*elements = \{ 10\.0\.0\.5, 10\.0\.0\.7, 192\.168\.1\.1 \}/,
      );
      expect(result.stdout).not.toContain("127.0.0.53");
    });

    it("adds nothing, and says DNS follows .env only, behind the stub with no upstream file", () => {
      writeFileSync(at("resolv.conf"), "nameserver 127.0.0.53\n");
      const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/set dns4 \{[^}]*elements = \{ 192\.168\.1\.1 \}/);
      expect(
        result.stderr.match(
          /no host resolver found in .*: DNS is allowed to the resolvers in \.env only/g,
        ),
      ).toHaveLength(1);
    });

    it.skipIf(uid === 0)(
      "adds nothing behind the stub when the upstream file is unreadable",
      () => {
        writeFileSync(at("resolv.conf"), "nameserver 127.0.0.53\n");
        writeFileSync(at("resolved.conf"), "nameserver 10.0.0.7\n");
        chmodSync(at("resolved.conf"), 0o000);
        const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
        chmodSync(at("resolved.conf"), 0o644);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain("10.0.0.7");
        expect(result.stderr).toMatch(/no host resolver found/);
      },
    );

    it("says DNS follows .env only when the host has only loopback resolvers", () => {
      writeFileSync(at("resolv.conf"), "nameserver 127.0.0.1\nnameserver 127.0.0.54\n");
      const result = render([...fixture("10.9.9.9:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/set dns4 \{[^}]*elements = \{ 192\.168\.1\.1 \}/);
      expect(result.stderr).toMatch(/no host resolver found/);
    });

    it("only warns when the live DNS sets cannot be widened, and goes on", () => {
      const args = ["--home", root, ...fixture("api.good.example:443\n")];
      mkdirSync(at("firewall"));
      expect(render([...args, "apply"]).status).toBe(0);
      const result = render([...args, "apply"], { STUB_NFT_ADD_FAIL: "1" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toMatch(/warning: could not add 192\.168\.1\.1 to the live dns4 set/);
      expect(lastLoaded()).toMatch(/set ports4 \{[^}]*elements = \{ 203\.0\.113\.5 \. 443 \}/);
    });

    it("never calls nft for ruleset, proxmox or fallback", () => {
      writeFileSync(at("resolv.conf"), "nameserver 10.0.0.9\n");
      const args = fixture("api.good.example:443\n");
      for (const command of ["ruleset", "proxmox", "fallback"]) {
        expect(render([...args, command]).status).toBe(0);
      }
      expect(existsSync(at("nft-calls.log"))).toBe(false);
    });

    it("leaves the fail-closed fallback to the resolvers in .env", () => {
      writeFileSync(at("resolv.conf"), "nameserver 10.0.0.9\n");
      const result = render([...fixture("10.9.9.9:443\n"), "fallback"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/set dns4 \{[^}]*elements = \{ 192\.168\.1\.1 \}/);
      expect(result.stdout).not.toContain("10.0.0.9");
    });

    it("follows a resolver change on the next apply, with no operator action", () => {
      const args = ["--home", root, ...fixture("api.good.example:443\n")];
      mkdirSync(at("firewall"));
      writeFileSync(at("resolv.conf"), "nameserver 192.168.1.1\n");
      expect(render([...args, "apply"]).status).toBe(0);
      expect(lastLoaded()).toMatch(/set dns4 \{[^}]*elements = \{ 192\.168\.1\.1 \}/);

      // The host's resolver changes; .env does not. The ruleset in force blocks the new one.
      writeFileSync(at("resolv.conf"), "nameserver 10.0.0.9\n");
      const getent = run(join(at("render-bin"), "getent"), ["ahostsv4", "api.good.example"], {
        PANGOLIN_RESOLV_CONF: at("resolv.conf"),
        PANGOLIN_RESOLVED_CONF: at("resolved.conf"),
        STUB_RESOLVER: "",
      });
      expect(getent.status).toBe(2);

      const result = render([...args, "apply"]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toMatch(/DNS also allowed to the host's resolver 10\.0\.0\.9/);
      const loaded = lastLoaded();
      expect(loaded).toMatch(/set dns4 \{[^}]*elements = \{ 10\.0\.0\.9, 192\.168\.1\.1 \}/);
      expect(loaded).toMatch(/set ports4 \{[^}]*elements = \{ 203\.0\.113\.5 \. 443 \}/);
      expect(read("firewall/pangolin.nft")).toBe(loaded);
      expect(read("proxmox-firewall.txt")).toContain(
        "OUT ACCEPT -dest 10.0.0.9 -p udp -dport 53 # DNS",
      );
    });

    it("follows a --dns change in .env the same way", () => {
      const args = ["--home", root, ...fixture("api.good.example:443\n")];
      mkdirSync(at("firewall"));
      expect(render([...args, "apply"]).status).toBe(0);

      // The host now uses a resolver its resolv.conf does not show: stuck until .env names it.
      const moved = { STUB_RESOLVER: "10.0.0.9" };
      const stuck = render([...args, "apply"], moved);
      expect(stuck.status).not.toBe(0);
      expect(stuck.stderr).toMatch(/no allowlist host resolved/);

      // What install.sh --dns 10.0.0.9 writes (its own test checks it does).
      writeFileSync(
        at("env"),
        read("env").replace(/^PANGOLIN_DNS_SERVERS=.*$/m, "PANGOLIN_DNS_SERVERS=10.0.0.9"),
      );
      const result = render([...args, "apply"], moved);
      expect(result.status, result.stderr).toBe(0);
      const loaded = lastLoaded();
      expect(loaded).toMatch(/set dns4 \{[^}]*elements = \{ 10\.0\.0\.9 \}/);
      expect(loaded).toMatch(/set ports4 \{[^}]*elements = \{ 203\.0\.113\.5 \. 443 \}/);
      expect(read("firewall/pangolin.nft")).toBe(loaded);
    });
  });

  describe("an allowlist in which no host name resolved", () => {
    const GUIDANCE =
      "no allowlist host resolved: the DNS resolvers tried, in .env (192.168.1.1,2001:db8::53), may have changed, or upstream DNS may be down; re-run install.sh --dns IP[,IP...]";

    it("refuses to print the ruleset", () => {
      const result = render([...fixture("nothing.invalid:443\n10.9.9.9:443\n"), "ruleset"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(GUIDANCE);
      expect(result.stdout).not.toContain("table inet pangolin");
    });

    it("refuses to load or save it on apply, keeping the last good one", () => {
      const args = ["--home", root, ...fixture("api.good.example:443\n")];
      mkdirSync(at("firewall"));
      expect(render([...args, "apply"]).status).toBe(0);
      const saved = read("firewall/pangolin.nft");
      const proxmox = read("proxmox-firewall.txt");
      const loaded = read("nft.log");

      writeFileSync(at("resolv.conf"), "nameserver 10.0.0.9\n");
      writeFileSync(at("allowlist.conf"), "a.invalid:443\nb.invalid\n10.9.9.9:443\n");
      const result = render([...args, "apply"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "no allowlist host resolved: the DNS resolvers tried, in .env (192.168.1.1,2001:db8::53) and the host's (10.0.0.9), may have changed, or upstream DNS may be down; re-run install.sh --dns IP[,IP...]",
      );
      expect(result.stderr).toMatch(/nothing loaded or saved/);
      expect(read("nft.log")).toBe(loaded);
      expect(read("firewall/pangolin.nft")).toBe(saved);
      expect(read("proxmox-firewall.txt")).toBe(proxmox);
      expect(readdirSync(at("firewall"))).toEqual(["pangolin.nft"]);
      // The DNS widening stays, so the next run can resolve.
      expect(read("nft-add.log").split("\n")).toEqual(
        expect.arrayContaining(["dns4 10.0.0.9", "dns4 192.168.1.1", "dns6 2001:db8::53"]),
      );
    });

    it("refuses to print the Proxmox rules", () => {
      const result = render([...fixture("nothing.invalid:443\n10.9.9.9:443\n"), "proxmox"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(GUIDANCE);
      expect(result.stdout).not.toContain("[RULES]");
    });

    it("refuses on a first apply too, saving nothing", () => {
      const args = ["--home", root, ...fixture("nothing.invalid:443\n")];
      const result = render([...args, "apply"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(GUIDANCE);
      expect(existsSync(at("firewall/pangolin.nft"))).toBe(false);
      expect(existsSync(at("proxmox-firewall.txt"))).toBe(false);
    });

    it("still applies an allowlist with only addresses", () => {
      const args = ["--home", root, ...fixture("10.9.9.9:443\n")];
      const result = render([...args, "apply"]);
      expect(result.status, result.stderr).toBe(0);
      expect(read("firewall/pangolin.nft")).toContain("10.9.9.9 . 443");
    });

    it("does not count names left unresolved on purpose (--no-resolve)", () => {
      const result = render(["--no-resolve", ...fixture("nothing.invalid:443\n"), "ruleset"]);
      expect(result.status, result.stderr).toBe(0);
    });
  });

  it("refuses an .env without the NPM host", () => {
    const args = fixture("10.0.0.1\n");
    writeFileSync(at("env"), "PANGOLIN_ADMIN_NETWORK=192.168.1.0/24\n");
    const result = render([...args, "ruleset"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/PANGOLIN_NPM_HOST is not set/);
  });
});

// Seam S11c (spike "Check the suspected seams"): real but harmless. deploy/compose.yaml set no
// stop_grace_period, so `compose stop` killed the app after Docker's default 10 s, the same 10 s
// the job runner waits for running handlers before the HTTP server and database close. In the
// spike's run a handler that ignored its abort signal got SIGKILL at 10.02 s, before the database
// closed; WAL kept every committed row and integrity_check passed, and the job was left running
// for its lease to expire. Fixed by story 11.10: both set stop_grace_period: 20s, which outlasts
// the runner's stop.
/** A Compose duration (`1m30s`, `20s`, `1.5h`, `500ms`, or a bare number of seconds) in ms. */
function composeDurationMs(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value * 1000;
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const unit: Record<string, number> = {
    h: 3_600_000,
    m: 60_000,
    s: 1000,
    ms: 1,
    us: 1e-3,
    ns: 1e-6,
  };
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(h|ms|m|s|us|ns)/g)];
  if (parts.length === 0 || parts.map((part) => part[0]).join("") !== value) return undefined;
  return parts.reduce((sum, part) => sum + Number(part[1]) * (unit[part[2] ?? ""] ?? 0), 0);
}

describe("compose.yaml stop grace (deploy/ and the repository root)", () => {
  it("parses Compose durations", () => {
    expect(composeDurationMs("1m30s")).toBe(90_000);
    expect(composeDurationMs("20s")).toBe(20_000);
    expect(composeDurationMs("1m")).toBe(60_000);
    expect(composeDurationMs("500ms")).toBe(500);
    expect(composeDurationMs(30)).toBe(30_000);
    expect(composeDurationMs("15")).toBe(15_000);
    expect(composeDurationMs("soon")).toBeUndefined();
  });

  it.each([
    ["deploy/compose.yaml", join(here, "compose.yaml")],
    ["compose.yaml", join(here, "..", "compose.yaml")],
  ])("S11c: %s gives the app longer to stop than the job runner's 10 s wait", (_name, file) => {
    const compose = parse(readFileSync(file, "utf8")) as {
      services: { pangolin: { stop_grace_period?: string | number } };
    };
    // Unset, Docker waits 10 s.
    const grace = composeDurationMs(compose.services.pangolin.stop_grace_period) ?? 10_000;
    expect(grace).toBeGreaterThan(10_000);
  });
});
