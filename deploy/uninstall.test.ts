import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const UNINSTALL = join(here, "uninstall.sh");

let root: string;

// The secrets install.sh writes, with the modes generate_secrets gives them.
const SECRET_MODES = [
  ["auth-secret", 0o600],
  ["app-key", 0o600],
  ["restic-password", 0o400],
] as const;

// What install.sh leaves under --root: the install directory, the command, the units, the data.
function installed(dataRoot = "/srv/pangolin", withSecrets = true): void {
  mkdirSync(join(root, "opt/pangolin"), { recursive: true });
  writeFileSync(join(root, "opt/pangolin/.env"), `PANGOLIN_DATA_ROOT=${dataRoot}\n`);
  writeFileSync(join(root, "opt/pangolin/compose.yaml"), "services: {}\n");
  mkdirSync(join(root, "opt/pangolin/firewall"), { recursive: true });
  writeFileSync(join(root, "opt/pangolin/firewall/ruleset.nft"), "table inet pangolin {}\n");
  if (withSecrets) {
    const secrets = join(root, "opt/pangolin/secrets");
    mkdirSync(secrets, { recursive: true });
    for (const [name, fileMode] of SECRET_MODES) {
      writeFileSync(join(secrets, name), `${name}-value\n`);
      chmodSync(join(secrets, name), fileMode);
    }
    // A --ghcr-token-file token: not needed by the data, so never kept.
    writeFileSync(join(secrets, "ghcr-token"), "token");
    chmodSync(join(secrets, "ghcr-token"), 0o600);
    chmodSync(secrets, 0o700);
  }
  mkdirSync(join(root, "usr/local/bin"), { recursive: true });
  writeFileSync(join(root, "usr/local/bin/pangolin"), "# bin");
  const units = join(root, "etc/systemd/system");
  mkdirSync(join(units, "docker.service.d"), { recursive: true });
  mkdirSync(join(units, "sysinit.target.wants"), { recursive: true });
  for (const unit of [
    "pangolin-firewall.service",
    "pangolin-allowlist.service",
    "pangolin-allowlist.timer",
  ]) {
    writeFileSync(join(units, unit), "[Unit]\n");
  }
  writeFileSync(join(units, "docker.service.d/pangolin-data.conf"), "[Unit]\n");
  writeFileSync(join(units, "docker.service.d/other.conf"), "[Unit]\n");
  mkdirSync(join(root, dataRoot, "backup"), { recursive: true });
  writeFileSync(join(root, dataRoot, "pangolin.sqlite"), "household");
}

function run(args: string[], input = "") {
  const ran = spawnSync("sh", [UNINSTALL, "--root", root, ...args], { input, encoding: "utf8" });
  return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
}

const exists = (p: string) => existsSync(join(root, p));
const mode = (p: string) => statSync(join(root, p)).mode & 0o777;

