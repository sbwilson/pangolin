// A replay server for LLM contract tests: OpenAI-compatible `POST /v1/chat/completions` and
// Anthropic-compatible `POST /v1/messages`. The request's `model` picks the fixture
// `<fixturesDir>/<provider>/<model>.json`, whose status, headers and raw body are sent back
// after an optional delay. No real network calls; no workspace imports.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Provider = "openai" | "anthropic";

/** One recorded response. `body` is sent verbatim, so it may be deliberately broken. */
export interface Fixture {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Wait this long before answering; a long delay models a timeout. */
  readonly delayMs?: number;
}

export interface MockLlmOptions {
  /** 0 picks a free port. */
  readonly port: number;
  readonly host?: string;
  readonly fixturesDir?: string;
}

export interface MockServer {
  /** Base URL, e.g. `http://127.0.0.1:4010`; clients append `/v1/...`. */
  readonly url: string;
  /** Stops listening and destroys every open socket, including requests still being delayed. */
  close(): Promise<void>;
}

export const defaultFixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

const ROUTES: Readonly<Record<string, Provider>> = {
  "/v1/chat/completions": "openai",
  "/v1/messages": "anthropic",
};

/** Model names become file names, so only a safe character set is looked up. */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_BODY = 1024 * 1024;

function providerError(provider: Provider, status: number, kind: string, message: string) {
  if (provider === "openai") {
    const code = status === 404 ? "model_not_found" : null;
    return { error: { message, type: kind, param: status === 404 ? "model" : null, code } };
  }
  return { type: "error", error: { type: kind, message } };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, provider: Provider, status: number, message: string) {
  const kind =
    provider === "openai"
      ? "invalid_request_error"
      : status === 404
        ? "not_found_error"
        : "invalid_request_error";
  sendJson(res, status, providerError(provider, status, kind, message));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isFixture(value: unknown): value is Fixture {
  const f = value as Partial<Fixture> | null;
  return (
    typeof f === "object" &&
    f !== null &&
    Number.isInteger(f.status) &&
    typeof f.body === "string" &&
    typeof f.headers === "object" &&
    f.headers !== null &&
    Object.values(f.headers).every((v) => typeof v === "string") &&
    (f.delayMs === undefined || (typeof f.delayMs === "number" && f.delayMs >= 0))
  );
}

/** Reads a fixture, or `undefined` when the file does not exist. Throws on a malformed fixture. */
export async function loadFixture(path: string): Promise<Fixture | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isFixture(parsed)) throw new Error(`Malformed fixture ${path}`);
  return parsed;
}

export async function startMockLlm(options: MockLlmOptions): Promise<MockServer> {
  const fixturesDir = options.fixturesDir ?? defaultFixturesDir;
  const sockets = new Set<Socket>();
  const timers = new Set<NodeJS.Timeout>();

  const delay = (ms: number, res: ServerResponse) =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve(true);
      }, ms);
      timers.add(timer);
      // A client that gives up (e.g. an abort after its timeout) ends the wait early.
      res.once("close", () => {
        clearTimeout(timer);
        timers.delete(timer);
        resolve(false);
      });
    });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://mock").pathname;
    const provider = ROUTES[path];
    if (provider === undefined) {
      sendJson(res, 404, { error: { message: `No route for ${path}` } });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      sendError(res, provider, 405, `${req.method} is not allowed; use POST`);
      return;
    }

    let model: unknown;
    try {
      model = (JSON.parse(await readBody(req)) as { model?: unknown } | null)?.model;
    } catch {
      sendError(res, provider, 400, "The request body is not valid JSON");
      return;
    }
    if (typeof model !== "string" || model === "") {
      sendError(res, provider, 400, "model: field required");
      return;
    }

    const fixture = MODEL_RE.test(model)
      ? await loadFixture(join(fixturesDir, provider, `${model}.json`))
      : undefined;
    if (fixture === undefined) {
      const message =
        provider === "openai"
          ? `The model \`${model}\` does not exist or you do not have access to it.`
          : `model: ${model}`;
      sendError(res, provider, 404, message);
      return;
    }

    if (fixture.delayMs !== undefined && fixture.delayMs > 0) {
      if (!(await delay(fixture.delayMs, res))) return;
    }
    res.writeHead(fixture.status, fixture.headers);
    res.end(fixture.body);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { error: { message: String(error) } });
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      }),
  };
}
