// Test support only: the real HTTP app with real better-auth on a fresh SQLite database, driven
// in-process, with a cookie jar per "browser" and a clock our use cases read that tests can move.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Clock,
  type CodeHasher,
  createIdGenerator,
  type IdentityContext,
  systemClock,
} from "@pangolin/app";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { writeFirstSetupLink } from "../admin/setup-link.ts";
import { createAuth } from "../auth/auth.ts";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { type AuthConfig, defaultAuthConfig } from "../config.ts";
import { createApp } from "../http/app.ts";

export const ORIGIN = "http://localhost:3000";

export interface Harness {
  /** The public URL the server runs as (`ORIGIN` unless overridden). */
  readonly origin: string;
  readonly db: Db;
  readonly app: ReturnType<typeof createApp>;
  /** Moves the clock our use cases read (better-auth keeps the real time). */
  advanceMinutes(minutes: number): void;
  /** Issues a setup link as the server does at first boot, and returns its token. */
  firstLink(): string;
  /** better-auth's log lines, message only. */
  readonly logged: string[];
  /** What the use cases run with, including the recovery-code hasher. */
  readonly identity: IdentityContext & { readonly codes: CodeHasher };
  /**
   * Gives the login with `email` a passkey row, as WebAuthn registration would (the harness has
   * no authenticator), completing its enrolment once TOTP is confirmed too.
   */
  addPasskey(email: string): void;
  close(): void;
}

export function createHarness(
  overrides: Partial<AuthConfig> = {},
  trustedProxies: readonly string[] = [],
): Harness {
  const dir = mkdtempSync(join(tmpdir(), "pangolin-auth-"));
  const db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  const uow = createUnitOfWork(db);
  const real = systemClock("UTC");
  let offsetMinutes = 0;
  const clock: Clock = {
    now: () => real.now().add({ minutes: offsetMinutes }),
    today: () => real.now().add({ minutes: offsetMinutes }).toZonedDateTimeISO("UTC").toPlainDate(),
  };
  const deps = { uow, clock, newId: createIdGenerator(), tokens: nodeTokens };
  const config: AuthConfig = {
    ...defaultAuthConfig(dir),
    publicUrl: ORIGIN,
    // Tests sign in far more often than people do; the limit has its own test.
    rateLimitPerMinute: 1000,
    ...overrides,
  };
  const origin = config.publicUrl;
  const logged: string[] = [];
  const secret = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";
  const codes = recoveryCodeHasher(secret);
  const gateway = createAuth({
    ...deps,
    db,
    config,
    secret,
    log: (_level, message) => logged.push(message),
  });
  const app = createApp({
    ...deps,
    systemHealth: createSystemHealthRepo(db),
    codes,
    publicUrl: origin,
    authn: { kind: "live", gateway },
    trustedProxies,
    recoveryRateLimitPerMinute: config.rateLimitPerMinute,
  });
  return {
    origin,
    db,
    app,
    logged,
    identity: { ...deps, codes },
    addPasskey: (email) => {
      db.prepare(
        `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
         SELECT 'pk-' || id, id, 'key', 'cred-' || id, 0, 'singleDevice', 0 FROM auth_user
         WHERE email = ?`,
      ).run(email);
    },
    advanceMinutes: (minutes) => {
      offsetMinutes += minutes;
    },
    firstLink: () => {
      const file = writeFirstSetupLink({ ...deps, dataDir: dir, publicUrl: origin });
      if (file === undefined) throw new Error("no setup link was needed");
      const url = new URL(readFileSync(file, "utf8").trim());
      return url.searchParams.get("token") ?? "";
    },
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** One browser: keeps cookies between requests and sends our Origin on writes. */
export class Browser {
  readonly cookies = new Map<string, string>();
  /** Every `Set-Cookie` header received, raw, for attribute checks. */
  readonly setCookies: string[] = [];

  private readonly app: Harness["app"];
  private readonly origin: string;
  /** Hono's bindings for each request: set `incoming.socket` to fake the client's address. */
  env: unknown;

  constructor(app: Harness["app"], origin: string = ORIGIN, env?: unknown) {
    this.app = app;
    this.origin = origin;
    this.env = env;
  }

  async request(
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    const headers = new Headers(init.headers);
    if (method !== "GET" && method !== "HEAD") headers.set("Origin", this.origin);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (this.cookies.size > 0) {
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const res = await this.app.request(
      `${this.origin}${path}`,
      {
        method,
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      },
      this.env,
    );
    for (const cookie of res.headers.getSetCookie()) {
      this.setCookies.push(cookie);
      const [pair = ""] = cookie.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /;\s*max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async json<T = Record<string, unknown>>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; body: T }> {
    const res = await this.request(path, init);
    return { status: res.status, body: (await res.json()) as T };
  }
}
