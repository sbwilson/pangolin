// The admin socket (story 1.9, AD-16): how `pangolin` reaches a running server, so the CLI never
// opens SQLite as a second writer. A Unix socket on the `/run` tmpfs (never the data volume), in
// a 0700 directory, mode 0600. No HTTP: one JSON request line per connection,
// `{ command, args, proof }`, answered by one JSON line, `{ ok: true, result }` or
// `{ ok: false, error: { code, message, details? } }`.
//
// The peer-uid check, without a native addon (Node has no SO_PEERCRED): each request names a
// one-time proof file its client created in the socket's directory. The server `lstat`s it (a
// regular file with one link, owned by the server's own uid, changed within 30 s), deletes it, and
// refuses the request otherwise. The kernel stamps the owner, so only the server's uid can pass,
// even if the socket's or directory's mode were loosened.
import { chmodSync, lstatSync, mkdirSync, rmSync, type Stats, unlinkSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { type ErrorBody, errorBody } from "@pangolin/app";
import { z } from "zod";

/** The largest request line accepted, in bytes. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** A connection idle this long is closed. */
export const IDLE_TIMEOUT_MS = 10_000;
/** How recently a proof file must have been created. */
export const PROOF_MAX_AGE_MS = 30_000;
/** Proof file names: a fixed prefix and a random suffix, never a path. */
export const PROOF_NAME = /^proof-[A-Za-z0-9_-]{16,128}$/;

export type AdminErrorCode = ErrorBody["error"]["code"] | "Forbidden";

export interface AdminError {
  readonly code: AdminErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export type AdminResponse =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: AdminError };

export type AdminLog = (
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown>,
) => void;

export interface AdminSocketOptions {
  readonly path: string;
  /** Runs one command. Throws `AppError` to refuse it; the result must be JSON-serialisable. */
  readonly handle: (command: string, args: unknown) => unknown;
  /** Command names worth logging; any other name is logged as `unknown`. */
  readonly commands: readonly string[];
  /** Structured log sink: command names and outcomes only, never arguments or results. */
  readonly log?: AdminLog;
  /** Epoch milliseconds, for the proof's age. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** How long an idle connection stays open. Defaults to `IDLE_TIMEOUT_MS`. */
  readonly idleTimeoutMs?: number;
  /**
   * Tests only: loosens the directory to 0777 and the socket to 0666, to prove the proof check
   * alone refuses another uid.
   */
  readonly relaxModesForTest?: boolean;
}

export interface AdminSocket {
  readonly path: string;
  /** Stops listening, drops open connections and removes the socket file. */
  close(): Promise<void>;
}

const requestSchema = z
  .object({
    command: z.string().min(1).max(64),
    args: z.record(z.string(), z.unknown()).default({}),
    proof: z.string().min(1).max(200),
  })
  .strict();

function refuse(code: AdminErrorCode, message: string): AdminResponse {
  return { ok: false, error: { code, message } };
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

function ownUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("The admin socket needs a POSIX platform");
  return uid;
}

/**
 * Checks and consumes the proof file `name` in `dir`: true only for a regular file with one link,
 * owned by this process's uid and changed within `PROOF_MAX_AGE_MS`. The file is deleted either
 * way, so a proof is never accepted twice.
 */
export function checkProof(dir: string, name: string, now: number): boolean {
  if (!PROOF_NAME.test(name)) return false;
  const path = join(dir, name);
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch {
    return false;
  }
  // One use only. A directory is left alone (it cannot be a proof and is never removed).
  if (!stats.isDirectory()) {
    try {
      unlinkSync(path);
    } catch {
      return false;
    }
  }
  const age = now - stats.ctimeMs;
  return (
    stats.isFile() &&
    stats.nlink === 1 &&
    stats.uid === ownUid() &&
    age <= PROOF_MAX_AGE_MS &&
    age >= -1_000
  );
}

/** True when something accepts connections on the socket at `path`. */
function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

/** Makes the socket's directory (0700, ours) and clears a stale socket left by a crash. */
async function prepare(path: string, relax: boolean): Promise<void> {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stats = lstatSync(dir);
  if (!stats.isDirectory() || stats.uid !== ownUid()) {
    throw new Error(`${dir} must be a directory owned by the server's user`);
  }
  chmodSync(dir, relax ? 0o777 : 0o700);
  let existing: Stats | undefined;
  try {
    existing = lstatSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (existing === undefined) return;
  if (!existing.isSocket()) throw new Error(`${path} exists and is not a socket`);
  if (await answers(path)) throw new Error(`Another server is listening on ${path}`);
  unlinkSync(path);
}

/**
 * Listens on the admin socket. Throws when its directory cannot be made or is not the server
 * user's, when `path` is some other file, or when another server answers on it.
 */
export async function listenAdminSocket(options: AdminSocketOptions): Promise<AdminSocket> {
  const { path, log = () => {} } = options;
  const now = options.now ?? Date.now;
  const relax = options.relaxModesForTest === true;
  const dir = dirname(path);
  await prepare(path, relax);

  const connections = new Set<Socket>();

  function answer(line: string): AdminResponse {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return refuse("Validation", "Malformed request");
    }
    const request = requestSchema.safeParse(raw);
    if (!request.success) return refuse("Validation", "Malformed request");
    const { command, args, proof } = request.data;
    const name = options.commands.includes(command) ? command : "unknown";
    if (!checkProof(dir, proof, now())) {
      log("warn", "admin request refused", { command: name, code: "Forbidden" });
      return refuse("Forbidden", "Permission denied");
    }
    try {
      const result = options.handle(command, args);
      log("info", "admin command", { command: name, ok: true });
      return { ok: true, result };
    } catch (error) {
      const { error: body } = errorBody(error);
      if (body.code === "Internal") {
        log("error", "admin command failed", {
          command: name,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        log("info", "admin command", { command: name, ok: false, code: body.code });
      }
      return { ok: false, error: body };
    }
  }

  const server: Server = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(options.idleTimeoutMs ?? IDLE_TIMEOUT_MS, () => socket.destroy());
    let buffered = Buffer.alloc(0);
    let answered = false;
    const reply = (response: AdminResponse) => {
      answered = true;
      let line: string;
      try {
        line = JSON.stringify(response);
      } catch {
        line = JSON.stringify(refuse("Internal", "Internal error"));
      }
      socket.end(`${line}\n`);
    };
    socket.on("data", (chunk: Buffer) => {
      if (answered) return;
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf(0x0a);
      if (end === -1 ? buffered.length > MAX_REQUEST_BYTES : end > MAX_REQUEST_BYTES) {
        reply(refuse("Validation", "Request too large"));
        return;
      }
      if (end === -1) return;
      let response: AdminResponse;
      try {
        response = answer(buffered.subarray(0, end).toString("utf8"));
      } catch (error) {
        log("error", "admin request failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        response = refuse("Internal", "Internal error");
      }
      reply(response);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    chmodSync(path, relax ? 0o666 : 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  // A later server error (none is expected once listening) is logged, never left unhandled.
  server.on("error", (error) => {
    log("error", "admin socket error", { error: error.message });
  });

  let closed: Promise<void> | undefined;
  return {
    path,
    close: () => {
      closed ??= new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(path, { force: true });
          resolve();
        });
        for (const socket of connections) socket.destroy();
      });
      return closed;
    },
  };
}
