// Test support only: a predictable `TokenPort`. Tokens are `token-1`, `token-2`, …; the "hash" is
// the token with a prefix, so tests can see which token a stored hash belongs to. Random bytes come
// from a fixed-seed generator, so generated recovery codes are the same on every run.
import type { CodeHasher, TokenPort } from "../ports/tokens.ts";

export function fakeTokens(): TokenPort & { readonly issued: string[] } {
  const issued: string[] = [];
  let state = 0x2545f491;
  return {
    issued,
    generate: () => {
      const token = `token-${issued.length + 1}`;
      issued.push(token);
      return token;
    },
    hash: (token) => `hash:${token}`,
    randomBytes: (length) =>
      Uint8Array.from({ length }, () => {
        // xorshift32
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state & 0xff;
      }),
  };
}

/** A predictable `CodeHasher`: the "keyed hash" is the code with a prefix. */
export function fakeCodeHasher(): CodeHasher {
  return { hash: (code) => `hmac:${code}` };
}
