/**
 * Domain helpers shared by the engine, the review flow and the logo fetcher.
 *
 * A website domain is stored NORMALISED: lowercase host only — no scheme, no
 * `www.`, no path/query/fragment, no port, no userinfo, no trailing dot.
 * Hosts that can never resolve to a public site (IP literals, single labels,
 * `localhost`, `.local`/`.internal`, reserved TLDs) are rejected: null is
 * returned and nothing gets stored.
 *
 * The same helper runs at three moments: when a suggestion is recorded, when
 * a confirmed suggestion links the domain onto the payee, and as a
 * belt-and-braces check inside the logo fetch job.
 */

/** Strip `http(s)://` / bare-scheme prefixes (case-insensitive). */
function stripScheme(raw: string): string {
  return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
}

/** Cut at the first /, ? or # — the host is everything before them. */
function hostPart(raw: string): string {
  const end = raw.search(/[/?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

/** Cut userinfo (`user:pass@`). */
function stripUserinfo(raw: string): string {
  const at = raw.lastIndexOf("@");
  return at === -1 ? raw : raw.slice(at + 1);
}

/** IPv4 literal (with optional port) or bracketed IPv6. */
function isIpLiteral(host: string): boolean {
  if (host.startsWith("[")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) {
    return host
      .split(":")[0]!
      .split(".")
      .every((octet) => Number(octet) <= 255);
  }
  return false;
}

const RESERVED_SUFFIXES = [".local", ".internal"];
const RESERVED_TLDS = new Set([
  "localhost",
  "test",
  "example",
  "invalid",
  "local",
  "internal",
  "onion",
  "corp",
  "home",
  "host",
  "lan",
]);

/** True for hosts that must never be stored or fetched. */
function isPrivateHost(host: string): boolean {
  if (!host.includes(".")) return true; // single label
  if (RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const tld = host.slice(host.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.has(tld)) return true;
  // A real TLD is never all digits — this also catches anything IP-shaped
  // that is not a valid literal (e.g. 999.1.1.1).
  return /^\d+$/.test(tld);
}

/**
 * Normalise anything domain-shaped to a bare host, or null when the input is
 * not a usable public domain.
 */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (input == null) return null;
  let host = stripScheme(input.trim().toLowerCase());
  host = stripUserinfo(hostPart(host));
  if (host.endsWith(".")) host = host.slice(0, -1);
  const port = host.indexOf(":");
  if (port !== -1) host = host.slice(0, port);
  if (host.startsWith("www.")) host = host.slice(4);
  if (host === "" || isIpLiteral(host) || isPrivateHost(host)) return null;
  // Every label must be DNS-shaped.
  if (!host.split(".").every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label))) {
    return null;
  }
  return host;
}

/**
 * The same-host URL that serves a payee's stored logo. The web client builds
 * this itself from the payee id; it lives here so the route and the client
 * contract keep one source of truth.
 */
export function payeeLogoUrl(payeeId: string): string {
  return `/api/payees/${encodeURIComponent(payeeId)}/logo`;
}
