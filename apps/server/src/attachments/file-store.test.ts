import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileAttachmentStore } from "./file-store.ts";

const SECRET = "a-test-auth-secret-of-at-least-32-characters";
const STATEMENT = "Date,Amount,Description\n01/09/2026,-50.00,SECRET SUPERMARKET\n";
const bytes = (text: string) => new TextEncoder().encode(text);

let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "pangolin-attachments-")), "attachments");
});
afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("encrypted attachment store", () => {
  it("round-trips content, and the file on disk holds no plaintext", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const name = store.put(bytes(STATEMENT));
    expect(new TextDecoder().decode(store.get(name))).toBe(STATEMENT);
    expect(readdirSync(dir)).toEqual([name]);
    const raw = readFileSync(join(dir, name));
    expect(raw.includes(Buffer.from("SECRET SUPERMARKET"))).toBe(false);
    expect(raw.includes(Buffer.from("Date,Amount"))).toBe(false);
    expect(raw.length).toBe(12 + 16 + bytes(STATEMENT).length);
  });

  it("stores equal content once, under a name that is not the plain hash", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const first = store.put(bytes(STATEMENT));
    const second = store.put(bytes(STATEMENT));
    expect(second).toBe(first);
    expect(readdirSync(dir)).toHaveLength(1);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(createFileAttachmentStore(dir, `${SECRET}-other`).put(bytes(STATEMENT))).not.toBe(first);
  });

  it("uses a fresh IV for each stored file", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const a = store.put(bytes("one"));
    const b = store.put(bytes("two"));
    const iv = (name: string) => readFileSync(join(dir, name)).subarray(0, 12).toString("hex");
    expect(iv(a)).not.toBe(iv(b));
  });

  it("fails to decrypt when any ciphertext, tag or IV byte is altered", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const name = store.put(bytes(STATEMENT));
    const original = readFileSync(join(dir, name));
    for (const offset of [0, 12, 28, original.length - 1]) {
      const altered = Buffer.from(original);
      altered[offset] = (altered[offset] ?? 0) ^ 0x01;
      writeFileSync(join(dir, name), altered);
      expect(() => store.get(name)).toThrow(/authentication/);
    }
    writeFileSync(join(dir, name), original.subarray(0, 20));
    expect(() => store.get(name)).toThrow();
  });

  it("fails when a file is moved to another name or opened with another secret", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const name = store.put(bytes(STATEMENT));
    const other = store.put(bytes("other"));
    renameSync(join(dir, name), join(dir, "swap"));
    renameSync(join(dir, other), join(dir, name));
    renameSync(join(dir, "swap"), join(dir, other));
    expect(() => store.get(name)).toThrow(/authentication/);
    const fresh = createFileAttachmentStore(dir, `${SECRET}-rotated`);
    expect(() => fresh.get(other)).toThrow(/authentication/);
  });

  it("removes a file, tolerates a missing one, and refuses names that are not hashes", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const name = store.put(bytes(STATEMENT));
    store.remove(name);
    store.remove(name);
    expect(readdirSync(dir)).toEqual([]);
    expect(() => store.get(name)).toThrow();
    for (const bad of ["../auth-secret", "abc", `${name}/x`, ""]) {
      expect(() => store.get(bad)).toThrow(/Not an attachment name/);
      expect(() => store.remove(bad)).toThrow(/Not an attachment name/);
    }
  });

  it("rewrites an existing file that is damaged or sealed under another key", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const name = store.put(bytes(STATEMENT));
    writeFileSync(join(dir, name), Buffer.from("garbage that is long enough to be parsed....."));
    expect(store.put(bytes(STATEMENT))).toBe(name);
    expect(new TextDecoder().decode(store.get(name))).toBe(STATEMENT);
    const rotated = createFileAttachmentStore(dir, `${SECRET}-rotated`);
    const again = rotated.put(bytes(STATEMENT));
    expect(new TextDecoder().decode(rotated.get(again))).toBe(STATEMENT);
  });

  it("leaves no partial file when the write cannot finish", () => {
    const store = createFileAttachmentStore(dir, SECRET);
    const name = store.put(bytes(STATEMENT));
    rmSync(join(dir, name));
    mkdirSync(join(dir, name)); // the rename onto a directory fails
    expect(() => store.put(bytes(STATEMENT))).toThrow();
    expect(readdirSync(dir)).toEqual([name]);
  });
});
