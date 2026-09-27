/**
 * Secret tokens for one-time links (story 1.5). Implemented in `apps/server` with `node:crypto`,
 * so `app` stays free of runtime-specific APIs and tests can use a predictable fake.
 */
export interface TokenPort {
  /** A new token of 32 random bytes, URL-safe. */
  generate(): string;
  /** The token's SHA-256, hex. Only the hash is ever stored. */
  hash(token: string): string;
  /** `length` cryptographically random bytes (recovery codes are built from these). */
  randomBytes(length: number): Uint8Array;
}

/**
 * Keyed hashing for recovery codes (story 1.6): HMAC-SHA256 under a key derived from the auth
 * secret, which never enters the database, so a stolen database file cannot be used to crack
 * the short codes offline. Implemented in `apps/server`.
 */
export interface CodeHasher {
  /** The code's keyed hash, hex. */
  hash(code: string): string;
}
