import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockServer, startMockPrices } from "./server.ts";

let server: MockServer;

beforeEach(async () => {
  server = await startMockPrices({ port: 0 });
});

afterEach(async () => {
  await server.close();
});

const chart = (ticker: string, init?: RequestInit) =>
  fetch(`${server.url}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`, init);

interface Chart {
  chart: {
    result: {
      meta: { symbol: string; currency: string; regularMarketPrice: number };
      timestamp: number[];
      indicators: { quote: { close: number[] }[] };
    }[];
    error: null;
  };
}

describe("mock-prices", () => {
  it.each(["VAS.AX", "VGS.AX"])("answers %s with Yahoo chart JSON", async (ticker) => {
    const res = await chart(ticker);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Chart;
    const [result] = body.chart.result;
    expect(body.chart.error).toBeNull();
    expect(result?.meta).toMatchObject({ symbol: ticker, currency: "AUD" });
    const closes = result?.indicators.quote[0]?.close ?? [];
    expect(result?.timestamp.length).toBeGreaterThanOrEqual(3);
    expect(closes).toHaveLength(result?.timestamp.length ?? -1);
    expect(result?.meta.regularMarketPrice).toBe(closes.at(-1));
    // Timestamps ascend and all fall before the seed's fixed today (2026-07-15).
    expect([...(result?.timestamp ?? [])].sort((a, b) => a - b)).toEqual(result?.timestamp);
    expect(Math.max(...(result?.timestamp ?? []))).toBeLessThan(Date.UTC(2026, 6, 15) / 1000);
  });

  it("serves the same bytes every time", async () => {
    const a = await (await chart("VAS.AX")).text();
    const b = await (await chart("VAS.AX")).text();
    expect(a).toBe(b);
  });

  it("answers MOCK-MALFORMED.AX with 200 and a body that is not JSON", async () => {
    const res = await chart("MOCK-MALFORMED.AX");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(() => JSON.parse(text)).toThrow(SyntaxError);
  });

  it("answers MOCK-429.AX with 429", async () => {
    const res = await chart("MOCK-429.AX");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.text()).toContain("Too Many Requests");
  });

  it("holds MOCK-TIMEOUT.AX open until the client aborts", async () => {
    const started = Date.now();
    await expect(chart("MOCK-TIMEOUT.AX", { signal: AbortSignal.timeout(200) })).rejects.toThrow(
      /aborted|timeout/i,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("close() resolves promptly while MOCK-TIMEOUT.AX is held open", async () => {
    const pending = chart("MOCK-TIMEOUT.AX").catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await server.close();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await pending).toBeInstanceOf(Error);
    server = await startMockPrices({ port: 0 });
  });

  it.each(["NOPE.AX", "../VAS.AX", "a/b"])(
    "answers %s with 404 in Yahoo's shape",
    async (ticker) => {
      const res = await chart(ticker);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        chart: {
          result: null,
          error: { code: "Not Found", description: "No data found, symbol may be delisted" },
        },
      });
    },
  );

  it("answers other paths with 404 and other methods with 405", async () => {
    expect((await fetch(`${server.url}/v7/finance/quote`)).status).toBe(404);
    expect((await chart("VAS.AX", { method: "POST" })).status).toBe(405);
  });

  it("replays fixtures from a custom directory and rejects a malformed one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pangolin-mock-prices-"));
    try {
      writeFileSync(join(dir, "X.AX.json"), JSON.stringify({ status: 200, json: { ok: 1 } }));
      writeFileSync(join(dir, "BAD.AX.json"), JSON.stringify({ status: 200 }));
      const custom = await startMockPrices({ port: 0, fixturesDir: dir });
      try {
        expect(await (await fetch(`${custom.url}/v8/finance/chart/X.AX`)).json()).toEqual({
          ok: 1,
        });
        expect((await fetch(`${custom.url}/v8/finance/chart/BAD.AX`)).status).toBe(500);
        expect((await fetch(`${custom.url}/v8/finance/chart/VAS.AX`)).status).toBe(404);
      } finally {
        await custom.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mock-prices CLI", () => {
  async function runCli(args: string[], check: (url: string) => Promise<void>) {
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const child = spawn(process.execPath, [cli, "--port", "0", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
          const match = /listening on (http:\/\/\S+)/.exec(out);
          if (match?.[1]) resolve(match[1]);
        });
        child.once("exit", (code) => reject(new Error(`exited ${code}`)));
      });
      await check(url);
    } finally {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      expect(await exited).toBe(0);
    }
  }

  it("prints its URL and serves until SIGTERM", async () => {
    await runCli([], async (url) => {
      expect((await fetch(`${url}/v8/finance/chart/VGS.AX`)).status).toBe(200);
    });
  });

  it("serves fixtures from --fixtures <dir>", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pangolin-mock-prices-cli-"));
    try {
      writeFileSync(join(dir, "CLI.AX.json"), JSON.stringify({ status: 200, json: { cli: true } }));
      await runCli(["--fixtures", dir], async (url) => {
        expect(await (await fetch(`${url}/v8/finance/chart/CLI.AX`)).json()).toEqual({
          cli: true,
        });
        // The bundled fixtures are not consulted.
        expect((await fetch(`${url}/v8/finance/chart/VAS.AX`)).status).toBe(404);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
