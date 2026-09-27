// Test support only: a predictable `TokenPort`. Tokens are `token-1`, `token-2`, …; the "hash" is
// the token with a prefix, so tests can see which token a stored hash belongs to.
import type { TokenPort } from "../ports/tokens.ts";

export function fakeTokens(): TokenPort & { readonly issued: string[] } {
  const issued: string[] = [];
  return {
    issued,
    generate: () => {
      const token = `token-${issued.length + 1}`;
      issued.push(token);
      return token;
    },
    hash: (token) => `hash:${token}`,
  };
}
