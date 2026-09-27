// RFC 6238 TOTP (SHA-1, 30-second steps, 6 digits) with node:crypto, so the tests compute the
// codes an authenticator app would show.
import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for a base32 secret at `atMs` (default now). */
export function totp(secret: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}