// The three secrets are still there, with their contents and modes, and nothing else of
// /opt/pangolin is (the fixture has no .bundle-pending mark; a test below keeps one).
function expectOnlySecretsKept(): void {
  expect(readdirSync(join(root, "opt/pangolin"))).toEqual(["secrets"]);
  expect(mode("opt/pangolin/secrets")).toBe(0o700);
  // Only the three the data needs: the GHCR token is gone.
  expect(readdirSync(join(root, "opt/pangolin/secrets")).sort()).toEqual([
    "app-key",
    "auth-secret",
    "restic-password",
  ]);
  for (const [name, fileMode] of SECRET_MODES) {
    const file = `opt/pangolin/secrets/${name}`;
    expect(readFileSync(join(root, file), "utf8")).toBe(`${name}-value\n`);
    expect(mode(file)).toBe(fileMode);
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pangolin-uninstall-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("uninstall.sh", () => {
  it("removes the install directory but its secrets, the command and firewall units, and keeps the data when it cannot ask", () => {
    installed();
    const { status, out } = run(["--non-interactive"]);
    expect(status).toBe(0);
    expectOnlySecretsKept();
    expect(exists("usr/local/bin/pangolin")).toBe(false);
    expect(exists("etc/systemd/system/pangolin-firewall.service")).toBe(false);
    expect(exists("etc/systemd/system/pangolin-allowlist.timer")).toBe(false);
    expect(exists("etc/systemd/system/docker.service.d/pangolin-data.conf")).toBe(false);
    // Another package's drop-in stays.
    expect(exists("etc/systemd/system/docker.service.d/other.conf")).toBe(true);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expect(out).toContain(
      "Kept the data directory /srv/pangolin and the secrets in /opt/pangolin/secrets",
    );
    expect(out).toContain("a reinstall reuses them");
  });

  it("deletes the data directory and the secrets with --delete-data, without asking", () => {
    installed();
    const { status, out } = run(["--yes", "--delete-data"]);
    expect(status).toBe(0);
    expect(exists("srv/pangolin")).toBe(false);
    expect(exists("opt/pangolin")).toBe(false);
    expect(out).not.toContain("Kept the");
  });

  it("keeps the data directory and the secrets with --keep-data, even when asked to confirm", () => {
    installed();
    expect(run(["--yes", "--keep-data"]).status).toBe(0);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expectOnlySecretsKept();
  });

  it("keeps install.sh's pending-bundle mark with the secrets when the data is kept", () => {
    installed();
    const mark = join(root, "opt/pangolin/secrets/.bundle-pending");
    writeFileSync(mark, "");
    chmodSync(mark, 0o600);
    expect(run(["--yes", "--keep-data"]).status).toBe(0);
    expect(readdirSync(join(root, "opt/pangolin/secrets")).sort()).toEqual([
      ".bundle-pending",
      "app-key",
      "auth-secret",
      "restic-password",
    ]);
    expect(mode("opt/pangolin/secrets/.bundle-pending")).toBe(0o600);
  });

  it("removes the whole install directory when the data is kept but there are no secrets", () => {
    installed("/srv/pangolin", false);
    const { status, out } = run(["--yes", "--keep-data"]);
    expect(status).toBe(0);
    expect(exists("opt/pangolin")).toBe(false);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expect(out).toContain("Kept the data directory /srv/pangolin.");
    expect(out).not.toContain("/opt/pangolin/secrets");
  });

  it("deletes the data directory only after 'y' and the directory typed back", () => {
    installed();
    const { status, out } = run([], "y\ny\n/srv/pangolin\n");
    expect(status).toBe(0);
    expect(out).toContain("Delete /srv/pangolin? [y/N]");
    expect(exists("srv/pangolin")).toBe(false);
    expect(exists("opt/pangolin")).toBe(false);
  });

  it("keeps the data when the answer is no", () => {
    installed();
    const { status, out } = run([], "y\nn\n");
    expect(status).toBe(0);
    expect(out).toContain("Keeping /srv/pangolin.");
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expectOnlySecretsKept();
  });

  it("keeps the data when the typed directory does not match", () => {
    installed();
    const { out } = run([], "y\ny\n/srv\n");
    expect(out).toContain("That does not match");
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expectOnlySecretsKept();
  });

  it("keeps the data when there is no answer at all", () => {
    installed();
    expect(run([], "y\n").status).toBe(0);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expectOnlySecretsKept();
  });

  it("says the delete prompt also deletes the secrets", () => {
    installed();
    const { out } = run([], "y\nn\n");
    expect(out).toContain("Deleting it also deletes the secrets in /opt/pangolin/secrets");
  });

  it("removes the whole install directory, secrets included, when there is no data directory", () => {
    installed();
    rmSync(join(root, "srv/pangolin"), { recursive: true });
    const { status, out } = run(["--yes", "--keep-data"]);
    expect(status).toBe(0);
    expect(out).toContain("There is no data directory at /srv/pangolin");
    expect(exists("opt/pangolin")).toBe(false);
    expect(out).not.toContain("Kept the");
  });

  it("names a kept custom data directory for the reinstall's --data-root", () => {
    installed("/mnt/data/pangolin");
    const { status, out } = run(["--yes", "--keep-data"]);
    expect(status).toBe(0);
    expect(exists("mnt/data/pangolin/pangolin.sqlite")).toBe(true);
    expectOnlySecretsKept();
    expect(out).toContain("Reinstall with --data-root /mnt/data/pangolin");
  });

  it("does not mention --data-root for the default data directory", () => {
    installed();
    expect(run(["--yes", "--keep-data"]).out).not.toContain("--data-root");
  });

  it("asks before removing anything, and changes nothing when the answer is no", () => {
    installed();
    const { status, out } = run(["--keep-data"], "n\n");
    expect(status).toBe(1);
    expect(out).toContain("cancelled: nothing was changed");
    expect(exists("opt/pangolin/.env")).toBe(true);
    expect(exists("usr/local/bin/pangolin")).toBe(true);
  });

  it("reads a custom data directory from .env", () => {
    installed("/mnt/data/pangolin");
    expect(run(["--yes", "--delete-data"]).status).toBe(0);
    expect(exists("mnt/data/pangolin")).toBe(false);
  });

  it.each(["/", "/srv", "/srv/", "/srv/../etc", "relative/dir", "/srv//pangolin"])(
    "never deletes an unsafe data directory (%s)",
    (dataRoot) => {
      installed();
      writeFileSync(join(root, "opt/pangolin/.env"), `PANGOLIN_DATA_ROOT=${dataRoot}\n`);
      const { status, out } = run(["--yes", "--delete-data"]);
      expect(status).toBe(0);
      expect(out).toContain("is not a path this script will delete");
      expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
      expectOnlySecretsKept();
    },
  );

  it("refuses when Pangolin is not installed", () => {
    const { status, out } = run(["--yes"]);
    expect(status).toBe(1);
    expect(out).toContain("does not look installed");
  });

  it("refuses an unknown option", () => {
    const { status, out } = run(["--nope"]);
    expect(status).toBe(1);
    expect(out).toContain("unknown option: --nope");
  });
});
