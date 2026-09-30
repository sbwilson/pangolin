import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const here = dirname(fileURLToPath(import.meta.url));
const PANGOLIN = join(here, "pangolin");

const STUB_VOL = "pangolin_data_stub";
const ORIGINAL_IMAGE = "ghcr.io/sbwilson/pangolin:latest";
const STUB_DIGEST = "sha256:1234567890123456789012345678901234567890123456789012345678901234";
const ORIGINAL_ENV = `PANGOLIN_IMAGE=${ORIGINAL_IMAGE}\nPANGOLIN_DATA_DIR=/data\n`;
const ORIGINAL_COMPOSE = `services:\n  pangolin:\n    image: ${ORIGINAL_IMAGE}\n`;

let root: string;
let homeDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pangolin-test-"));
  homeDir = join(root, "opt", "pangolin");
  mkdirSync(homeDir, { recursive: true });
  writeFileSync(join(homeDir, "compose.yaml"), ORIGINAL_COMPOSE);
  writeFileSync(join(homeDir, ".env"), ORIGINAL_ENV);
  writeFileSync(join(homeDir, "cosign.pub"), "public key");
  // ensure /usr/local/bin exists for backup
  mkdirSync(join(root, "usr", "local", "bin"), { recursive: true });
  writeFileSync(join(root, "usr", "local", "bin", "pangolin"), "# bin");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function at(path: string): string {
  return join(root, path);
}

function buildDockerStub(extraCases: string[] = []): string {
  return [
    "#!/bin/sh",
    `echo "docker $*" >> "${at("cmd.log")}"`,
    'case "$*" in',
    '  "compose "*ps*pangolin*)',
    '    [ "$STUB_RUNNING" = 1 ] && echo "container-id" || exit 0',
    "    ;;",
    // Health status — pre-upgrade uses STUB_HEALTH; post-upgrade (after .env.bak exists) uses STUB_HEALTH_AFTER
    '  "inspect --format {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} container-id")',
    '    if [ -f "${HOME_DIR}/.env.bak" ]; then',
    '      echo "${STUB_HEALTH_AFTER:-healthy}"',
    "    else",
    '      echo "${STUB_HEALTH:-healthy}"',
    "    fi",
    "    ;;",
    // New-container health check (after up -d)
    '  "inspect --format {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} "*)',
    '    echo "${STUB_HEALTH_AFTER:-healthy}"',
    "    ;;",
    // Current image from running container
    '  "inspect --format {{.Config.Image}} container-id")',
    `    echo "\${STUB_IMAGE:-${ORIGINAL_IMAGE}}"`,
    "    ;;",
    // Volume name from Mounts (capture DATA_VOL)
    '  "inspect --format"*"Mounts"*)',
    `    echo "${STUB_VOL}"`,
    "    ;;",
    // cosign verify — output JSON with docker-manifest-digest
    "  *cosign*verify*)",
    `    [ "$STUB_BAD_SIG" = 1 ] && { echo "bad signature" >&2; exit 1; }`,
    `    printf '[{"critical":{"image":{"docker-manifest-digest":"${STUB_DIGEST}"}}}]\\n'`,
    "    ;;",
    // compose stop
    '  "compose "*stop*pangolin*)',
    '    [ -f "${HOME_DIR}/.env.bak" ] && [ "$STUB_ROLLBACK_FAIL" = 1 ] && { echo "stop failed" >&2; exit 1; }',
    "    ;;",
    // compose up
    '  "compose "*up*pangolin*)',
    "    ;;",
    // DB backup/restore (alpine sh -c with sqlite glob)
    "  *alpine*sh*-c*sqlite*|*alpine*sh*-c*cp*backup*|*alpine*sh*-c*rm*sqlite*|*alpine*sh*-c*upgrade-failed*)",
    "    ;;",
    // Extract files from new image into staging
    `  *"${ORIGINAL_IMAGE.replace(/\//g, "\\/")}*sh*-c*cp*/app/deploy"*|*"ghcr.io"*"sh -c 'cp /app/deploy"*)`,
    `    mkdir -p "\${HOME_DIR}/staging"`,
    `    printf '%s' "${ORIGINAL_COMPOSE}" > "\${HOME_DIR}/staging/compose.yaml"`,
    `    echo "# bin" > "\${HOME_DIR}/staging/pangolin"`,
    "    ;;",
    // staging for any target image
    "  *sh*-c*cp*/app/deploy*)",
    `    mkdir -p "\${HOME_DIR}/staging"`,
    `    printf '%s' "${ORIGINAL_COMPOSE}" > "\${HOME_DIR}/staging/compose.yaml"`,
    `    echo "# bin" > "\${HOME_DIR}/staging/pangolin"`,
    "    ;;",
    // pull
    "  *pull*)",
    "    ;;",
    "  *)",
    "    ;;",
    "esac",
    "exit 0",
    "",
    ...extraCases,
  ].join("\n");
}

