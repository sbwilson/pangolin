// better-auth's browser client (story 1.5): email and password, TOTP and passkeys, all under
// /api/auth on this origin.
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [twoFactorClient(), passkeyClient()],
});

/** better-auth's `{ error }` as one line for the page. */
export function authMessage(error: { message?: string | undefined } | null | undefined): string {
  return error?.message ?? "Something went wrong. Try again.";
}

/** The base32 secret in an `otpauth://` URI, for typing into an authenticator by hand. */
export function totpSecret(otpauthUri: string): string {
  return new URL(otpauthUri).searchParams.get("secret") ?? "";
}
