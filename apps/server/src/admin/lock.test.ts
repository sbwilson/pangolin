import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageMigrationsDir } from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_BACKUP_CONFIG, DEFAULT_JOBS_CONFIG, defaultAuthConfig } from "../config.ts";
import { startServer } from "../server.ts";
import { acquireDataDirLock, DataDirLocked } from "./lock.ts";

const LOCK_MODULE = fileURLToPath(new URL("./lock.ts", import.meta.url));

let dir: string;
let child: ChildProcess | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-lock-"));
});

afterEach(() => {
  child?.kill("SIGKILL");
  child = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Another process that takes the lock on `dataDir` and holds it until killed. */
async function holdInChild(dataDir: string): Promise<ChildProcess> {
  const script = [
    `import { acquireDataDirLock } from ${JSON.stringify(LOCK_MODULE)};`,
    `acquireDataDirLock(${JSON.stringify(dataDir)});`,
    'process.stdout.write("locked\\n");',
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const proc = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  await new Promise<void>((resolve, reject) => {
    let err = "";
    proc.stderr?.on("data", (chunk) => {
      err += chunk;
    });
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("locked")) resolve();
    });
    proc.once("exit", (code) => reject(new Error(`the child exited (${code}): ${err}`)));
  });
  return proc;
}

function killed(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    proc.once("exit", () => resolve());
    proc.kill("SIGKILL");
  });
}

describe("acquireDataDirLock", () => {
  it("is exclusive within one process, and free again once released", () => {
    const first = acquireDataDirLock(dir);
    expect(() => acquireDataDirLock(dir)).toThrow(DataDirLocked);
    expect(() => acquireDataDirLock(dir)).toThrow(`another process holds ${dir}`);
    first.release();
    first.release();
    acquireDataDirLock(dir).release();
  });

  it("is exclusive across processes, and released when the holder dies", async () => {
    const holder = await holdInChild(dir);
    expect(() => acquireDataDirLock(dir)).toThrow(DataDirLocked);
    await killed(holder);
    const lock = acquireDataDirLock(dir);
    lock.release();
  });

  it("keeps a second server off the data directory, and lets it start once released", async () => {
    const dataDir = join(dir, "data");
    mkdirSync(dataDir);
    const boot = () =>
      startServer({
        config: {
          dataDir,
          port: 0,
          demo: false,
          jobs: DEFAULT_JOBS_CONFIG,
          backup: DEFAULT_BACKUP_CONFIG,
          auth: defaultAuthConfig(dataDir),
          trustedProxies: [],
          adminSocket: null,
          version: "test",
        },
        migrationsDir: packageMigrationsDir,
      });
    const holder = await holdInChild(dataDir);
    await expect(boot()).rejects.toThrow(`another process holds ${dataDir}`);
    await killed(holder);

    const server = await boot();
    try {
      // The running server holds it in turn.
      expect(() => acquireDataDirLock(dataDir)).toThrow(DataDirLocked);
      await expect(boot()).rejects.toThrow(`another process holds ${dataDir}`);
    } finally {
      await server.close();
    }
    acquireDataDirLock(dataDir).release();
  });
});