function stubEnv(
  env: Record<string, string> = {},
  extraCases: string[] = [],
): Record<string, string> {
  const bin = at("bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "docker"), buildDockerStub(extraCases));
  chmodSync(join(bin, "docker"), 0o755);

  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PANGOLIN_HOME: homeDir,
    HOME_DIR: homeDir,
    ...env,
  };
}

function runUpgrade(tag: string, env: Record<string, string> = {}) {
  // Redirect /usr/local/bin references to the test root so backup/restore work
  const scriptContent = readFileSync(PANGOLIN, "utf8");
  const tmpScript = at("pangolin.sh");
  writeFileSync(
    tmpScript,
    scriptContent.replace(/\/usr\/local\/bin/g, join(root, "usr", "local", "bin")),
  );
  chmodSync(tmpScript, 0o755);

  const result = spawnSync(tmpScript, ["upgrade", tag], {
    encoding: "utf8",
    env: stubEnv(env),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    logs: existsSync(at("cmd.log")) ? readFileSync(at("cmd.log"), "utf8") : "",
  };
}

describe("pangolin upgrade", () => {
  it("succeeds when healthy and signature is valid", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Upgrade to v2.0 successful");

    const envContent = readFileSync(join(homeDir, ".env"), "utf8");
    expect(envContent).toContain(`PANGOLIN_IMAGE=ghcr.io/sbwilson/pangolin@${STUB_DIGEST}`);
  });

  it("refuses if bad signature", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_BAD_SIG: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("bad signature");
    // Nothing should have changed
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
  });

  it("refuses if stack is unhealthy before upgrade", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_HEALTH: "starting" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("refusing to upgrade");
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
  });

  it("rolls back if new image is unhealthy after upgrade", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_HEALTH_AFTER: "unhealthy" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("upgrade failed during health check. rolled back");
    // .env and compose.yaml must be restored to their original content
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
    expect(readFileSync(join(homeDir, "compose.yaml"), "utf8")).toBe(ORIGINAL_COMPOSE);
  });

  it("exits 1 and reports location when rollback compose stop fails", () => {
    // STUB_ROLLBACK_FAIL makes compose stop fail during rollback;
    // the script should warn but still restore files and proceed.
    const res = runUpgrade("v2.0", {
      STUB_RUNNING: "1",
      STUB_HEALTH_AFTER: "unhealthy",
      STUB_ROLLBACK_FAIL: "1",
    });
    expect(res.status).toBe(1);
    // Script warns about stop failure but still rolled back
    expect(res.stderr).toContain("warning: stop failed during rollback");
    expect(res.stderr).toContain("upgrade failed during health check. rolled back");
  });

  it("prints already on this version if same digest", () => {
    const res = runUpgrade("v2.0", {
      STUB_RUNNING: "1",
      STUB_IMAGE: `ghcr.io/sbwilson/pangolin@${STUB_DIGEST}`,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("already on v2.0");
    // .env must be untouched
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
  });

  it("refuses if stack is not running", () => {
    // STUB_RUNNING not set → compose ps returns empty → not running
    const res = runUpgrade("v2.0", {});
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("refusing to upgrade: stack is not running");
  });
});
