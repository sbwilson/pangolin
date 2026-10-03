// The release workflow's migrate-previous helpers (story 1.18): finding the previous release
// and creating the database its image makes on first boot.
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(here, "..", ".github", "scripts");
const PREVIOUS_RELEASE = join(SCRIPTS, "previous-release.sh");
const PREVIOUS_DB = join(SCRIPTS, "previous-db.sh");
const RELEASE_TAGS = join(SCRIPTS, "release-tags.sh");
const IMAGE = "ghcr.io/example/pangolin:v1.2.3";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pangolin-release-scripts-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  const result = spawnSync("sh", args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** No global or system git config, so a developer's signing settings cannot get in the way. */
function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
}

function git(...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: gitEnv() });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
}

describe("release-tags.sh", () => {
  beforeEach(() => {
    git("init", "-q");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
  });

  const tag = (...names: string[]) => {
    for (const name of names) git("tag", name);
  };
  const tags = (current: string) => run([RELEASE_TAGS, current], { cwd: root });

  it("moves vX.Y and latest for the newest release", () => {
    tag("v1.1.0", "v1.2.0", "v1.2.1");
    const result = tags("v1.2.1");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("v1.2.1\nv1.2\nlatest\n");
  });

  it("moves neither latest nor the newer line's vX.Y for a patch on an older line", () => {
    tag("v1.1.4", "v1.2.0", "v1.1.5");
    expect(tags("v1.1.5").stdout).toBe("v1.1.5\nv1.1\n");
  });

  it("moves nothing but the version tag for an older patch in its own line", () => {
    tag("v1.2.0", "v1.2.2", "v1.2.1");
    expect(tags("v1.2.1").stdout).toBe("v1.2.1\n");
  });

  it("orders by version, so v0.10.0 is above v0.9.9", () => {
    tag("v0.9.9", "v0.10.0");
    expect(tags("v0.10.0").stdout).toBe("v0.10.0\nv0.10\nlatest\n");
    expect(tags("v0.9.9").stdout).toBe("v0.9.9\nv0.9\n");
  });

  it("gives a pre-release only its own tag, and does not let it hold back its release", () => {
    tag("v1.2.0", "v1.3.0-rc1");
    expect(tags("v1.3.0-rc1").stdout).toBe("v1.3.0-rc1\n");
    tag("v1.3.0");
    expect(tags("v1.3.0").stdout).toBe("v1.3.0\nv1.3\nlatest\n");
  });

  it("fails for a tag the repository does not have, and without one argument", () => {
    tag("v1.0.0");
    const result = tags("v9.9.9");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Tag v9.9.9 is not in the repository's v*.*.* tags");
    expect(run([RELEASE_TAGS], { cwd: root }).status).toBe(2);
  });
});

