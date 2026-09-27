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
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/sh",
      `echo "$*" >> "${at("git.log")}"`,
      'case "$*" in',
      '  clone*) for last; do :; done; mkdir -p "$last/.git" ;;',
      "  *rev-parse*) echo abc1234 ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "git"), 0o755);
  writeFileSync(
    join(bin, "docker"),
    [
      "#!/bin/sh",
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
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "docker"), 0o755);
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
    for (const name of SECRET_NAMES) {
      expect(mode(`opt/pangolin/secrets/${name}`)).toBe(0o600);
    }
    // Only the auth secret (the one file the container mounts) is the container user's.
    expect(statSync(at("opt/pangolin/secrets")).uid).toBe(uid);
    expect(statSync(at("opt/pangolin/secrets/app-key")).uid).toBe(uid);
    expect(statSync(at("opt/pangolin/secrets/restic-password")).uid).toBe(uid);
    if (uid === 0) expect(statSync(at("opt/pangolin/secrets/auth-secret")).uid).toBe(1000);
    const compose = read("opt/pangolin/compose.yaml");
    expect(compose).toContain("./secrets/auth-secret:/secrets/auth-secret:");
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
    mkdirSync(at("srv/pangolin"), { recursive: true });
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

  /** Runs the wrapper against a stub `docker` that logs its arguments; `running` sets `ps`. */
  function wrapper(args: readonly string[], running: boolean): Run {
    const home = at("opt/pangolin");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "compose.yaml"), "services: {}\n");
    writeFileSync(join(home, ".env"), "", { mode: 0o600 });
    const bin = at("bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "docker"),
      [
        "#!/bin/sh",
        `echo "$*" >> "${at("docker.log")}"`,
        'case "$*" in',
        `  *" ps "*) [ "${running ? 1 : 0}" = 1 ] && echo stub-container-id ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "docker"), 0o755);
    return run("sh", [WRAPPER, ...args], {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PANGOLIN_HOME: home,
    });
  }

  it("runs the CLI in the running container over the admin socket", () => {
    const result = wrapper(["status"], true);
    expect(result.status, result.stderr).toBe(0);
    const home = at("opt/pangolin");
    expect(dockerLog().trim().split("\n")).toEqual([
      `compose --project-directory ${home} -f ${home}/compose.yaml ps -q --status running pangolin`,
      `compose --project-directory ${home} -f ${home}/compose.yaml exec -T pangolin node dist/cli.js status`,
    ]);
  });

  it("runs the CLI in a one-off container when the stack is stopped", () => {
    const result = wrapper(["reset-user", "alex@example.com"], false);
    expect(result.status, result.stderr).toBe(0);
    expect(dockerLog()).toContain(
      "run --rm --no-deps -T pangolin node dist/cli.js reset-user alex@example.com",
    );
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

  it("keeps an edited allowlist", () => {
    expect(install().status).toBe(0);
    writeFileSync(at("opt/pangolin/allowlist.conf"), "example.org:443\n");
    expect(install().status).toBe(0);
    expect(read("opt/pangolin/allowlist.conf")).toBe("example.org:443\n");
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
  });

  it("writes the bundle again with --bundle", () => {
    expect(install().status).toBe(0);
    for (const bundle of bundles()) rmSync(at(`root/${bundle}`));
    expect(install("--bundle").status).toBe(0);
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
    expect(result.stderr).toMatch(/Debian 12 and 13.*Ubuntu 24\.04.*Rocky Linux 9/);
    expect(existsSync(at("opt"))).toBe(false);
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
    const result = run("sh", [RENDER, ...fixture(ALLOWLIST), "ruleset"]);
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
    expect(result.stderr).toMatch(/skipped, not a host name or address: not a host/);
  });

  it("renders the Proxmox rules with the same addresses", () => {
    const result = run("sh", [RENDER, ...fixture(ALLOWLIST), "proxmox"]);
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
    const result = run("sh", [RENDER, ...fixture(`${bad.join("\n")}\n10.9.9.9:443\n`), "ruleset"]);
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
    const result = run("sh", [RENDER, ...args, "fallback"]);
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

  it("lists a host name it could not resolve, and blocks it", () => {
    const result = run("sh", [RENDER, ...fixture("nothing.invalid:443\n"), "ruleset"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# did not resolve: nothing.invalid:443");
    expect(result.stdout).not.toMatch(/set ports4 \{[^}]*elements/);
  });

  it("refuses an .env without the NPM host", () => {
    const args = fixture("10.0.0.1\n");
    writeFileSync(at("env"), "PANGOLIN_ADMIN_NETWORK=192.168.1.0/24\n");
    const result = run("sh", [RENDER, ...args, "ruleset"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/PANGOLIN_NPM_HOST is not set/);
  });
});
