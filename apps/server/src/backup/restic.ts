// restic as a child process (story 1.10). The password reaches restic only as a file
// (`RESTIC_PASSWORD_FILE`), never in its environment or arguments, and its cache lives on the
// data volume. Backups only add: nothing here runs `forget`, `prune` or any other removal; the
// append-only server applies retention.
import { spawn } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JobSignal } from "@pangolin/app";
import { checkRepositoryReachable } from "./reachable.ts";

/** Every snapshot this server pushes carries this host name and tag. */
export const RESTIC_HOST = "pangolin";
export const RESTIC_TAG = "pangolin";

/** restic's exit code for "no repository at this location" (0.17 and later). */
const EXIT_NO_REPOSITORY = 10;
/** How much of restic's stderr an error keeps. */
const STDERR_TAIL = 2000;

export interface ResticOptions {
  /** The binary; `restic` on the PATH in the image. */
  readonly bin: string;
  readonly repository: string;
  readonly passwordFile: string;
  readonly cacheDir: string;
  /**
   * restic's temporary pack files (`TMPDIR`): on the data volume, as the container's `/tmp` is a
   * small tmpfs. Defaults to `tmp` beside the cache directory.
   */
  readonly tmpDir?: string;
}

/** A snapshot as `restic snapshots --json` lists it. */
export interface ResticSnapshot {
  /** The full ID, 64 hex characters. */
  readonly id: string;
  readonly time: string;
  /** The absolute paths it holds. */
  readonly paths: readonly string[];
}

export interface Restic {
  /** Initialises the repository when there is none yet (the append-only server allows it). */
  ensureRepository(signal?: JobSignal): Promise<void>;
  /**
   * Backs up `paths` (absolute) and returns the new snapshot's ID. `time` (an ISO instant, to
   * the second) becomes the snapshot's time, so snapshots order by when the database was taken,
   * whatever order their pushes finish in.
   */
  backup(
    paths: readonly string[],
    options?: { readonly time?: string; readonly signal?: JobSignal },
  ): Promise<string>;
  /** The snapshot `ref` names (an ID or prefix), or the newest of ours for `latest`. */
  findSnapshot(ref: string, signal?: JobSignal): Promise<ResticSnapshot | undefined>;
  /** Restores the whole snapshot `id` under `target`, keeping its absolute paths. */
  restore(id: string, target: string, signal?: JobSignal): Promise<void>;
}

export class ResticError extends Error {
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null) {
    super(message);
    this.name = "ResticError";
    this.exitCode = exitCode;
  }
}

/** A repository URL with any `user:password@` replaced, for messages and logs. */
export function redactRepository(text: string): string {
  return text.replace(/(\/\/)[^/@\s]*@/g, "$1***@");
}

interface Ran {
  readonly code: number | null;
  readonly stderr: string;
}

function checkPasswordFile(file: string): void {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    throw new ResticError(`The restic password file ${file} is missing or unreadable`, null);
  }
  if (size === 0) throw new ResticError(`The restic password file ${file} is empty`, null);
}

/** restic's environment: ours, with the repository, password file and cache set. */
function resticEnv(options: ResticOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Only the file: never a password (or a command printing one) inherited from the environment.
  delete env.RESTIC_PASSWORD;
  delete env.RESTIC_PASSWORD_COMMAND;
  delete env.RESTIC_KEY_HINT;
  return {
    ...env,
    RESTIC_REPOSITORY: options.repository,
    RESTIC_PASSWORD_FILE: options.passwordFile,
    RESTIC_CACHE_DIR: options.cacheDir,
    TMPDIR: tmpDirOf(options),
    // restic reads and prints times in local time: make that UTC, as `--time` is given in UTC.
    TZ: "UTC",
  };
}

function tmpDirOf(options: ResticOptions): string {
  return options.tmpDir ?? join(dirname(options.cacheDir), "tmp");
}

