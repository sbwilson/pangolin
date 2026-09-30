import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId, systemClock } from "@pangolin/app";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeTokens } from "../auth/secret.ts";
import { addLogin, signIn } from "../testing/logins.ts";
import { callAdmin } from "./client.ts";
import { ADMIN_COMMANDS, type AdminDeps, runAdminCommand, type StatusResult } from "./commands.ts";
import {
  type AdminSocket,
  type AdminSocketOptions,
  checkProof,
  listenAdminSocket,
} from "./socket.ts";

let dir: string;
let db: Db;
let deps: AdminDeps;
let socket: AdminSocket | undefined;
let sockPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-admin-"));
  // Another uid must be able to reach the relaxed socket's directory below this one.
  chmodSync(dir, 0o755);
  sockPath = join(dir, "run", "admin.sock");
  db = openDatabase(join(dir, "pangolin.sqlite"));
  const migrations = loadMigrations(packageMigrationsDir);
  migrate(db, migrations);
  deps = {
    uow: createUnitOfWork(db),
    clock: systemClock("UTC"),
    newId,
    tokens: nodeTokens,
    publicUrl: "https://money.example.com",
    systemHealth: createSystemHealthRepo(db),
    expectedSchemaVersion: migrations.length,
    backupConfigured: false,
    runner: () => ({ running: true, lastTickAt: Date.now(), pollMs: 1000 }),
    version: "v9.9.9",
  };
});

async function closeSocket(): Promise<void> {
  await socket?.close();
  socket = undefined;
}

afterEach(async () => {
  await closeSocket();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function listen(extra: Partial<AdminSocketOptions> = {}) {
  const handle = vi.fn((command: string, args: unknown) => runAdminCommand(deps, command, args));
  const log = vi.fn();
  socket = await listenAdminSocket({
    path: sockPath,
    handle,
    commands: ADMIN_COMMANDS,
    log,
    ...extra,
  });
  return { handle, log };
}

/** Sends `text` as-is and returns the parsed answer (or null when the server just closed). */
function raw(text: string | Buffer): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = connect(sockPath);
    let received = "";
    client.on("data", (chunk) => {
      received += chunk;
    });
    client.on("error", reject);
    client.on("close", () => resolve(received === "" ? null : JSON.parse(received)));
    client.write(text);
  });
}

function proofFile(name: string): string {
  const path = join(dir, "run", name);
  writeFileSync(path, "", { mode: 0o600 });
  return path;
}

