import { describe, expect, it } from "vitest";
import { fingerprintV1, sha256Hex } from "./fingerprint.ts";

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256Hex("é".repeat(100))).toHaveLength(64);
  });
});

describe("fingerprintV1", () => {
  const line = { accountId: "A", postedOn: "2026-09-01", amountCents: -1250, description: "Cafe" };
  it("is stable and sensitive to every field", () => {
    expect(fingerprintV1(line)).toBe(fingerprintV1({ ...line }));
    for (const change of [
      { accountId: "B" },
      { postedOn: "2026-09-02" },
      { amountCents: -1251 },
      { description: "Cafe 2" },
    ]) {
      expect(fingerprintV1({ ...line, ...change })).not.toBe(fingerprintV1(line));
    }
  });
});
