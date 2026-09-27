import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-seed-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seed CLI", () => {
  it("writes byte-identical seed.json on two runs", () => {
    const a = main(["--out", join(dir, "a")]);
    const b = main(["--out", join(dir, "b")]);
    expect(a).toBe(join(dir, "a", "seed.json"));
    const text = readFileSync(a, "utf8");
    expect(readFileSync(b, "utf8")).toBe(text);
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ seed: "pangolin-v1", today: "2026-07-15" });
  });

  it("takes --seed and --today", () => {
    const file = main(["--out", dir, "--seed", "other", "--today", "2026-01-02"]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({
      seed: "other",
      today: "2026-01-02",
    });
  });

  it("requires --out and rejects unknown options", () => {
    expect(() => main([])).toThrow("--out is required");
    expect(() => main(["--out", dir, "--bogus"])).toThrow();
  });

  it("runs as a script", () => {
    const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const run = spawnSync(process.execPath, [cli, "--out", dir], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("seed.json");
    const failed = spawnSync(process.execPath, [cli], { encoding: "utf8" });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("--out is required");
  });
});
