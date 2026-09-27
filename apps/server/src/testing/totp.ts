// Test support only: RFC 6238 TOTP codes (SHA-1, 30 s, 6 digits) from an `otpauth://` URI, so
// tests can sign in with TOTP without a second implementation's help.
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The base32 secret in an `otpauth://totp/…?secret=…` URI. */
export function secretOf(otpauthUri: string): string {
  const secret = new URL(otpauthUri).searchParams.get("secret");
  if (secret === null) throw new Error("no secret in the otpauth URI");
  return secret;
}

/** The TOTP code for a base32 secret at `atMs` (default now). */
export function totp(secret: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
