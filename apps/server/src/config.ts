import { join } from "node:path";
import { z } from "zod";

const minutes = (fallback: number) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(fallback);

/** Where the admin socket listens unless `PANGOLIN_ADMIN_SOCKET` says otherwise. */
export const DEFAULT_ADMIN_SOCKET = "/run/pangolin/admin.sock";

/** Every environment variable the server reads, parsed once at startup. */
const envSchema = z.object({
  PANGOLIN_DATA_DIR: z.string().min(1).default("/data"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** `true`/`false` (also `1`/`0`, `yes`/`no`, `on`/`off`). */
  PANGOLIN_DEMO: z.stringbool().default(false),
  /** The seed file demo mode loads; defaults to `demo-seed.json` next to the bundle. */
  PANGOLIN_SEED_FILE: z.string().min(1).optional(),
  /** Jobs each lane runs at once (AD-8). */
  PANGOLIN_JOB_CONCURRENCY_LLM: z.coerce.number().int().min(0).max(64).default(1),
  PANGOLIN_JOB_CONCURRENCY_NET: z.coerce.number().int().min(0).max(64).default(2),
  PANGOLIN_JOB_CONCURRENCY_LOCAL: z.coerce.number().int().min(0).max(64).default(1),
  /** How long a claimed job's lease lasts before another runner may take it over. */
  PANGOLIN_JOB_LEASE_MS: z.coerce.number().int().min(3000).default(60_000),
  /**
   * The URL people open, as the browser sees it (behind the proxy). Its origin is the only one
   * allowed to write, its host is the passkey relying party, and setup links point at it.
   */
  PANGOLIN_PUBLIC_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  /** File holding the auth secret; created (mode 0600) on first boot. Never in the database. */
  PANGOLIN_AUTH_SECRET_FILE: z.string().min(1).optional(),
  /** Failed password or TOTP attempts for one email within the window that lock it. */
  PANGOLIN_LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  PANGOLIN_LOGIN_WINDOW_MINUTES: minutes(15),
  PANGOLIN_LOGIN_LOCKOUT_MINUTES: minutes(15),
  /** A session with no request for this long expires. */
  PANGOLIN_SESSION_IDLE_MINUTES: minutes(30),
  /** Password sign-ins, and two-factor requests, one client may make per minute. */
  PANGOLIN_AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  /**
   * Comma-separated IPs of the reverse proxy. Only a request from one of them has its
   * `X-Forwarded-For` believed (for the client's address); default none.
   */
  PANGOLIN_TRUSTED_PROXIES: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((ip) => ip.trim())
        .filter((ip) => ip !== ""),
    )
    .pipe(z.array(z.union([z.ipv4(), z.ipv6()]))),
  /**
   * The admin socket `pangolin` reaches the running server on (AD-16), on a tmpfs, never the data
   * volume. Empty disables it.
   */
  PANGOLIN_ADMIN_SOCKET: z
    .string()
    .default(DEFAULT_ADMIN_SOCKET)
    .transform((value) => (value.trim() === "" ? null : value))
    .pipe(z.string().startsWith("/", { message: "Expected an absolute path" }).nullable()),
  /** The release, set by the image build (`dev` for local builds). */
  PANGOLIN_VERSION: z.string().min(1).max(100).default("dev"),
});

export interface JobsConfig {
  readonly concurrency: { readonly llm: number; readonly net: number; readonly local: number };
  readonly leaseMs: number;
}

export const DEFAULT_JOBS_CONFIG: JobsConfig = {
  concurrency: { llm: 1, net: 2, local: 1 },
  leaseMs: 60_000,
};

export interface AuthConfig {
  /** The public URL with no trailing slash, e.g. `https://money.example.com`. */
  readonly publicUrl: string;
  readonly secretFile: string;
  readonly lockout: {
    readonly maxFailures: number;
    readonly windowMs: number;
    readonly lockMs: number;
  };
  readonly sessionIdleMs: number;
  /** Password sign-ins and two-factor requests per client per minute. */
  readonly rateLimitPerMinute: number;
}

export interface Config {
  readonly dataDir: string;
  readonly port: number;
  /** Demo mode: an in-memory database loaded from the seed, read-only, with no sign-in. */
  readonly demo: boolean;
  readonly seedFile?: string;
  readonly jobs: JobsConfig;
  readonly auth: AuthConfig;
  /** Reverse-proxy IPs whose `X-Forwarded-For` is trusted. */
  readonly trustedProxies: readonly string[];
  /** The admin socket's path; null when disabled. Demo mode never opens it. */
  readonly adminSocket: string | null;
  /** The release (`PANGOLIN_VERSION`); `dev` for local builds. */
  readonly version: string;
}

/** The auth settings for `dataDir` with every default, for tests and callers without an env. */
export function defaultAuthConfig(dataDir: string): AuthConfig {
  return {
    publicUrl: "http://localhost:3000",
    secretFile: join(dataDir, "auth-secret"),
    lockout: { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
    sessionIdleMs: 30 * 60_000,
    rateLimitPerMinute: 10,
  };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Checks `PANGOLIN_PUBLIC_URL` can work: passkeys need a domain name (never an IP address) as
 * their relying party, and `Secure` cookies over plain http work only on localhost.
 */
function checkPublicUrl(url: URL): void {
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error("PANGOLIN_PUBLIC_URL must be an origin, with no path, query or fragment");
  }
  if (url.hostname.startsWith("[") || IPV4.test(url.hostname)) {
    throw new Error(
      "PANGOLIN_PUBLIC_URL must use a host name, not an IP address: passkeys cannot be bound to an IP",
    );
  }
  if (url.protocol === "http:" && url.hostname !== "localhost") {
    throw new Error(
      "PANGOLIN_PUBLIC_URL must be https (plain http works only for localhost): sign-in cookies are Secure",
    );
  }
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.parse(env);
  const publicUrl = new URL(parsed.PANGOLIN_PUBLIC_URL);
  checkPublicUrl(publicUrl);
  return {
    dataDir: parsed.PANGOLIN_DATA_DIR,
    port: parsed.PORT,
    demo: parsed.PANGOLIN_DEMO,
    ...(parsed.PANGOLIN_SEED_FILE === undefined ? {} : { seedFile: parsed.PANGOLIN_SEED_FILE }),
    jobs: {
      concurrency: {
        llm: parsed.PANGOLIN_JOB_CONCURRENCY_LLM,
        net: parsed.PANGOLIN_JOB_CONCURRENCY_NET,
        local: parsed.PANGOLIN_JOB_CONCURRENCY_LOCAL,
      },
      leaseMs: parsed.PANGOLIN_JOB_LEASE_MS,
    },
    auth: {
      publicUrl: publicUrl.origin,
      secretFile: parsed.PANGOLIN_AUTH_SECRET_FILE ?? join(parsed.PANGOLIN_DATA_DIR, "auth-secret"),
      lockout: {
        maxFailures: parsed.PANGOLIN_LOGIN_MAX_FAILURES,
        windowMs: parsed.PANGOLIN_LOGIN_WINDOW_MINUTES * 60_000,
        lockMs: parsed.PANGOLIN_LOGIN_LOCKOUT_MINUTES * 60_000,
      },
      sessionIdleMs: parsed.PANGOLIN_SESSION_IDLE_MINUTES * 60_000,
      rateLimitPerMinute: parsed.PANGOLIN_AUTH_RATE_LIMIT,
    },
    trustedProxies: parsed.PANGOLIN_TRUSTED_PROXIES,
    adminSocket: parsed.PANGOLIN_ADMIN_SOCKET,
    version: parsed.PANGOLIN_VERSION,
  };
}
