#!/usr/bin/env node
// A stand-in for the restic binary in tests (story 1.10): the subcommands Pangolin runs, over a
// plain directory named by RESTIC_REPOSITORY (`stub:<dir>`). Like the real server in append-only
// mode it refuses `forget` and `prune`. It checks the password arrives only as a readable,
// non-empty RESTIC_PASSWORD_FILE and the cache under RESTIC_CACHE_DIR.
//
// STUB_RESTIC_FAIL=<subcommand> makes that subcommand fail (exit 1, with a message on stderr).
// STUB_RESTIC_HANG=<subcommand> makes it write its PID to STUB_RESTIC_PIDFILE and never finish.
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const [command] = args;
const fail = (code, message) => {
  process.stderr.write(`Fatal: ${message}\n`);
  process.exit(code);
};

const repoUrl = process.env.RESTIC_REPOSITORY ?? "";
if (!repoUrl.startsWith("stub:")) fail(1, "Please specify repository location (-r or --repo)");
if (process.env.RESTIC_PASSWORD !== undefined) fail(1, "RESTIC_PASSWORD must not be set");
const passwordFile = process.env.RESTIC_PASSWORD_FILE ?? "";
let password = "";
try {
  password = readFileSync(passwordFile, "utf8").trim();
} catch {
  fail(1, `cannot read the password file ${passwordFile}`);
}
if (password === "") fail(1, "an empty password is not allowed");
if ((process.env.RESTIC_CACHE_DIR ?? "") === "") fail(1, "no cache dir");
if (process.env.STUB_RESTIC_FAIL === command) fail(1, `${command} failed on purpose`);
if (process.env.STUB_RESTIC_HANG === command) {
  writeFileSync(process.env.STUB_RESTIC_PIDFILE ?? "/dev/null", String(process.pid));
  await new Promise(() => setInterval(() => {}, 60_000));
}

const repo = repoUrl.slice("stub:".length);
const config = join(repo, "config");
const snapshotsDir = join(repo, "snapshots");

function flag(name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

/** The arguments that are not flags or flag values. */
function positional() {
  const out = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!["--json"].includes(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function requireRepo() {
  if (!existsSync(config)) {
    process.stderr.write(`Fatal: repository does not exist: unable to open config file\n`);
    process.exit(10);
  }
  if (readFileSync(config, "utf8") !== password) fail(12, "wrong password or no key found");
}

function listSnapshots() {
  if (!existsSync(snapshotsDir)) return [];
  return readdirSync(snapshotsDir)
    .map((id) => JSON.parse(readFileSync(join(snapshotsDir, id, "meta.json"), "utf8")))
    .sort((a, b) => (a.time < b.time ? -1 : 1));
}

switch (command) {
  case "cat":
    requireRepo();
    process.stdout.write("{}\n");
    break;
  case "init":
    if (existsSync(config)) fail(1, "config file already exists");
    mkdirSync(repo, { recursive: true });
    writeFileSync(config, password);
    process.stdout.write(`created restic repository at ${repoUrl}\n`);
    break;
  case "backup": {
    requireRepo();
    const paths = positional();
    // Strictly increasing times, however fast the tests run.
    const last = listSnapshots().at(-1)?.time;
    const id = randomBytes(32).toString("hex");
    const dir = join(snapshotsDir, id);
    for (const path of paths) {
      if (!existsSync(path)) fail(1, `${path} does not exist`);
      cpSync(path, join(dir, "tree", path), { recursive: true });
    }
    const now = new Date();
    const given = flag("--time");
    // --time is `YYYY-MM-DD HH:MM:SS` in TZ, which Pangolin sets to UTC.
    if (given !== undefined && process.env.TZ !== "UTC") fail(1, "--time without TZ=UTC");
    const time =
      given !== undefined
        ? new Date(`${given.replace(" ", "T")}Z`).toISOString()
        : last !== undefined && now.toISOString() <= last
          ? new Date(Date.parse(last) + 1).toISOString()
          : now.toISOString();
    const meta = { id, time, paths, hostname: flag("--host"), tags: [flag("--tag")] };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
    process.stdout.write(`${JSON.stringify({ message_type: "status", percent_done: 0.5 })}\n`);
    process.stdout.write(
      `${JSON.stringify({ message_type: "summary", files_new: 1, snapshot_id: id })}\n`,
    );
    break;
  }
  case "snapshots": {
    requireRepo();
    const tag = flag("--tag");
    const [ref] = positional();
    const found = listSnapshots().filter(
      (s) =>
        (tag === undefined || s.tags.includes(tag)) && (ref === undefined || s.id.startsWith(ref)),
    );
    process.stdout.write(`${JSON.stringify(found)}\n`);
    break;
  }
  case "restore": {
    requireRepo();
    const [ref] = positional();
    const target = flag("--target");
    const match = listSnapshots().filter((s) => s.id.startsWith(ref ?? "-"));
    if (match.length !== 1) fail(1, `no matching ID found for prefix "${ref}"`);
    cpSync(join(snapshotsDir, match[0].id, "tree"), target, { recursive: true });
    break;
  }
  case "forget":
  case "prune":
    requireRepo();
    fail(1, "unexpected HTTP response (403): 403 Forbidden");
    break;
  default:
    fail(1, `unknown command ${command}`);
}