describe("previous-release.sh", () => {
  beforeEach(() => {
    git("init", "-q");
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
  });

  const tag = (...names: string[]) => {
    for (const name of names) git("tag", name);
  };
  const previous = (current: string) => run([PREVIOUS_RELEASE, current], { cwd: root });

  it("prints the release just below the given tag", () => {
    tag("v1.0.0", "v1.1.0", "v1.2.0");
    const result = previous("v1.2.0");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("v1.1.0\n");
  });

  it("prints nothing for the first release", () => {
    tag("v1.0.0", "v1.1.0");
    const result = previous("v1.0.0");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("orders by version, so v0.10.0 is above v0.9.0", () => {
    tag("v0.9.0", "v0.10.0", "v0.10.1");
    expect(previous("v0.10.0").stdout).toBe("v0.9.0\n");
    expect(previous("v0.10.1").stdout).toBe("v0.10.0\n");
  });

  it("fails for a tag that is not a v*.*.* tag of the repository", () => {
    tag("v1.0.0");
    const result = previous("v9.9.9");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Tag v9.9.9 is not in the repository's v*.*.* tags");
  });

  it("never picks a pre-release, and a pre-release migrates from the last release", () => {
    tag("v1.1.0", "v1.2.0-rc1", "v1.2.0", "v1.3.0-rc1", "v1.3.0-rc2", "v1.3.0");
    expect(previous("v1.2.0").stdout).toBe("v1.1.0\n");
    expect(previous("v1.3.0").stdout).toBe("v1.2.0\n");
    expect(previous("v1.2.0-rc1").stdout).toBe("v1.1.0\n");
    const rc = previous("v1.3.0-rc2");
    expect(rc.status).toBe(0);
    expect(rc.stdout).toBe("v1.2.0\n");
  });

  it("prints nothing for a pre-release of the first release", () => {
    tag("v1.0.0-rc1", "v1.0.0");
    const result = previous("v1.0.0-rc1");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fails without exactly one argument", () => {
    expect(run([PREVIOUS_RELEASE], { cwd: root }).status).toBe(2);
  });
});

describe("previous-db.sh (stub docker, curl and sudo)", () => {
  let data: string;
  let dockerLog: string;
  let curlCount: string;

  function stub(name: string, lines: string[]): void {
    const file = join(root, "bin", name);
    writeFileSync(file, ["#!/bin/sh", ...lines, ""].join("\n"));
    chmodSync(file, 0o755);
  }

  beforeEach(() => {
    mkdirSync(join(root, "bin"));
    data = join(root, "data");
    dockerLog = join(root, "docker.log");
    curlCount = join(root, "curl.count");
    stub("docker", [
      `echo "$*" >> "${dockerLog}"`,
      'case "$1" in',
      '  pull) [ "$STUB_PULL_FAILS" = 1 ] && { echo "manifest unknown" >&2; exit 1; } ;;',
      "  run)",
      '    [ "$STUB_RUN_CREATES" = 1 ] && touch "$STUB_CONTAINER"',
      '    [ "$STUB_RUN_FAILS" = 1 ] && exit 1',
      '    touch "$STUB_CONTAINER"',
      // The first boot creates the database, unless the test says it does not.
      `    [ "$STUB_CREATES_DB" = 1 ] && touch "${join(root, "data", "pangolin.sqlite")}"`,
      "    echo stub-container-id ;;",
      '  container) [ -f "$STUB_CONTAINER" ] || exit 1 ;;',
      '  stop) [ "$STUB_STOP_FAILS" = 1 ] && exit 1 ;;',
      '  logs) echo "STUB-LOG-MARKER: migration failed" ;;',
      "esac",
      "exit 0",
    ]);
    // Healthy from the STUB_HEALTHY_AFTER-th poll on (0: never).
    stub("curl", [
      `n=$(($(cat "${curlCount}" 2>/dev/null || echo 0) + 1))`,
      `echo "$n" > "${curlCount}"`,
      '[ "$STUB_HEALTHY_AFTER" -gt 0 ] && [ "$n" -ge "$STUB_HEALTHY_AFTER" ] && exit 0',
      "exit 22",
    ]);
    stub("sudo", [`echo "sudo $*" >> "${dockerLog}"`, "exit 0"]);
  });

  const previousDb = (env: Record<string, string>, args: readonly string[] = [IMAGE, data]) =>
    run([PREVIOUS_DB, ...args], {
      env: {
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        PANGOLIN_PREVIOUS_TIMEOUT: "1",
        PANGOLIN_PREVIOUS_POLL: "1",
        STUB_CONTAINER: join(root, "container"),
        STUB_PULL_FAILS: "0",
        STUB_RUN_FAILS: "0",
        STUB_RUN_CREATES: "0",
        STUB_STOP_FAILS: "0",
        STUB_CREATES_DB: "1",
        STUB_HEALTHY_AFTER: "1",
        ...env,
      },
    });
  const dockerCalls = () =>
    existsSync(dockerLog) ? readFileSync(dockerLog, "utf8").trim().split("\n") : [];
  const removed = (calls: string[]) => calls.includes("rm -f pangolin-previous");

  it("boots the image on the data directory, waits for health, stops and removes it", () => {
    const result = previousDb({ STUB_HEALTHY_AFTER: "2" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(existsSync(data)).toBe(true);
    const calls = dockerCalls();
    expect(calls[0]).toBe(`pull ${IMAGE}`);
    const runCall = calls.find((c) => c.startsWith("run "));
    expect(runCall).toContain("--read-only");
    expect(runCall).toContain("--cap-drop ALL");
    expect(runCall).toContain(`-v ${data}:/data`);
    expect(runCall?.endsWith(IMAGE)).toBe(true);
    expect(readFileSync(curlCount, "utf8").trim()).toBe("2");
    expect(calls).toContain("stop pangolin-previous");
    expect(calls.some((c) => c.startsWith("logs"))).toBe(false);
    // The data directory goes back to the caller only once the container has stopped.
    const stop = calls.indexOf("stop pangolin-previous");
    const chown = calls.findIndex((c) => c.startsWith("sudo chown -R"));
    expect(chown).toBeGreaterThan(stop);
    expect(calls.at(-1)).toBe("rm -f pangolin-previous");
  });

  it("fails naming the image and the tag to delete when the pull fails, and runs nothing", () => {
    const result = previousDb({ STUB_PULL_FAILS: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Cannot pull ${IMAGE}`);
    expect(result.stderr).toContain("v1.2.3 is a release that failed its gates");
    expect(result.stderr).toContain("git push --delete origin v1.2.3 && git tag -d v1.2.3");
    expect(dockerCalls()).toEqual([`pull ${IMAGE}`]);
  });

  it("fails naming the image when it cannot start, with the logs of a created container", () => {
    const result = previousDb({ STUB_RUN_FAILS: "1", STUB_RUN_CREATES: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Cannot start ${IMAGE}`);
    expect(result.stdout).toContain("STUB-LOG-MARKER");
    expect(removed(dockerCalls())).toBe(true);
  });

  it("fails when it cannot start, without logs when no container was created", () => {
    const result = previousDb({ STUB_RUN_FAILS: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Cannot start ${IMAGE}`);
    expect(result.stdout).not.toContain("STUB-LOG-MARKER");
  });

  it("fails naming the image, after its logs, when it never becomes healthy", () => {
    const result = previousDb({ STUB_HEALTHY_AFTER: "0" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("STUB-LOG-MARKER");
    expect(result.stderr).toContain(`${IMAGE} never became healthy`);
    const calls = dockerCalls();
    expect(calls.indexOf("stop pangolin-previous")).toBeLessThan(
      calls.indexOf("logs pangolin-previous"),
    );
    expect(calls.some((c) => c.startsWith("sudo chown -R"))).toBe(false);
    expect(removed(calls)).toBe(true);
  });

  it("still prints the logs and the error when the stop fails", () => {
    const result = previousDb({ STUB_HEALTHY_AFTER: "0", STUB_STOP_FAILS: "1" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("STUB-LOG-MARKER");
    expect(result.stderr).toContain(`${IMAGE} never became healthy`);
    expect(removed(dockerCalls())).toBe(true);
  });

  it("fails when a healthy first boot left no pangolin.sqlite", () => {
    const result = previousDb({ STUB_CREATES_DB: "0" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`No pangolin.sqlite in ${data} after first boot of ${IMAGE}`);
  });

  it.each(["0", "00", "08", "abc"])("refuses a poll or timeout of %j", (value) => {
    for (const name of ["PANGOLIN_PREVIOUS_POLL", "PANGOLIN_PREVIOUS_TIMEOUT"]) {
      const result = previousDb({ [name]: value });
      expect(result.status, name).toBe(2);
      expect(result.stderr).toContain("must be positive whole numbers");
    }
    expect(dockerCalls()).toEqual([]);
  });

  it("fails without exactly two arguments", () => {
    expect(previousDb({}, [IMAGE]).status).toBe(2);
    expect(previousDb({}, [IMAGE, data, "extra"]).status).toBe(2);
    expect(dockerCalls()).toEqual([]);
  });
});