export function createRestic(options: ResticOptions): Restic {
  /** Runs restic, calling `onLine` for each stdout line; resolves with the exit code. */
  function run(args: readonly string[], onLine?: (line: string) => void, signal?: JobSignal) {
    checkPasswordFile(options.passwordFile);
    mkdirSync(options.cacheDir, { recursive: true, mode: 0o700 });
    mkdirSync(tmpDirOf(options), { recursive: true, mode: 0o700 });
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<Ran>((resolve, reject) => {
      const child = spawn(options.bin, args, {
        env: resticEnv(options),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const onAbort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        let end = stdout.indexOf("\n");
        while (end !== -1) {
          onLine?.(stdout.slice(0, end));
          stdout = stdout.slice(end + 1);
          end = stdout.indexOf("\n");
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL);
      });
      child.once("error", (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(new ResticError(`Could not run ${options.bin}: ${error.message}`, null));
      });
      child.once("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        if (stdout !== "") onLine?.(stdout);
        if (signal?.aborted) reject(signal.reason);
        else resolve({ code, stderr });
      });
    });
  }

  function failed(command: string, ran: Ran): ResticError {
    const detail = redactRepository(ran.stderr.trim()).split("\n").slice(-5).join(" | ");
    return new ResticError(
      `restic ${command} exited with ${ran.code ?? "a signal"}${detail === "" ? "" : `: ${detail}`}`,
      ran.code,
    );
  }

  async function listSnapshots(args: readonly string[], signal?: JobSignal) {
    let text = "";
    const ran = await run(["snapshots", "--json", ...args], (line) => (text += line), signal);
    if (ran.code !== 0) throw failed("snapshots", ran);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text === "" ? "[]" : text);
    } catch {
      throw new ResticError("restic snapshots printed something other than JSON", 0);
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((raw): ResticSnapshot[] => {
      const s = raw as { id?: unknown; time?: unknown; paths?: unknown };
      if (typeof s.id !== "string" || typeof s.time !== "string" || !Array.isArray(s.paths)) {
        return [];
      }
      return [{ id: s.id, time: s.time, paths: s.paths.filter((p) => typeof p === "string") }];
    });
  }

  return {
    ensureRepository: async (signal) => {
      await checkRepositoryReachable(options.repository);
      const probe = await run(["cat", "config"], undefined, signal);
      if (probe.code === 0) return;
      if (probe.code !== EXIT_NO_REPOSITORY) throw failed("cat config", probe);
      const init = await run(["init"], undefined, signal);
      if (init.code !== 0) throw failed("init", init);
    },

    backup: async (paths, { time, signal } = {}) => {
      let snapshotId: string | undefined;
      // restic's --time format: `2006-01-02 15:04:05`, in TZ (UTC).
      const at =
        time === undefined
          ? []
          : ["--time", new Date(time).toISOString().slice(0, 19).replace("T", " ")];
      const ran = await run(
        ["backup", "--json", "--host", RESTIC_HOST, "--tag", RESTIC_TAG, ...at, ...paths],
        (line) => {
          try {
            const message = JSON.parse(line) as { message_type?: unknown; snapshot_id?: unknown };
            if (message.message_type === "summary" && typeof message.snapshot_id === "string") {
              snapshotId = message.snapshot_id;
            }
          } catch {
            // Progress lines that are not JSON are ignored.
          }
        },
        signal,
      );
      // Exit 3 means some files could not be read: the snapshot is incomplete, so it failed.
      if (ran.code !== 0) throw failed("backup", ran);
      if (snapshotId === undefined || !/^[0-9a-f]{64}$/.test(snapshotId)) {
        throw new ResticError("restic backup reported no snapshot ID", 0);
      }
      return snapshotId;
    },

    findSnapshot: async (ref, signal) => {
      if (ref === "latest") {
        // One per host and path set with --latest, and each backup stages under its own path,
        // so take the newest of all of ours.
        const ours = await listSnapshots(["--tag", RESTIC_TAG], signal);
        return ours.reduce<ResticSnapshot | undefined>(
          (newest, s) =>
            newest === undefined || Date.parse(s.time) > Date.parse(newest.time) ? s : newest,
          undefined,
        );
      }
      if (!/^[0-9a-f]{4,64}$/.test(ref)) return undefined;
      const [match] = await listSnapshots([ref], signal);
      return match;
    },

    restore: async (id, target, signal) => {
      const ran = await run(["restore", id, "--target", target], undefined, signal);
      if (ran.code !== 0) throw failed("restore", ran);
    },
  };
}
