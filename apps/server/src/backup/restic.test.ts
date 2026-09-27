import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type StubRestic, stubRestic } from "../testing/restic.ts";
import { createRestic, type Restic, ResticError, redactRepository } from "./restic.ts";

let dir: string;
let stub: StubRestic;
let restic: Restic;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-restic-"));
  stub = stubRestic(join(dir, "stub"));
  restic = createRestic({
    bin: stub.bin,
    repository: stub.repository,
    passwordFile: stub.passwordFile,
    cacheDir: join(dir, "data", "backup", "cache"),
  });
});

afterEach(() => {
  delete process.env.STUB_RESTIC_FAIL;
  delete process.env.RESTIC_PASSWORD;
  rmSync(dir, { recursive: true, force: true });
});

function stage(name: string, content: string): string {
  const path = join(dir, "data", "backup", "staging", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "pangolin.sqlite"), content);
  return path;
}

describe("createRestic", () => {
  it("initialises a missing repository once, backs up, finds and restores snapshots", async () => {
    await restic.ensureRepository();
    expect(existsSync(join(stub.repoDir, "config"))).toBe(true);
    await restic.ensureRepository();
    // The cache and restic's temporary files live on the data volume, never the /tmp tmpfs.
    expect(existsSync(join(dir, "data", "backup", "cache"))).toBe(true);
    expect(existsSync(join(dir, "data", "backup", "tmp"))).toBe(true);

    const first = await restic.backup([stage("A", "one")]);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    const attachments = join(dir, "data", "attachments");
    mkdirSync(attachments, { recursive: true });
    writeFileSync(join(attachments, "blob"), "x");
    const second = await restic.backup([stage("B", "two"), attachments]);

    expect(await restic.findSnapshot("latest")).toMatchObject({
      id: second,
      paths: [join(dir, "data", "backup", "staging", "B"), attachments],
    });
    expect((await restic.findSnapshot(first.slice(0, 8)))?.id).toBe(first);
    expect(await restic.findSnapshot("0000")).toBeUndefined();
    expect(await restic.findSnapshot("../x")).toBeUndefined();

    const target = join(dir, "restore");
    mkdirSync(target);
    await restic.restore(first, target);
    expect(
      readFileSync(join(target, dir, "data", "backup", "staging", "A", "pangolin.sqlite"), "utf8"),
    ).toBe("one");
  });

  it("finds no latest snapshot in an empty repository", async () => {
    await restic.ensureRepository();
    expect(await restic.findSnapshot("latest")).toBeUndefined();
  });

  it("passes the password only as a file, never one from the environment", async () => {
    process.env.RESTIC_PASSWORD = "leaked";
    await expect(restic.ensureRepository()).resolves.toBeUndefined();
  });

  it("names a missing or empty password file before running restic", async () => {
    const missing = createRestic({
      bin: stub.bin,
      repository: stub.repository,
      passwordFile: join(dir, "nope"),
      cacheDir: join(dir, "cache"),
    });
    await expect(missing.ensureRepository()).rejects.toThrow(
      /restic password file .*nope is missing/,
    );
    const emptyFile = join(dir, "empty");
    writeFileSync(emptyFile, "");
    const empty = createRestic({
      bin: stub.bin,
      repository: stub.repository,
      passwordFile: emptyFile,
      cacheDir: join(dir, "cache"),
    });
    await expect(empty.ensureRepository()).rejects.toThrow(/is empty/);
  });

  it("fails with restic's exit code and the tail of its stderr", async () => {
    await restic.ensureRepository();
    process.env.STUB_RESTIC_FAIL = "backup";
    const error = await restic.backup([stage("A", "x")]).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ResticError);
    expect(error).toMatchObject({
      exitCode: 1,
      message: "restic backup exited with 1: Fatal: backup failed on purpose",
    });
    const absent = createRestic({
      bin: join(dir, "no-such-restic"),
      repository: stub.repository,
      passwordFile: stub.passwordFile,
      cacheDir: join(dir, "cache"),
    });
    await expect(absent.ensureRepository()).rejects.toThrow(/Could not run/);
  });

  it("kills restic when the signal aborts", async () => {
    await restic.ensureRepository();
    const controller = new AbortController();
    const reason = new Error("timed out");
    const running = restic.backup([stage("A", "x")], controller.signal);
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
  });

  it("redacts credentials in a repository URL", () => {
    expect(redactRepository("rest:https://user:secret@nas.lan:8000/pangolin failed")).toBe(
      "rest:https://***@nas.lan:8000/pangolin failed",
    );
    expect(redactRepository("rest:https://nas.lan:8000/pangolin")).toBe(
      "rest:https://nas.lan:8000/pangolin",
    );
  });
});
