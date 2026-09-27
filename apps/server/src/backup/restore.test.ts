import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileStamp } from "./paths.ts";
import { type FetchedSnapshot, swapIn } from "./restore.ts";

let dir: string;
let dataDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-swap-"));
  dataDir = join(dir, "data");
  mkdirSync(join(dataDir, "attachments"), { recursive: true });
  writeFileSync(join(dataDir, "pangolin.sqlite"), "live database");
  writeFileSync(join(dataDir, "pangolin.sqlite-wal"), "live wal");
  writeFileSync(join(dataDir, "attachments", "receipt"), "live blob");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fetched(attachmentsDir: string | undefined): FetchedSnapshot {
  const restoreDir = join(dataDir, "restore-x");
  const dbDir = join(restoreDir, "data", "backup", "staging", "01SNAP");
  mkdirSync(dbDir, { recursive: true });
  writeFileSync(join(dbDir, "pangolin.sqlite"), "restored database");
  return {
    snapshot: { id: "a".repeat(64), time: "2026-09-27T02:30:00Z", paths: [] },
    dir: restoreDir,
    dbDir,
    attachmentsDir,
  };
}

describe("swapIn", () => {
  it("moves back what it had moved when a rename fails part-way, leaving no pre-restore directory", () => {
    const snapshot = fetched(join(dataDir, "restore-x", "missing-attachments"));
    expect(() => swapIn(dataDir, snapshot, "stamp")).toThrow(/ENOENT/);
    expect(readFileSync(join(dataDir, "pangolin.sqlite"), "utf8")).toBe("live database");
    expect(readFileSync(join(dataDir, "pangolin.sqlite-wal"), "utf8")).toBe("live wal");
    expect(readFileSync(join(dataDir, "attachments", "receipt"), "utf8")).toBe("live blob");
    expect(readFileSync(join(snapshot.dbDir, "pangolin.sqlite"), "utf8")).toBe("restored database");
    expect(readdirSync(dataDir).filter((name) => name.startsWith("pre-restore-"))).toEqual([]);
  });

  it("swaps in the snapshot and keeps the replaced files; never reuses another's directory", () => {
    const swapped = swapIn(dataDir, fetched(undefined), "stamp");
    expect(readFileSync(join(dataDir, "pangolin.sqlite"), "utf8")).toBe("restored database");
    expect(readFileSync(join(swapped.preRestoreDir, "pangolin.sqlite-wal"), "utf8")).toBe(
      "live wal",
    );
    expect(readFileSync(join(swapped.preRestoreDir, "attachments", "receipt"), "utf8")).toBe(
      "live blob",
    );
    // A second swap with the same stamp refuses, and leaves the first one's saved files alone.
    expect(() => swapIn(dataDir, fetched(undefined), "stamp")).toThrow(/EEXIST/);
    expect(readFileSync(join(swapped.preRestoreDir, "pangolin.sqlite"), "utf8")).toBe(
      "live database",
    );
  });
});

describe("fileStamp", () => {
  it("is to the millisecond with a random suffix, so two restores never share one", () => {
    const ms = Date.parse("2026-09-27T03:00:00.123Z");
    expect(fileStamp(ms)).toMatch(/^2026-09-27T03-00-00-123Z-[0-9a-f]{6}$/);
    expect(fileStamp(ms)).not.toBe(fileStamp(ms));
  });
});