describe("the admin socket", () => {
  it("listens in a 0700 directory with mode 0600, and answers status", async () => {
    const { log } = await listen();
    expect(statSync(join(dir, "run")).mode & 0o777).toBe(0o700);
    expect(statSync(sockPath).mode & 0o777).toBe(0o600);
    expect(statSync(sockPath).isSocket()).toBe(true);

    const response = await callAdmin(sockPath, "status");
    expect(response.ok).toBe(true);
    const result = (response as { result: StatusResult }).result;
    expect(result).toEqual({
      version: "v9.9.9",
      schemaVersion: deps.expectedSchemaVersion,
      expectedSchemaVersion: deps.expectedSchemaVersion,
      readiness: { ok: true },
      jobs: { pending: 0, running: 0, dead: 0 },
      deadJobs: [],
      backup: { configured: false, last: null, stale: false, check: null, drill: null },
    });
    // The client removed its proof; the server consumed it.
    expect(readdirSync(join(dir, "run"))).toEqual(["admin.sock"]);
    expect(log).toHaveBeenCalledWith("info", "admin command", { command: "status", ok: true });
    // status is a read: no audit row.
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(0);
  });

  it("reports failing readiness checks", async () => {
    deps = { ...deps, runner: () => undefined, expectedSchemaVersion: 99 };
    await listen();
    const response = await callAdmin(sockPath, "status");
    expect(response).toMatchObject({
      ok: true,
      result: { readiness: { ok: false, failing: ["migrations", "jobs"] } },
    });
  });

  it("resets a user as cli:reset-user, and returns the link without logging it", async () => {
    const alex = addLogin(db, "alex@example.com", "Alex");
    addLogin(db, "sam@example.com", "Sam");
    const { log } = await listen();
    const response = await callAdmin(sockPath, "reset-user", { person: "ALEX@example.com" });
    if (!response.ok) throw new Error(JSON.stringify(response.error));
    const result = response.result as { url: string; expiresAt: string; displayName: string };
    expect(result.displayName).toBe("Alex");
    expect(result.url).toMatch(/^https:\/\/money\.example\.com\/recover\?token=[\w-]{43}$/);
    const hours = (Date.parse(result.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(signIn(db, "alex@example.com")).toEqual({ password: expect.any(String), sessions: 0 });
    expect(signIn(db, "alex@example.com").password).not.toBe("old-hash");
    expect(signIn(db, "sam@example.com")).toEqual({ password: "old-hash", sessions: 1 });
    const actors = db.prepare("SELECT DISTINCT actor FROM audit_log").pluck().all();
    expect(actors).toEqual(["cli:reset-user"]);
    const notice = db.prepare("SELECT kind, person_id FROM review_item").get();
    expect(notice).toEqual({ kind: "identity.partner-reset", person_id: alex });

    // By person ID too.
    const again = await callAdmin(sockPath, "reset-user", { person: alex });
    expect(again.ok).toBe(true);
    const token = new URL(result.url).searchParams.get("token") ?? "";
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it("refuses an unknown or missing person, listing only names and emails", async () => {
    addLogin(db, "alex@example.com", "Alex");
    await listen();
    const people = [{ displayName: "Alex", email: "alex@example.com" }];
    expect(await callAdmin(sockPath, "reset-user", { person: "nobody@example.com" })).toEqual({
      ok: false,
      error: {
        code: "NotFound",
        message: "No person with a login matches that email or ID",
        details: { people },
      },
    });
    expect(await callAdmin(sockPath, "reset-user")).toMatchObject({
      ok: false,
      error: { code: "Validation", details: { people } },
    });
    expect(db.prepare("SELECT count(*) FROM audit_log").pluck().get()).toBe(0);
  });

  it("refuses a request whose proof is missing, stale, a path or not a regular file", async () => {
    const { handle } = await listen({ now: () => Date.now() + 60_000 });
    const request = (proof: string) =>
      raw(`${JSON.stringify({ command: "status", args: {}, proof })}\n`);
    const forbidden = { ok: false, error: { code: "Forbidden", message: "Permission denied" } };

    expect(await request("proof-doesnotexist000000000")).toEqual(forbidden);
    // Created a minute before the server's clock: stale, and deleted all the same.
    const stale = proofFile("proof-stale0000000000000000");
    expect(await request("proof-stale0000000000000000")).toEqual(forbidden);
    expect(existsSync(stale)).toBe(false);
    // Only a bare name in the socket's directory is ever looked at.
    writeFileSync(join(dir, "proof-outside000000000000000"), "");
    expect(await request("../proof-outside000000000000000")).toEqual(forbidden);
    expect(existsSync(join(dir, "proof-outside000000000000000"))).toBe(true);
    expect(handle).not.toHaveBeenCalled();
  });

  it("refuses a proof that is a directory, and a proof used twice", async () => {
    const { handle } = await listen();
    const request = (proof: string) =>
      raw(`${JSON.stringify({ command: "status", args: {}, proof })}\n`);
    mkdirSync(join(dir, "run", "proof-adirectory00000000000"));
    expect(await request("proof-adirectory00000000000")).toMatchObject({
      error: { code: "Forbidden" },
    });
    proofFile("proof-once000000000000000000");
    expect(await request("proof-once000000000000000000")).toMatchObject({ ok: true });
    expect(await request("proof-once000000000000000000")).toMatchObject({
      error: { code: "Forbidden" },
    });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed requests, unknown commands and oversized lines", async () => {
    const { handle } = await listen();
    expect(await raw("not json\n")).toEqual({
      ok: false,
      error: { code: "Validation", message: "Malformed request" },
    });
    expect(await raw(`${JSON.stringify({ command: "status" })}\n`)).toMatchObject({
      error: { code: "Validation", message: "Malformed request" },
    });
    expect(
      await raw(`${JSON.stringify({ command: "status", proof: "p", extra: 1 })}\n`),
    ).toMatchObject({ error: { code: "Validation" } });
    // `restore` never runs on the socket: only on a stopped stack.
    for (const command of ["eval", "query", "restore", "__proto__"]) {
      proofFile("proof-unknown000000000000000");
      expect(
        await raw(
          `${JSON.stringify({ command, args: {}, proof: "proof-unknown000000000000000" })}\n`,
        ),
      ).toEqual({ ok: false, error: { code: "Validation", message: "Unknown command" } });
    }
    expect(await raw(Buffer.alloc(64 * 1024 + 10, 0x61))).toEqual({
      ok: false,
      error: { code: "Validation", message: "Request too large" },
    });
    // Unknown arguments are refused by the command.
    const bad = await callAdmin(sockPath, "status", { verbose: true });
    expect(bad).toMatchObject({ ok: false, error: { code: "Validation" } });
    expect(handle.mock.calls.map(([command]) => command)).toEqual([
      "eval",
      "query",
      "restore",
      "__proto__",
      "status",
    ]);
  });

  it("closes an idle connection", async () => {
    await listen({ idleTimeoutMs: 100 });
    const started = Date.now();
    expect(await raw('{"command":"status"')).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("clears a stale socket file, and refuses a path another server answers on", async () => {
    await listen();
    await expect(
      listenAdminSocket({ path: sockPath, handle: () => null, commands: [] }),
    ).rejects.toThrow(/Another server is listening/);
    await closeSocket();
    expect(existsSync(sockPath)).toBe(false);

    // A server killed outright leaves its socket file behind; the next one replaces it.
    const script = `require("node:net").createServer().listen(${JSON.stringify(sockPath)}, () => process.stdout.write("up"))`;
    const crashed = spawn(process.execPath, ["-e", script]);
    await new Promise((resolve) => crashed.stdout.once("data", resolve));
    await new Promise((resolve) => {
      crashed.once("exit", resolve);
      crashed.kill("SIGKILL");
    });
    expect(statSync(sockPath).isSocket()).toBe(true);
    await listen();
    expect((await callAdmin(sockPath, "status")).ok).toBe(true);
    await closeSocket();

    writeFileSync(sockPath, "not a socket");
    await expect(
      listenAdminSocket({ path: sockPath, handle: () => null, commands: [] }),
    ).rejects.toThrow(/is not a socket/);
  });

  it("never chmods an existing directory: refuses one others can reach, keeps a 0700 one", async () => {
    const run = join(dir, "run");
    mkdirSync(run, { mode: 0o755 });
    chmodSync(run, 0o755);
    await expect(
      listenAdminSocket({ path: sockPath, handle: () => null, commands: [] }),
    ).rejects.toThrow(/mode 0700/);
    expect(statSync(run).mode & 0o777).toBe(0o755);
    expect(existsSync(sockPath)).toBe(false);

    chmodSync(run, 0o700);
    await listen();
    expect(statSync(run).mode & 0o777).toBe(0o700);
    expect((await callAdmin(sockPath, "status")).ok).toBe(true);
  });

  it("checkProof refuses a hard-linked proof and a symlink, and consumes them", () => {
    const run = join(dir, "proofs");
    mkdirSync(run, { mode: 0o700 });
    const now = Date.now();
    const fresh = (name: string) => {
      writeFileSync(join(run, name), "", { mode: 0o600 });
      return join(run, name);
    };
    fresh("proof-good0000000000000000");
    expect(checkProof(run, "proof-good0000000000000000", now)).toBe(true);

    const target = fresh("proof-target00000000000000");
    linkSync(target, join(run, "proof-hardlink0000000000"));
    expect(checkProof(run, "proof-hardlink0000000000", now)).toBe(false);
    expect(existsSync(join(run, "proof-hardlink0000000000"))).toBe(false);

    symlinkSync(fresh("proof-pointee0000000000000"), join(run, "proof-symlink00000000000000"));
    expect(checkProof(run, "proof-symlink00000000000000", now)).toBe(false);
    expect(existsSync(join(run, "proof-symlink00000000000000"))).toBe(false);
    // The link's target is left alone.
    expect(existsSync(join(run, "proof-pointee0000000000000"))).toBe(true);
  });

  // A foreign uid needs root to spawn, and the relaxed modes let it reach the socket at all.
  it.skipIf(process.getuid?.() !== 0)(
    "refuses another uid even with the socket's modes relaxed, running nothing",
    async () => {
      const { handle } = await listen({ relaxModesForTest: true });
      expect(statSync(sockPath).mode & 0o777).toBe(0o666);
      const script = `
        const fs = require("node:fs");
        const net = require("node:net");
        const proof = "proof-foreign0000000000000000";
        fs.writeFileSync(${JSON.stringify(join(dir, "run"))} + "/" + proof, "", { mode: 0o600 });
        const client = net.connect(${JSON.stringify(sockPath)});
        let answer = "";
        client.on("data", (chunk) => { answer += chunk; });
        client.on("close", () => process.stdout.write(answer));
        client.on("error", (error) => { process.stderr.write(String(error)); process.exit(2); });
        client.write(JSON.stringify({ command: "reset-user", args: {}, proof }) + "\\n");
      `;
      const output = await new Promise<string>((resolve, reject) => {
        const proc = spawn(process.execPath, ["-e", script], { uid: 65534, gid: 65534 });
        let out = "";
        let err = "";
        proc.stdout.on("data", (chunk) => {
          out += chunk;
        });
        proc.stderr.on("data", (chunk) => {
          err += chunk;
        });
        proc.on("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(err))));
      });
      expect(JSON.parse(output)).toEqual({
        ok: false,
        error: { code: "Forbidden", message: "Permission denied" },
      });
      expect(handle).not.toHaveBeenCalled();
    },
  );
});
