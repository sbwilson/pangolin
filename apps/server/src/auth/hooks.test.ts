import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, createIdGenerator, type IdentityContext, systemClock } from "@pangolin/app";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { APIError } from "better-auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientAddress } from "../http/app.ts";
import { Browser, createHarness } from "../testing/auth-harness.ts";
import { type SignUpPermit, signUpHooks, toApiError } from "./hooks.ts";
import { nodeTokens } from "./secret.ts";

describe("toApiError", () => {
  it.each([
    ["Validation", 400],
    ["Conflict", 409],
    ["RateLimited", 429],
    ["ReauthRequired", 403],
  ] as const)("keeps an AppError %s as its code, with status %i", (code, status) => {
    const error = toApiError(new AppError(code, "m"));
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ statusCode: status, body: { code, message: "m" } });
  });

  it("passes anything else through", () => {
    const error = new Error("x");
    expect(toApiError(error)).toBe(error);
  });
});

describe("signUpHooks", () => {
  let dir: string;
  let db: Db;
  let ctx: IdentityContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pangolin-hooks-"));
    db = openDatabase(join(dir, "test.sqlite"));
    migrate(db, loadMigrations(packageMigrationsDir));
    ctx = {
      clock: systemClock("UTC"),
      newId: createIdGenerator(),
      uow: createUnitOfWork(db),
      tokens: nodeTokens,
    };
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const user = {
    id: "user-a",
    email: "a@example.com",
    name: "A",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const logged: string[] = [];
  const log = (_level: string, message: string) => {
    logged.push(message);
  };

  it("refuses a user created outside our sign-up endpoint with 400 Validation", async () => {
    const hooks = signUpHooks(ctx, new AsyncLocalStorage<SignUpPermit>(), log);
    await expect(hooks.user?.create?.before?.(user, null)).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "Validation" },
    });
  });

  const permit = (): SignUpPermit => ({ token: "unknown", displayName: "A", colour: "#000000" });

  it("rethrows the original error when deleting the user fails too, and logs the failure", async () => {
    const permits = new AsyncLocalStorage<SignUpPermit>();
    const hooks = signUpHooks(ctx, permits, log);
    const deleteUser = vi.fn(async () => {
      throw new Error("database is locked");
    });
    const endpoint = { context: { internalAdapter: { deleteUser } } } as never;
    await expect(
      permits.run(permit(), () => hooks.user?.create?.after?.(user, endpoint)),
    ).rejects.toMatchObject({ statusCode: 400, body: { code: "Validation" } });
    expect(deleteUser).toHaveBeenCalledWith("user-a");
    expect(logged.at(-1)).toMatch(/could not be removed: database is locked/);
  });

  it("throws a clear error when there is no adapter to remove the user with", async () => {
    const permits = new AsyncLocalStorage<SignUpPermit>();
    const hooks = signUpHooks(ctx, permits, log);
    const failure = await permits
      .run(permit(), async () => hooks.user?.create?.after?.(user, null))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/could not be removed/);
    expect((failure as Error).cause).toMatchObject({ code: "Validation" });
  });

  it("deletes the user again when completing the sign-up fails", async () => {
    const permits = new AsyncLocalStorage<SignUpPermit>();
    const hooks = signUpHooks(ctx, permits, log);
    const deleteUser = vi.fn(async () => {});
    const endpoint = { context: { internalAdapter: { deleteUser } } } as never;
    const permit: SignUpPermit = { token: "unknown", displayName: "A", colour: "#000000" };
    await expect(
      permits.run(permit, () => hooks.user?.create?.after?.(user, endpoint)),
    ).rejects.toMatchObject({ body: { code: "Validation" } });
    expect(deleteUser).toHaveBeenCalledWith("user-a");
    expect(permit.personId).toBeUndefined();
    expect(db.prepare("SELECT count(*) FROM person").pluck().get()).toBe(0);
  });
});

describe("better-auth's rate limit", () => {
  const lockout = { maxFailures: 100, windowMs: 60_000, lockMs: 60_000 };
  /** Hono bindings with a socket from `address`, as @hono/node-server provides. */
  const from = (address: string) => ({ incoming: { socket: { remoteAddress: address } } });

  /** Statuses of 11 wrong sign-ins, each with the headers `headersFor(i)` returns. */
  async function signIns(
    h: ReturnType<typeof createHarness>,
    env: unknown,
    headersFor: (i: number) => Record<string, string>,
  ): Promise<number[]> {
    const b = new Browser(h.app, undefined, env);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await b.request("/api/auth/sign-in/email", {
        body: { email: `nobody${i}@example.com`, password: "wrong password!!" },
        headers: headersFor(i),
      });
      statuses.push(res.status);
    }
    return statuses;
  }

  it("answers 429 after the configured sign-ins a minute from one client", async () => {
    const h = createHarness({ lockout, rateLimitPerMinute: 10 });
    try {
      const statuses = await signIns(h, from("203.0.113.7"), () => ({}));
      expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(statuses[10]).toBe(429);
    } finally {
      h.close();
    }
  });

  it("ignores a client-sent address header and, from an untrusted peer, X-Forwarded-For", async () => {
    const h = createHarness({ lockout, rateLimitPerMinute: 10 });
    try {
      const statuses = await signIns(h, from("203.0.113.8"), (i) => ({
        "x-pangolin-client-ip": `198.51.100.${i}`,
        "X-Forwarded-For": `198.51.100.${i}`,
      }));
      expect(statuses[10]).toBe(429);
    } finally {
      h.close();
    }
  });

  it("keys on the forwarded client when the peer is a trusted proxy", async () => {
    const h = createHarness({ lockout, rateLimitPerMinute: 10 }, ["10.0.0.2"]);
    try {
      const rotating = await signIns(h, from("::ffff:10.0.0.2"), (i) => ({
        "X-Forwarded-For": `198.51.100.${i}`,
      }));
      expect(rotating).toEqual(Array(11).fill(401));
      // One client behind the proxy, spoofing an extra hop on the left, is still one client.
      const one = await signIns(h, from("10.0.0.2"), (i) => ({
        "X-Forwarded-For": `192.0.2.${i}, 203.0.113.9`,
      }));
      expect(one[10]).toBe(429);
    } finally {
      h.close();
    }
  });
});

describe("clientAddress", () => {
  it("uses the socket unless it is a trusted proxy", () => {
    expect(clientAddress("198.51.100.1", "1.2.3.4", [])).toBe("198.51.100.1");
    expect(clientAddress("::ffff:10.0.0.2", "1.2.3.4, 5.6.7.8", ["10.0.0.2"])).toBe("5.6.7.8");
    expect(clientAddress("10.0.0.2", "1.2.3.4, 10.0.0.3", ["10.0.0.2", "10.0.0.3"])).toBe(
      "1.2.3.4",
    );
    expect(clientAddress("10.0.0.2", undefined, ["10.0.0.2"])).toBe("10.0.0.2");
    expect(clientAddress(undefined, "1.2.3.4", [])).toBeUndefined();
  });
});
