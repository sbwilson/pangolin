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
  utimesSync,
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
    // The digest the pulled tag resolves to
    '  "inspect --format"*RepoDigests*)',
    `    echo "ghcr.io/sbwilson/pangolin@${STUB_DIGEST}"`,
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
    // DB backup/restore (one-off sh -c in the running image)
    "  *entrypoint*sh*-c*sqlite*|*entrypoint*sh*-c*cp*backup*|*entrypoint*sh*-c*rm*sqlite*|*entrypoint*sh*-c*upgrade-failed*)",
    '    [ "$STUB_BACKUP_FAIL" = 1 ] && [ ! -f "${HOME_DIR}/.env.bak" ] && exit 1',
    '    [ "$STUB_BACKUP_FAIL" = 1 ] && case "$*" in *"cp -a /data"*) exit 1 ;; esac',
    '    case "$*" in *sha256sum*) [ "$STUB_COPY_MISMATCH" = 1 ] && exit 1 ;; esac',
    // The rollback restore: the guard may be made to fail; otherwise it records that it ran.
    '    case "$*" in *"[ -s /backup"*)',
    '      [ "$STUB_RESTORE_GUARD_FAIL" = 1 ] && exit 1',
    `      echo restore-ran >> "${at("cmd.log")}" ;; esac`,
    // A real copy lands in the host directory mounted at /backup (empty when STUB_BACKUP_EMPTY=1).
    '    case "$*" in *"cp -a /data"*)',
    '      a="$*"; d=${a#*-v }; d=${d#*-v }; d=${d%%:/backup*}',
    '      if [ "$STUB_BACKUP_EMPTY" = 1 ]; then : > "$d/pangolin.sqlite"; else echo db > "$d/pangolin.sqlite"; fi ;; esac',
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

  it("upgrades a locally built image (pangolin:local) from the release repository", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_IMAGE: "pangolin:local" });
    expect(res.status, res.stderr).toBe(0);
    expect(res.logs).toContain("pull -q ghcr.io/sbwilson/pangolin:v2.0");
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toContain(
      `PANGOLIN_IMAGE=ghcr.io/sbwilson/pangolin@${STUB_DIGEST}`,
    );
  });

  it("restarts the previous stack when the upgrade dies after stopping it", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_BACKUP_FAIL: "1" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("restarting the previous stack");
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
    // stop, then up again
    expect(res.logs.lastIndexOf("compose")).toBeGreaterThan(res.logs.indexOf("stop"));
    expect(res.logs).toMatch(/stop[\s\S]*up -d/);
  });

  it.each([
    ["fails", { STUB_BACKUP_FAIL: "1" }],
    ["is empty", { STUB_BACKUP_EMPTY: "1" }],
  ])("aborts before replacing anything when the database copy %s", (_name, extra) => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", ...extra });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("upgrade aborted, nothing was changed");
    expect(res.logs).not.toContain("rm -f /data");
    expect(res.logs).toMatch(/stop[\s\S]*up -d/);
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
    expect(existsSync(join(homeDir, ".env.bak"))).toBe(false);
    expect(readdirSync(homeDir).filter((f) => f.startsWith("pre-upgrade-"))).toEqual([]);
  });

  it("creates the pre-upgrade copy 0700", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1" });
    expect(res.status, res.stderr).toBe(0);
    const dirs = readdirSync(homeDir).filter((f) => f.startsWith("pre-upgrade-"));
    expect(dirs).toHaveLength(1);
    expect(statSync(join(homeDir, dirs[0] ?? "")).mode & 0o777).toBe(0o700);
  });

  it("keeps .env.bak private while the upgrade runs", () => {
    chmodSync(join(homeDir, ".env"), 0o644);
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_HEALTH_AFTER: "unhealthy" });
    expect(res.status).toBe(1);
    // rolled back: the restored .env came from the private .env.bak
    expect(statSync(join(homeDir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("restores the database in a rollback when the copy is good", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_HEALTH_AFTER: "unhealthy" });
    expect(res.status).toBe(1);
    expect(res.logs).toContain("restore-ran");
  });

  it("restarts the previous stack, and leaves the live database alone, when the rollback restore is refused", () => {
    const res = runUpgrade("v2.0", {
      STUB_RUNNING: "1",
      STUB_HEALTH_AFTER: "unhealthy",
      STUB_RESTORE_GUARD_FAIL: "1",
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("could not restore the DB copy");
    expect(res.stderr).toContain("pre-upgrade-");
    expect(res.logs).not.toContain("restore-ran");
    expect(res.logs).toMatch(/up -d[\s\S]*up -d/);
    expect(res.logs.trimEnd().split("\n").pop()).toMatch(/up -d/);
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
    expect(readFileSync(join(homeDir, "compose.yaml"), "utf8")).toBe(ORIGINAL_COMPOSE);
    for (const f of [".env.bak", "compose.yaml.bak", "pangolin.bak"]) {
      expect(existsSync(join(homeDir, f))).toBe(false);
    }
  });

  it("removes the .bak files after a successful upgrade", () => {
    const ok = runUpgrade("v2.0", { STUB_RUNNING: "1" });
    expect(ok.status, ok.stderr).toBe(0);
    for (const f of [".env.bak", "compose.yaml.bak", "pangolin.bak"]) {
      expect(existsSync(join(homeDir, f))).toBe(false);
    }
  });

  it("aborts when the copy does not hash the same as the original", () => {
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_COPY_MISMATCH: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("does not match the original");
    expect(readdirSync(homeDir).filter((f) => f.startsWith("pre-upgrade-"))).toEqual([]);
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
  });

  it("never reuses or removes an existing backup directory", () => {
    const clock = "#!/bin/sh\necho 20260101000000\n";
    mkdirSync(join(homeDir, "pre-upgrade-20260101000000"));
    writeFileSync(join(homeDir, "pre-upgrade-20260101000000", "pangolin.sqlite"), "precious");
    mkdirSync(at("bin"), { recursive: true });
    writeFileSync(at("bin/date"), clock);
    chmodSync(at("bin/date"), 0o755);
    const res = runUpgrade("v2.0", { STUB_RUNNING: "1" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("could not create");
    expect(
      readFileSync(join(homeDir, "pre-upgrade-20260101000000", "pangolin.sqlite"), "utf8"),
    ).toBe("precious");
  });

  it("sets a leftover .bak aside as .bak.stale instead of deleting it, and drops it after a good upgrade", () => {
    writeFileSync(join(homeDir, ".env.bak"), "stale");
    const bad = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_BACKUP_FAIL: "1" });
    expect(bad.status).not.toBe(0);
    expect(readFileSync(join(homeDir, ".env.bak.stale"), "utf8")).toBe("stale");
    const ok = runUpgrade("v2.0", { STUB_RUNNING: "1" });
    expect(ok.status, ok.stderr).toBe(0);
    expect(existsSync(join(homeDir, ".env.bak.stale"))).toBe(false);
  });

  it("never restores a .bak left by an earlier upgrade when this one is interrupted", () => {
    for (const f of [".env.bak", "compose.yaml.bak", "pangolin.bak"]) {
      writeFileSync(join(homeDir, f), "stale");
    }
    const bad = runUpgrade("v2.0", { STUB_RUNNING: "1", STUB_BACKUP_FAIL: "1" });
    expect(bad.status).not.toBe(0);
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
    expect(readFileSync(join(homeDir, "compose.yaml"), "utf8")).toBe(ORIGINAL_COMPOSE);
    expect(readFileSync(join(root, "usr", "local", "bin", "pangolin"), "utf8")).toBe("# bin");
  });

  it("waits 60 seconds for health by default, and PANGOLIN_UPGRADE_TIMEOUT changes that", () => {
    const script = readFileSync(PANGOLIN, "utf8");
    // The wait loop reads the setting; nothing else hardcodes the 60.
    expect(script).toContain('while [ $WAITED -lt "$UPGRADE_TIMEOUT" ]');
    expect(script).toMatch(/\$\{PANGOLIN_UPGRADE_TIMEOUT:-60\}/);
    // A stack that never reports healthy: rolls back after the configured wait (3s steps).
    const slow = runUpgrade("v2.0", {
      STUB_RUNNING: "1",
      STUB_HEALTH_AFTER: "starting",
      PANGOLIN_UPGRADE_TIMEOUT: "3",
    });
    expect(slow.status).toBe(1);
    expect(slow.stderr).toContain("rolled back");
    expect(slow.logs.match(/^.*inspect.*$/gm)?.length).toBeGreaterThan(0);
  });

  it.each(["abc", "0", "-5", "1.5", "", "010", "5s"])(
    "refuses PANGOLIN_UPGRADE_TIMEOUT=%j before stopping anything",
    (value) => {
      const res = runUpgrade("v2.0", { STUB_RUNNING: "1", PANGOLIN_UPGRADE_TIMEOUT: value });
      // An empty value falls back to the default: it is not an error.
      if (value === "") {
        expect(res.status).toBe(0);
        return;
      }
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("PANGOLIN_UPGRADE_TIMEOUT must be a positive whole number");
      expect(res.logs).not.toMatch(/stop/);
      expect(readFileSync(join(homeDir, ".env"), "utf8")).toBe(ORIGINAL_ENV);
    },
  );

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

// Seam S11d (spike "Check the suspected seams"), fixed by story 11.8. The rollback used to replace
// the live database with the pre-upgrade copy (`rm -f /data/pangolin.sqlite*`, then the copy), so
// anything the new server wrote while the upgrade waited for it to turn healthy was lost. It now
// keeps that database in a 0700 rolled-back-<stamp>/ first. This stub runs the script's own
// `sh -c` steps against real directories (/data and /backup mapped to host paths), and the new
// server "writes" when it starts.
describe("pangolin upgrade rollback and the new server's writes (seam S11d)", () => {
  function realStub(dataDir: string): Record<string, string> {
    const bin = at("bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "docker"),
      [
        "#!/bin/sh",
        `echo "docker $*" >> "${at("cmd.log")}"`,
        // `compose --project-directory DIR -f FILE <subcommand> ...`: match the subcommand by
        // its position, never by a substring a temporary path could contain.
        'if [ "$1" = compose ]; then',
        '  case "$6" in',
        "    ps) echo container-id ;;",
        // The new server starts and writes before its health check fails.
        "    up)",
        `      [ -f "${homeDir}/.env.bak" ] && echo "written by the new server" >> "${dataDir}/pangolin.sqlite" && echo new-server-wrote >> "${at("cmd.log")}" ;;`,
        "  esac",
        "  exit 0",
        "fi",
        'case "$*" in',
        '  "inspect --format {{if .State.Health}}"*)',
        `    if [ -f "${homeDir}/.env.bak" ]; then echo unhealthy; else echo healthy; fi ;;`,
        `  "inspect --format {{.Config.Image}} container-id") echo "${ORIGINAL_IMAGE}" ;;`,
        `  "inspect --format"*RepoDigests*) echo "ghcr.io/sbwilson/pangolin@${STUB_DIGEST}" ;;`,
        `  "inspect --format"*Mounts*) echo "${dataDir}" ;;`,
        "  *cosign*verify*) ;;",
        '  *"cp /app/deploy"*)',
        `    printf '%s' "${ORIGINAL_COMPOSE}" > "${homeDir}/staging/compose.yaml"`,
        `    echo "# bin" > "${homeDir}/staging/pangolin" ;;`,
        // A one-off `run ... -v X:/data -v Y:/backup ... -c CMD`: run CMD here, on X and Y.
        "  run*)",
        "    data=; backup=; cmd=; prev=",
        '    for a in "$@"; do',
        '      if [ "$prev" = -v ]; then',
        '        case "$a" in *:/data*) data=$(echo "$a" | sed "s|:/data.*||") ;; *:/backup*) backup=$(echo "$a" | sed "s|:/backup.*||") ;; esac',
        "      fi",
        '      [ "$prev" = -c ] && cmd=$a',
        "      prev=$a",
        "    done",
        // STUB_KEEP_FAIL makes the rollback's keep-aside copy fail.
        '    case "$cmd" in "for f in /data/pangolin.sqlite"*) [ -z "$STUB_KEEP_FAIL" ] || exit 1 ;; esac',
        '    cmd=$(printf "%s" "$cmd" | sed -e "s|/data|$data|g" -e "s|/backup|$backup|g")',
        '    exec sh -c "$cmd" ;;',
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "docker"), 0o755);
    // The script's `sed -i` is GNU's; on macOS give it BSD sed's empty suffix.
    writeFileSync(
      join(bin, "sed"),
      [
        "#!/bin/sh",
        'for real in /usr/bin/sed /bin/sed; do [ -x "$real" ] && break; done',
        'if [ "$1" = -i ] && [ "$(uname)" = Darwin ]; then shift; exec "$real" -i "" "$@"; fi',
        'exec "$real" "$@"',
        "",
      ].join("\n"),
    );
    chmodSync(join(bin, "sed"), 0o755);
    return { ...process.env, PATH: `${bin}:${process.env.PATH}`, PANGOLIN_HOME: homeDir };
  }

  function rollBack(dataDir: string, extra: Record<string, string> = {}) {
    const script = at("pangolin.sh");
    writeFileSync(
      script,
      readFileSync(PANGOLIN, "utf8").replace(
        /\/usr\/local\/bin/g,
        join(root, "usr", "local", "bin"),
      ),
    );
    chmodSync(script, 0o755);
    return spawnSync(script, ["upgrade", "v2.0"], {
      encoding: "utf8",
      env: { ...realStub(dataDir), PANGOLIN_UPGRADE_TIMEOUT: "3", ...extra },
    });
  }

  const rolledBack = () => readdirSync(homeDir).filter((f) => f.startsWith("rolled-back-"));

  it("S11d: a rollback keeps what the new server wrote during the health wait", () => {
    const dataDir = at("data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "pangolin.sqlite"), "before the upgrade\n");
    const res = rollBack(dataDir);
    expect(res.stderr).toContain("pangolin: upgrade failed during health check. rolled back");
    expect(readFileSync(at("cmd.log"), "utf8")).toContain("new-server-wrote");
    expect(readFileSync(join(dataDir, "pangolin.sqlite"), "utf8")).toBe("before the upgrade\n");
    // Not lost: kept in the data directory or beside the install for the operator to recover.
    const kept = spawnSync("grep", ["-rl", "written by the new server", dataDir, homeDir], {
      encoding: "utf8",
    });
    expect(kept.stdout.trim()).not.toBe("");
    // In a 0700 rolled-back-<stamp>/ beside the pre-upgrade copy, named in the message.
    const [dir] = rolledBack();
    expect(dir).toBeDefined();
    expect(statSync(join(homeDir, dir ?? "")).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(homeDir, dir ?? "", "pangolin.sqlite"), "utf8")).toBe(
      "before the upgrade\nwritten by the new server\n",
    );
    expect(res.stderr).toContain(`is kept in ${join(homeDir, dir ?? "")}`);
  });

  it("keeps only the last two rolled-back copies", () => {
    const dataDir = at("data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "pangolin.sqlite"), "before the upgrade\n");
    for (const [name, age] of [
      ["rolled-back-20200101000000", 200],
      ["rolled-back-20200102000000", 100],
    ] as const) {
      mkdirSync(join(homeDir, name), { mode: 0o700 });
      const when = new Date(Date.now() - age * 1000);
      utimesSync(join(homeDir, name), when, when);
    }
    rollBack(dataDir);
    const left = rolledBack().sort();
    expect(left).toHaveLength(2);
    expect(left).toContain("rolled-back-20200102000000");
    expect(left).not.toContain("rolled-back-20200101000000");
  });

  it("leaves the live database alone when the upgraded one cannot be kept", () => {
    const dataDir = at("data");
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, "pangolin.sqlite"), "before the upgrade\n");
    const res = rollBack(dataDir, { STUB_KEEP_FAIL: "1" });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/the live database was not touched/);
    expect(res.stderr).toMatch(/the pre-upgrade copy is in .*pre-upgrade-\d+/);
    expect(readFileSync(join(dataDir, "pangolin.sqlite"), "utf8")).toContain(
      "written by the new server",
    );
    // No empty rolled-back directory is left to crowd out a real kept copy when pruning.
    expect(rolledBack()).toEqual([]);
    // The exit trap brings the previous stack back: its .env, and compose up after the failure.
    expect(readFileSync(join(homeDir, ".env"), "utf8")).toContain(ORIGINAL_IMAGE);
    expect(existsSync(join(homeDir, ".env.bak"))).toBe(false);
    const log = readFileSync(at("cmd.log"), "utf8").trim().split("\n");
    expect(log.at(-1)).toMatch(/compose .* up -d pangolin$/);
  });
});
