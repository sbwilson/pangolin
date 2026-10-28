// The `logo-fetch` job handler (merchant-domain story): fetches ONE payee's favicon over the
// net lane and records it. The guards and the write live in `@pangolin/app` (`system/logos.ts`);
// this file is the I/O: a single GET, no redirect following, a 256 KiB cap, a mime allowlist,
// a DNS-answer check that refuses internal addresses, and an optional egress proxy. `restore`
// cancels it like every external-effect job.
import { promises as dns } from "node:dns";
import {
  type AttachmentStore,
  type FetchedLogo,
  type JobRegistration,
  jobHandler,
  LOGO_FETCH_JOB,
  LOGO_MIMES,
  type LogoFetcher,
  MAX_LOGO_BYTES,
  normaliseDomain,
  payeeNeedsLogoFetch,
  recordPayeeLogo,
} from "@pangolin/app";
import { isLanAddress } from "@pangolin/llm";
// When a proxy is configured the request must be issued through the SAME undici copy that owns
// the `ProxyAgent` — Node's bundled-fetch with a foreign dispatcher is a version skew waiting to
// happen (AD-8 egress control), so `undici`'s own `fetch` serves the proxied path.
import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * True for every address the fetcher may never contact: loopback (127/8, ::1), RFC 1918
 * (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), unique-local (fc00::/7)
 * and unspecified/metadata addresses. Checked against every DNS answer BEFORE the request;
 * nftables stays the belt-and-braces for the resolve→connect window (AD-8).
 */
export function isBlockedAddress(address: string): boolean {
  return isLanAddress(address);
}

export interface LogoJobDeps {
  /** `PANGOLIN_LOGOS_ENABLED`; the handler still runs queued jobs, it just does nothing. */
  readonly logosEnabled?: boolean;
  /** The encrypted attachment store; required to actually store a logo. */
  readonly attachments?: AttachmentStore;
  /** Replaces the whole fetcher, for tests. */
  readonly logoFetcher?: LogoFetcher;
  /** `PANGOLIN_EGRESS_PROXY_URL`: route favicon fetches through this proxy. */
  readonly egressProxyUrl?: string | null;
}

export function logoJobs(deps: LogoJobDeps = {}): JobRegistration[] {
  const enabled = deps.logosEnabled ?? true;
  const fetcher = deps.logoFetcher ?? createLogoFetcher({ proxyUrl: deps.egressProxyUrl ?? null });

  const handler = jobHandler(LOGO_FETCH_JOB, async (ctx, { payeeId }) => {
    // Turned off after this job was queued: it completes doing nothing.
    if (!enabled) return;
    // Read the guards BEFORE any I/O (AD-2), through the job's own system viewer, using the
    // one shared predicate: only a SHARED payee with a website and no logo yet is ever fetched.
    const domain = ctx.uow.read((repos) => {
      const payee = repos.payees.find(ctx.viewer, payeeId);
      if (payee === undefined || !payeeNeedsLogoFetch(payee)) return null;
      return normaliseDomain(payee.websiteUrl);
    });
    if (domain === null) return;
    const fetched = await fetcher.fetchFavicon(domain, ctx.signal);
    // 404: the site has no favicon. That is a complete answer, not a failure to retry.
    if (fetched === null) return;
    if (deps.attachments === undefined) {
      throw new Error("logo-fetch: no attachment store configured");
    }
    // The write re-checks every guard, so a payee that changed while the fetch ran links
    // nothing and the stored file is cleaned up.
    recordPayeeLogo(
      { ...ctx, attachments: deps.attachments },
      // A copy onto a plain `ArrayBuffer`: the port's bytes arrive generic, the store wants one.
      { payeeId, bytes: new Uint8Array(fetched.bytes), mime: fetched.mime },
    );
  });

  return [handler];
}

