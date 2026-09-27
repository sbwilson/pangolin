import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MockServer, startMockLlm } from "./server.ts";

let server: MockServer;

beforeEach(async () => {
  server = await startMockLlm({ port: 0 });
});

afterEach(async () => {
  await server.close();
});

const PATHS = { openai: "/v1/chat/completions", anthropic: "/v1/messages" } as const;
type Provider = keyof typeof PATHS;

function call(provider: Provider, model: string, init: RequestInit = {}) {
  const body =
    provider === "openai"
      ? { model, messages: [{ role: "user", content: "categorise" }] }
      : { model, max_tokens: 256, messages: [{ role: "user", content: "categorise" }] };
  return fetch(`${server.url}${PATHS[provider]}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

// biome-ignore lint/suspicious/noExplicitAny: the tests read provider JSON loosely.
type Loose = any;

async function readJson(res: Response): Promise<Loose> {
  return res.json();
}

/** The assistant's text, where each provider puts it. */
function content(provider: Provider, json: Loose): string {
  if (provider === "openai") {
    const choices = json.choices as { message: { content: string } }[];
    return choices[0]?.message.content ?? "";
  }
  const blocks = json.content as { type: string; text?: string }[];
  return blocks.find((b) => b.type === "text")?.text ?? "";
}

describe("mock-llm", () => {
  it("answers OpenAI mock-ok with a chat completion whose content is JSON", async () => {
    const res = await call("openai", "mock-ok");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const json = await readJson(res);
    expect(json).toMatchObject({ object: "chat.completion", model: "mock-ok" });
    expect(json.choices[0]).toMatchObject({
      finish_reason: "stop",
      message: { role: "assistant" },
    });
    expect(JSON.parse(content("openai", json))).toHaveProperty("suggestions");
  });

  it("answers Anthropic mock-ok with a message carrying a forced tool call", async () => {
    const res = await call("anthropic", "mock-ok");
    expect(res.status).toBe(200);
    const json = await readJson(res);
    expect(json).toMatchObject({ type: "message", role: "assistant", stop_reason: "tool_use" });
    expect(json.content[0]).toMatchObject({ type: "tool_use", name: "categorise" });
    expect(json.content[0].input).toHaveProperty("suggestions");
  });

  it.each(["openai", "anthropic"] as const)(
    "answers %s mock-malformed-json with 200 and content that is not JSON",
    async (provider) => {
      const res = await call(provider, "mock-malformed-json");
      expect(res.status).toBe(200);
      const text = content(provider, await readJson(res));
      expect(text.length).toBeGreaterThan(0);
      expect(() => JSON.parse(text)).toThrow(SyntaxError);
    },
  );

  it.each([
    ["openai", "rate_limit_exceeded"],
    ["anthropic", "rate_limit_error"],
  ] as const)("answers %s mock-rate-limit with 429 and retry-after", async (provider, marker) => {
    const res = await call(provider, "mock-rate-limit");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.text()).toContain(marker);
  });

  it("answers OpenAI mock-refusal with message.refusal", async () => {
    const json = await readJson(await call("openai", "mock-refusal"));
    expect(json.choices[0].message).toMatchObject({ content: null });
    expect(json.choices[0].message.refusal).toEqual(expect.any(String));
  });

  it("answers Anthropic mock-refusal with stop_reason refusal", async () => {
    const json = await readJson(await call("anthropic", "mock-refusal"));
    expect(json).toMatchObject({ type: "message", stop_reason: "refusal" });
  });

  it.each(["openai", "anthropic"] as const)(
    "holds %s mock-timeout open until the client aborts, and close() stays prompt",
    async (provider) => {
      const started = Date.now();
      await expect(
        call(provider, "mock-timeout", { signal: AbortSignal.timeout(200) }),
      ).rejects.toThrow(/aborted|timeout/i);
      expect(Date.now() - started).toBeLessThan(2000);
    },
  );

  it("close() resolves promptly while a timeout request is still held open", async () => {
    const controller = new AbortController();
    const pending = call("openai", "mock-timeout", { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await server.close();
    expect(Date.now() - started).toBeLessThan(1000);
    // The socket was destroyed, so the client fails rather than hanging.
    expect(await pending).toBeInstanceOf(Error);
    controller.abort();
    server = await startMockLlm({ port: 0 });
  });

  it("answers an unknown model with 404 in each provider's error format", async () => {
    const openai = await call("openai", "gpt-nope");
    expect(openai.status).toBe(404);
    expect(await openai.json()).toEqual({
      error: {
        message: "The model `gpt-nope` does not exist or you do not have access to it.",
        type: "invalid_request_error",
        param: "model",
        code: "model_not_found",
      },
    });
    const anthropic = await call("anthropic", "claude-nope");
    expect(anthropic.status).toBe(404);
    expect(await anthropic.json()).toEqual({
      type: "error",
      error: { type: "not_found_error", message: "model: claude-nope" },
    });
  });

  it("never reads outside the fixtures directory", async () => {
    const res = await call("openai", "../anthropic/mock-ok");
    expect(res.status).toBe(404);
  });

  it("rejects a bad body, a missing model, a GET and an unknown path", async () => {
    const bad = await fetch(`${server.url}/v1/messages`, { method: "POST", body: "{" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ type: "error" });
    const noModel = await fetch(`${server.url}/v1/chat/completions`, {
      method: "POST",
      body: "{}",
    });
    expect(noModel.status).toBe(400);
    expect((await fetch(`${server.url}/v1/messages`)).status).toBe(405);
    expect((await fetch(`${server.url}/v2/other`, { method: "POST" })).status).toBe(404);
  });

  it("replays fixtures from a custom directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pangolin-mock-llm-"));
    try {
      mkdirSync(join(dir, "openai"));
      writeFileSync(
        join(dir, "openai", "custom.json"),
        JSON.stringify({ status: 418, headers: { "x-custom": "1" }, body: "teapot" }),
      );
      writeFileSync(join(dir, "openai", "broken.json"), JSON.stringify({ status: "no" }));
      const custom = await startMockLlm({ port: 0, fixturesDir: dir });
      try {
        const res = await fetch(`${custom.url}/v1/chat/completions`, {
          method: "POST",
          body: JSON.stringify({ model: "custom" }),
        });
        expect([res.status, res.headers.get("x-custom"), await res.text()]).toEqual([
          418,
          "1",
          "teapot",
        ]);
        const broken = await fetch(`${custom.url}/v1/chat/completions`, {
          method: "POST",
          body: JSON.stringify({ model: "broken" }),
        });
        expect(broken.status).toBe(500);
      } finally {
        await custom.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mock-llm CLI", () => {
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
      const res = await fetch(`${url}/v1/messages`, {
        method: "POST",
        body: JSON.stringify({ model: "mock-ok" }),
      });
      expect(res.status).toBe(200);
    });
  });

  it("serves fixtures from --fixtures <dir>", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pangolin-mock-llm-cli-"));
    try {
      mkdirSync(join(dir, "anthropic"));
      writeFileSync(
        join(dir, "anthropic", "cli-custom.json"),
        JSON.stringify({ status: 201, headers: {}, body: "from the custom dir" }),
      );
      await runCli(["--fixtures", dir], async (url) => {
        const post = (model: string) =>
          fetch(`${url}/v1/messages`, { method: "POST", body: JSON.stringify({ model }) });
        const res = await post("cli-custom");
        expect([res.status, await res.text()]).toEqual([201, "from the custom dir"]);
        // The bundled fixtures are not consulted.
        expect((await post("mock-ok")).status).toBe(404);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
