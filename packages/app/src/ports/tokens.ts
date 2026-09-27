/**
 * Secret tokens for one-time links (story 1.5). Implemented in `apps/server` with `node:crypto`,
 * so `app` stays free of runtime-specific APIs and tests can use a predictable fake.
 */
export interface TokenPort {
  /** A new token of 32 random bytes, URL-safe. */
  generate(): string;
  /** The token's SHA-256, hex. Only the hash is ever stored. */
  hash(token: string): string;
}
