import { describe, expect, it } from "vitest";
import { decryptApiKey, deriveKey, encryptApiKey, extractApiKeyLast4 } from "./crypto.ts";

describe("LLM API key encryption", () => {
  const authSecret = "super-secret-household-key-12345";
  const apiKey = "sk-proj-abc1234567Q2a";

  it("derives a 32-byte key from authSecret", () => {
    const key = deriveKey(authSecret);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
    // Deterministic for same secret
    expect(deriveKey(authSecret)).toEqual(key);
    // Different for different secret
    expect(deriveKey("different-secret")).not.toEqual(key);
  });

  it("extracts the last 4 characters correctly", () => {
    expect(extractApiKeyLast4(apiKey)).toBe("7Q2a");
    expect(extractApiKeyLast4("sk-ant-api03-xyz999")).toBe("z999");
    expect(extractApiKeyLast4("1234")).toBe("1234");
    expect(extractApiKeyLast4("abc")).toBe("abc");
    expect(extractApiKeyLast4("")).toBe("");
  });

  it("encrypts and decrypts an API key cleanly", () => {
    const encrypted = encryptApiKey(apiKey, authSecret);
    expect(encrypted).not.toContain(apiKey);
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);

    const decrypted = decryptApiKey(encrypted, authSecret);
    expect(decrypted).toBe(apiKey);
  });

  it("uses a fresh random IV on each encryption", () => {
    const enc1 = encryptApiKey(apiKey, authSecret);
    const enc2 = encryptApiKey(apiKey, authSecret);

    expect(enc1).not.toBe(enc2);
    expect(enc1.split(":")[0]).not.toBe(enc2.split(":")[0]); // different IVs
    expect(decryptApiKey(enc1, authSecret)).toBe(apiKey);
    expect(decryptApiKey(enc2, authSecret)).toBe(apiKey);
  });

  it("throws when decrypting with wrong authSecret", () => {
    const encrypted = encryptApiKey(apiKey, authSecret);
    expect(() => decryptApiKey(encrypted, "wrong-secret")).toThrow(/tag mismatch|corrupted/);
  });

  it("throws when ciphertext is tampered with", () => {
    const encrypted = encryptApiKey(apiKey, authSecret);
    const parts = encrypted.split(":");
    // Flip a byte in ciphertext
    const cipherHex = parts[2] ?? "";
    const tamperedCipher =
      cipherHex.slice(0, 2) === "aa" ? `bb${cipherHex.slice(2)}` : `aa${cipherHex.slice(2)}`;
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

    expect(() => decryptApiKey(tampered, authSecret)).toThrow(/tag mismatch|corrupted/);
  });

  it("throws when auth tag is tampered with", () => {
    const encrypted = encryptApiKey(apiKey, authSecret);
    const parts = encrypted.split(":");
    // Flip a byte in tag
    const tagHex = parts[1] ?? "";
    const tamperedTag =
      tagHex.slice(0, 2) === "00" ? `11${tagHex.slice(2)}` : `00${tagHex.slice(2)}`;
    const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

    expect(() => decryptApiKey(tampered, authSecret)).toThrow(/tag mismatch|corrupted/);
  });

  it("throws on malformed ciphertext strings", () => {
    expect(() => decryptApiKey("invalid-string", authSecret)).toThrow(
      /Invalid encrypted API key format/,
    );
    expect(() => decryptApiKey("part1:part2", authSecret)).toThrow(
      /Invalid encrypted API key format/,
    );
    expect(() => decryptApiKey("1234:5678:9abc", authSecret)).toThrow(/Invalid IV length/);
  });

  it("requires authSecret for encryption and decryption", () => {
    expect(() => encryptApiKey(apiKey, "")).toThrow(/authSecret must be provided/);
    expect(() => decryptApiKey("iv:tag:cipher", "")).toThrow(/authSecret must be provided/);
  });
});
