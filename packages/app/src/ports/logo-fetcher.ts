import type { JobSignal } from "../jobs/registry.ts";

/** A favicon that passed every cap: the bytes and the content type they came with. */
export interface FetchedLogo {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/**
 * Fetches one site's favicon (merchant logo story). Implemented in `apps/server` over `fetch`
 * (optionally through an egress proxy), so `app` stays free of runtime APIs and tests inject
 * a fake.
 *
 * The implementation makes exactly ONE request — `GET https://<domain>/favicon.ico` — and does
 * NOT follow redirects; the size cap and the mime allowlist are its guardrails, never the
 * caller's problem.
 */
export interface LogoFetcher {
  /**
   * Resolves to the logo when the site served an acceptable favicon; to `null` when the site
   * simply has none (404) — a complete answer, nothing gets stored. Throws on redirects, other
   * non-OK responses, oversize bodies, disallowed mimes or transport errors, so the job retries.
   */
  fetchFavicon(domain: string, signal?: JobSignal): Promise<FetchedLogo | null>;
}
