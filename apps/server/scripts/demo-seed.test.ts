import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSeedFile } from "./demo-seed.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-demo-seed-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("generateSeedFile", () => {
  it("writes the default seed to the given path, identically each time", () => {
    const a = join(dir, "nested", "demo-seed.json");
    const b = join(dir, "again.json");
    generateSeedFile(a);
    generateSeedFile(b);
    const text = readFileSync(a, "utf8");
    expect(readFileSync(b, "utf8")).toBe(text);
    expect(JSON.parse(text)).toMatchObject({ seed: "pangolin-v1", today: "2026-07-15" });
  });

  it("throws with the CLI's error when it fails", () => {
    expect(() => generateSeedFile(join(dir, "x.json"), ["--today", "nope"])).toThrow(
      /seed CLI failed.*YYYY-MM-DD/,
    );
  });
});
