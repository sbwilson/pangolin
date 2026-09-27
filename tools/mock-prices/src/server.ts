// A replay server for price-connector tests: `GET /v8/finance/chart/{ticker}` answers with the
// fixture `<fixturesDir>/<ticker>.json`, in Yahoo Finance's chart shape. Query parameters
// (range, interval) are ignored. No real network calls; no workspace imports.
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One recorded response. Give either `json` (serialised as the body) or `body` (sent verbatim,
 * so it may be deliberately broken).
 */
export interface PriceFixture {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly json?: unknown;
  readonly body?: string;
  /** Wait this long before answering; a long delay models a timeout. */
  readonly delayMs?: number;
}

export interface MockPricesOptions {
  /** 0 picks a free port. */
  readonly port: number;
  readonly host?: string;
  readonly fixturesDir?: string;
}

export interface MockServer {
  /** Base URL, e.g. `http://127.0.0.1:4020`; clients append `/v8/finance/chart/<ticker>`. */
  readonly url: string;
  /** Stops listening and destroys every open socket, including requests still being delayed. */
  close(): Promise<void>;
}

export const defaultFixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

const CHART_PATH = /^\/v8\/finance\/chart\/([^/]+)$/;
/** Tickers become file names, so only Yahoo's character set is looked up (`VAS.AX`, `^AXJO`). */
const TICKER_RE = /^[A-Za-z0-9^][A-Za-z0-9.^=-]{0,31}$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json;charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Yahoo's answer for a symbol it does not know. */
function notFound(res: ServerResponse): void {
  sendJson(res, 404, {
    chart: {
      result: null,
      error: { code: "Not Found", description: "No data found, symbol may be delisted" },
    },
  });
}

function isFixture(value: unknown): value is PriceFixture {
  const f = value as Partial<PriceFixture> | null;
  return (
    typeof f === "object" &&
    f !== null &&
    Number.isInteger(f.status) &&
    (f.body === undefined || typeof f.body === "string") &&
    (f.body !== undefined) !== (f.json !== undefined) &&
    (f.headers === undefined ||
      (typeof f.headers === "object" &&
        f.headers !== null &&
        Object.values(f.headers).every((v) => typeof v === "string"))) &&
    (f.delayMs === undefined || (typeof f.delayMs === "number" && f.delayMs >= 0))
  );
}

/** Reads a fixture, or `undefined` when the file does not exist. Throws on a malformed fixture. */
export async function loadFixture(path: string): Promise<PriceFixture | undefined> {
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

export async function startMockPrices(options: MockPricesOptions): Promise<MockServer> {
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
    const match = CHART_PATH.exec(new URL(req.url ?? "/", "http://mock").pathname);
    if (match === null) {
      notFound(res);
      return;
    }
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      sendJson(res, 405, { chart: { result: null, error: { code: "Method Not Allowed" } } });
      return;
    }
    let ticker: string;
    try {
      ticker = decodeURIComponent(match[1] as string);
    } catch {
      notFound(res);
      return;
    }
    const fixture = TICKER_RE.test(ticker)
      ? await loadFixture(join(fixturesDir, `${ticker}.json`))
      : undefined;
    if (fixture === undefined) {
      notFound(res);
      return;
    }
    if (fixture.delayMs !== undefined && fixture.delayMs > 0) {
      if (!(await delay(fixture.delayMs, res))) return;
    }
    const body = fixture.body ?? JSON.stringify(fixture.json);
    res.writeHead(fixture.status, {
      "content-type": "application/json;charset=utf-8",
      ...fixture.headers,
    });
    res.end(body);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, { error: String(error) });
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
