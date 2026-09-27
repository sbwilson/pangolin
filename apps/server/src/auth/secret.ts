// Secrets for sign-in (story 1.5): the auth secret file, and the token port setup links use.
// Neither the secret nor a token is ever logged or stored in the database.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TokenPort } from "@pangolin/app";

/** better-auth signs cookies and encrypts TOTP secrets with this; it needs 32+ characters. */
const MIN_SECRET_LENGTH = 32;

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "ENOENT";
}

/**
 * Reads the auth secret from `path`, creating it (32 random bytes, base64url, mode 0600) on
 * first boot. Throws when the file exists but holds fewer than 32 characters, without echoing
 * what it holds.
 */
export function loadOrCreateAuthSecret(path: string): string {
  try {
    const secret = readFileSync(path, "utf8").trim();
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(`The auth secret in ${path} is shorter than ${MIN_SECRET_LENGTH} characters`);
    }
    return secret;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  mkdirSync(dirname(path), { recursive: true });
  // `wx`: never overwrite a secret another process created in the meantime.
  writeFileSync(path, `${secret}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return secret;
}

/** Tokens of 32 random bytes (base64url), hashed with SHA-256 (hex). */
export const nodeTokens: TokenPort = {
  generate: () => randomBytes(32).toString("base64url"),
  hash: (token) => createHash("sha256").update(token, "utf8").digest("hex"),
};
