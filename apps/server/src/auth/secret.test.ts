import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOrCreateAuthSecret, nodeTokens } from "./secret.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-secret-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadOrCreateAuthSecret", () => {
  it("creates a 32-byte secret with mode 0600 on first boot, then reads it back", () => {
    const path = join(dir, "nested", "auth-secret");
    const secret = loadOrCreateAuthSecret(path);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe(`${secret}\n`);
    expect(loadOrCreateAuthSecret(path)).toBe(secret);
  });

  it("uses a secret the operator provides", () => {
    const path = join(dir, "auth-secret");
    writeFileSync(path, `  ${"s".repeat(40)}  \n`);
    expect(loadOrCreateAuthSecret(path)).toBe("s".repeat(40));
  });

  it("refuses a short secret without echoing it", () => {
    const path = join(dir, "auth-secret");
    writeFileSync(path, "hunter2");
    expect(() => loadOrCreateAuthSecret(path)).toThrow(/shorter than 32/);
    try {
      loadOrCreateAuthSecret(path);
    } catch (error) {
      expect(String(error)).not.toContain("hunter2");
    }
  });
});

describe("nodeTokens", () => {
  it("makes distinct 32-byte URL-safe tokens and hashes them with SHA-256", () => {
    const a = nodeTokens.generate();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(nodeTokens.generate()).not.toBe(a);
    expect(nodeTokens.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
