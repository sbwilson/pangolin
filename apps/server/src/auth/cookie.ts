// The names and attributes of the session cookie, in one place for better-auth's configuration
// (`auth.ts`) and for the routes that end a session themselves (`http/app.ts`).

/** `__Host-pangolin` when the public URL is https (browsers accept `Secure` from `http://localhost`), else `pangolin`. */
export function cookiePrefix(publicUrl: string): string {
  return new URL(publicUrl).protocol === "https:" ? "__Host-pangolin" : "pangolin";
}

/** The attributes every session cookie carries. */
export const COOKIE_ATTRIBUTES = "Path=/; HttpOnly; Secure; SameSite=Strict";

/**
 * `Set-Cookie` values that delete the session cookies better-auth sets (`<prefix>.session_token`
 * and the cache cookie `<prefix>.session_data`), with the same attributes they were set with.
 */
export function clearedSessionCookies(publicUrl: string): string[] {
  const prefix = cookiePrefix(publicUrl);
  return ["session_token", "session_data"].map(
    (name) => `${prefix}.${name}=; Max-Age=0; ${COOKIE_ATTRIBUTES}`,
  );
}
