// The admin socket's client (story 1.9): what `dist/cli.js` uses to reach a running server. It
// creates a one-time proof file (0600) in the socket's directory, sends one request line naming
// it, reads one response line, and removes the proof whatever happens.
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import type { AdminResponse } from "./socket.ts";

/** No server answers on the socket (not running here, or its socket is elsewhere). */
export class AdminUnreachable extends Error {
  constructor(path: string, cause?: unknown) {
    super(`No server answers on ${path}`, cause === undefined ? undefined : { cause });
    this.name = "AdminUnreachable";
  }
}

/** How long the client waits for an answer. */
export const CLIENT_TIMEOUT_MS = 30_000;

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

const UNREACHABLE = new Set(["ENOENT", "ECONNREFUSED", "ENOTDIR"]);

function exchange(path: string, line: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let received = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };
    socket.setTimeout(timeoutMs, () =>
      settle(() => reject(new Error(`The server did not answer within ${timeoutMs / 1000} s`))),
    );
    socket.once("connect", () => socket.write(`${line}\n`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      received += chunk;
      const end = received.indexOf("\n");
      if (end !== -1) settle(() => resolve(received.slice(0, end)));
    });
    socket.once("end", () =>
      settle(() => reject(new Error("The server closed the connection without an answer"))),
    );
    socket.once("error", (error) =>
      settle(() =>
        reject(
          UNREACHABLE.has(errorCode(error) as string) ? new AdminUnreachable(path, error) : error,
        ),
      ),
    );
  });
}

/**
 * Sends `command` with `args` to the server on the admin socket at `path` and returns its answer.
 * Throws `AdminUnreachable` when no server answers there, and an `Error` when the answer is not
 * a response or the proof file cannot be created (for instance, as another user).
 */
export async function callAdmin(
  path: string,
  command: string,
  args: Record<string, unknown> = {},
  timeoutMs = CLIENT_TIMEOUT_MS,
): Promise<AdminResponse> {
  const proof = `proof-${randomBytes(24).toString("base64url")}`;
  const proofPath = join(dirname(path), proof);
  try {
    writeFileSync(proofPath, "", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (UNREACHABLE.has(errorCode(error) as string)) throw new AdminUnreachable(path, error);
    if (errorCode(error) === "EACCES") {
      throw new Error(`Permission denied on ${dirname(path)}: run pangolin as the server's user`);
    }
    throw error;
  }
  try {
    const line = await exchange(path, JSON.stringify({ command, args, proof }), timeoutMs);
    let response: unknown;
    try {
      response = JSON.parse(line);
    } catch {
      throw new Error("The server's answer is not JSON");
    }
    const ok = (response as { ok?: unknown } | null)?.ok;
    if (ok !== true && ok !== false) throw new Error("The server's answer is not a response");
    return response as AdminResponse;
  } finally {
    rmSync(proofPath, { force: true });
  }
}