export interface LogoFetcherOptions {
  /** Route requests through this http(s) proxy (`PANGOLIN_EGRESS_PROXY_URL`). */
  readonly proxyUrl?: string | null;
  /** Replaces the HTTP client, for tests. */
  readonly fetchImpl?: LogoFetchFn;
  /**
   * Replaces the DNS resolver, for tests. Defaults to `dns.promises.lookup({ all: true })`;
   * every answer it returns is checked with `isBlockedAddress` before any request is made.
   */
  readonly resolve?: LogoDnsResolver;
}

/** One DNS answer shape (a subset of what `dns.lookup` returns). */
export interface LogoDnsAnswer {
  readonly address: string;
}

/** Resolves a host to every address it answers with. */
export type LogoDnsResolver = (host: string) => Promise<readonly LogoDnsAnswer[]>;

/** The init `createLogoFetcher` sends: `dispatcher` is undici's, not in `RequestInit`. */
export interface LogoFetchInit {
  redirect?: "follow" | "manual" | "error";
  signal?: AbortSignal | null;
  dispatcher?: unknown;
}

/** One `fetch`-shaped call; the global `fetch` satisfies it. */
export type LogoFetchFn = (input: string, init?: LogoFetchInit) => Promise<Response>;

const systemResolve: LogoDnsResolver = (host) => dns.lookup(host, { all: true });

/**
 * The real `LogoFetcher`: exactly one `GET https://<domain>/favicon.ico` per call.
 *
 * The host is resolved FIRST and every private, loopback, link-local, unique-local or
 * metadata answer is refused before the request (AD-8). Redirects are NOT followed (a site
 * that wants us elsewhere gets nothing); oversize bodies and mimes off the allowlist fail the
 * attempt. 404 is the only null: "no favicon here". A failing attempt dies without retry —
 * the job kind allows exactly one attempt.
 */
export function createLogoFetcher(options: LogoFetcherOptions = {}): LogoFetcher {
  // undici's `dispatcher` lives outside `RequestInit`; the cast is at the one real call below.
  const dispatcher =
    options.proxyUrl !== null && options.proxyUrl !== undefined
      ? new ProxyAgent(options.proxyUrl)
      : undefined;
  // Proxied requests go through undici's own `fetch` — the same copy that built the
  // `ProxyAgent`. Unproxied ones keep the platform `fetch`.
  const doFetch = (options.fetchImpl ??
    (dispatcher === undefined ? fetch : undiciFetch)) as LogoFetchFn;
  const resolve = options.resolve ?? systemResolve;
  return {
    async fetchFavicon(domain, signal): Promise<FetchedLogo | null> {
      // Never request a domain that resolves to an internal address, and fail the attempt
      // (never fetch) when the host does not resolve at all.
      const answers = await resolve(domain).catch((error: unknown) => {
        throw new Error(
          `logo-fetch: ${domain} did not resolve: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      const blocked = answers.find((answer) => isBlockedAddress(answer.address));
      if (blocked !== undefined) {
        throw new Error(`logo-fetch: ${domain} resolves to the blocked address ${blocked.address}`);
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      if (signal !== undefined) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const res = await doFetch(`https://${domain}/favicon.ico`, {
          redirect: "manual",
          signal: controller.signal,
          ...(dispatcher === undefined ? {} : { dispatcher }),
        });
        // A manual redirect surfaces as the opaque status-0 response (or the raw 3xx).
        if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
          throw new Error(`logo-fetch: ${domain} redirected`);
        }
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`logo-fetch: ${domain} answered ${res.status}`);
        const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
        if (!LOGO_MIMES.includes(mime)) {
          throw new Error(`logo-fetch: ${domain} served ${mime === "" ? "no content type" : mime}`);
        }
        return { bytes: await readCapped(res), mime };
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

/** Reads the body, refusing to buffer more than the cap. */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_LOGO_BYTES) throw new Error("logo-fetch: favicon is too large");
  if (res.body === null) throw new Error("logo-fetch: favicon body is empty");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_LOGO_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("logo-fetch: favicon is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (total === 0) throw new Error("logo-fetch: favicon is empty");
  return bytes;
}
