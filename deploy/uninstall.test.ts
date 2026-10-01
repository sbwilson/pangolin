import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const UNINSTALL = join(here, "uninstall.sh");

let root: string;

// What install.sh leaves under --root: the install directory, the command, the units, the data.
function installed(dataRoot = "/srv/pangolin"): void {
  mkdirSync(join(root, "opt/pangolin"), { recursive: true });
  writeFileSync(join(root, "opt/pangolin/.env"), `PANGOLIN_DATA_ROOT=${dataRoot}\n`);
  writeFileSync(join(root, "opt/pangolin/compose.yaml"), "services: {}\n");
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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pangolin-uninstall-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("uninstall.sh", () => {
  it("removes the install directory, command and firewall units, and keeps the data when it cannot ask", () => {
    installed();
    const { status, out } = run(["--non-interactive"]);
    expect(status).toBe(0);
    expect(exists("opt/pangolin")).toBe(false);
    expect(exists("usr/local/bin/pangolin")).toBe(false);
    expect(exists("etc/systemd/system/pangolin-firewall.service")).toBe(false);
    expect(exists("etc/systemd/system/pangolin-allowlist.timer")).toBe(false);
    expect(exists("etc/systemd/system/docker.service.d/pangolin-data.conf")).toBe(false);
    // Another package's drop-in stays.
    expect(exists("etc/systemd/system/docker.service.d/other.conf")).toBe(true);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expect(out).toContain("Kept the data directory /srv/pangolin");
  });

  it("deletes the data directory with --delete-data, without asking", () => {
    installed();
    expect(run(["--yes", "--delete-data"]).status).toBe(0);
    expect(exists("srv/pangolin")).toBe(false);
  });

  it("keeps the data directory with --keep-data, even when asked to confirm", () => {
    installed();
    expect(run(["--yes", "--keep-data"]).status).toBe(0);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
  });

  it("deletes the data directory only after 'y' and the directory typed back", () => {
    installed();
    const { status, out } = run([], "y\ny\n/srv/pangolin\n");
    expect(status).toBe(0);
    expect(out).toContain("Delete /srv/pangolin? [y/N]");
    expect(exists("srv/pangolin")).toBe(false);
  });

  it("keeps the data when the answer is no", () => {
    installed();
    const { status, out } = run([], "y\nn\n");
    expect(status).toBe(0);
    expect(out).toContain("Keeping /srv/pangolin.");
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
    expect(exists("opt/pangolin")).toBe(false);
  });

  it("keeps the data when the typed directory does not match", () => {
    installed();
    const { out } = run([], "y\ny\n/srv\n");
    expect(out).toContain("That does not match");
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
  });

  it("keeps the data when there is no answer at all", () => {
    installed();
    expect(run([], "y\n").status).toBe(0);
    expect(exists("srv/pangolin/pangolin.sqlite")).toBe(true);
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
