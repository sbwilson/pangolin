import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppError,
  type CodeHasher,
  createIdGenerator,
  createPerson,
  type IdentityContext,
  issueInitialRecoveryCodes,
  issueReEnrolmentLink,
  listNotices,
  personViewer,
  redeemRecoveryCode,
  redeemReEnrolmentLink,
  regenerateRecoveryCodes,
  resetUser,
  type TokenPort,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { parseDate, Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

let dir: string;
let db: Db;
let now: Temporal.Instant;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const CODE_KEY = "test-recovery-code-key";
const hmac = (value: string) => createHmac("sha256", CODE_KEY).update(value).digest("hex");
const codes: CodeHasher = { hash: hmac };
const tokens: TokenPort = {
  generate: () => randomBytes(32).toString("base64url"),
  hash: sha,
  randomBytes: (length) => new Uint8Array(randomBytes(length)),
};

function base(): IdentityContext & { codes: CodeHasher } {
  return {
    clock: { now: () => now, today: () => parseDate(now.toString().slice(0, 10)) },
    newId: createIdGenerator(),
    uow: createUnitOfWork(db),
    tokens,
    codes,
  };
}

function as(personId: Id<"Person">): UseCaseContext & { tokens: TokenPort; codes: CodeHasher } {
  return { ...base(), viewer: personViewer(personId, now) };
}

const count = (sql: string, ...args: unknown[]) =>
  db
    .prepare(sql)
    .pluck()
    .get(...args) as number;

/** A person with a fully enrolled login: password, TOTP, one passkey and one session. */
function enrolledPerson(user: string, name: string): Id<"Person"> {
  const at = "2026-09-27T00:00:00.000Z";
  db.prepare(
    `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, ?)`,
  ).run(user, name, `${user}@example.com`, at, at);
  db.prepare(
    `INSERT INTO auth_account (id, user_id, account_id, provider_id, password, created_at, updated_at)
     VALUES (?, ?, ?, 'credential', 'old-hash', ?, ?)`,
  ).run(`acc-${user}`, user, user, at, at);
  db.prepare(
    `INSERT INTO auth_two_factor (id, user_id, secret, backup_codes, verified) VALUES (?, ?, 's', '[]', 1)`,
  ).run(`tf-${user}`, user);
  db.prepare(
    `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
     VALUES (?, ?, 'k', ?, 0, 'singleDevice', 0)`,
  ).run(`pk-${user}`, user, `cred-${user}`);
  db.prepare(
    `INSERT INTO auth_session (id, user_id, token, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, '2026-09-28T00:00:00.000Z', ?, ?)`,
  ).run(`s-${user}`, user, `t-${user}`, at, at);
  return createPerson(
    { ...base(), viewer: systemViewer("cli:test") },
    { displayName: name, colour: "#000000", userId: user },
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-recovery-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = Temporal.Instant.from("2026-09-27T01:00:00Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  return undefined;
}

describe("recovery codes on SQLite", () => {
  it("stores 10 hashes, redeems one once, and clears passkeys and sessions", () => {
    const alex = enrolledPerson("user-a", "Alex");
    const { codes } = issueInitialRecoveryCodes(as(alex));
    expect(codes).toHaveLength(10);
    const rows = db.prepare("SELECT * FROM recovery_code").all() as { code_hash: string }[];
    expect(rows.map((r) => r.code_hash).sort()).toEqual(
      codes.map((c) => hmac(c.replace("-", ""))).sort(),
    );
    const stored = JSON.stringify(db.prepare("SELECT * FROM audit_log").all());
    for (const c of codes) {
      expect(stored).not.toContain(c);
      expect(stored).not.toContain(c.replace("-", ""));
    }

    const first = codes[0] ?? "";
    const result = redeemRecoveryCode(base(), { userId: "user-a", code: first.toLowerCase() });
    expect(result).toEqual({ personId: alex, userId: "user-a", remaining: 9 });
    expect(count("SELECT count(*) FROM auth_passkey")).toBe(0);
    expect(count("SELECT count(*) FROM auth_session")).toBe(0);
    // TOTP and the password stay: a code replaces the passkey only.
    expect(count("SELECT two_factor_enabled FROM auth_user")).toBe(1);
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NOT NULL")).toBe(1);
    expect(code(() => redeemRecoveryCode(base(), { userId: "user-a", code: first }))).toBe(
      "Unauthenticated",
    );
    const actions = db
      .prepare("SELECT entity, action FROM audit_log WHERE entity IN ('recovery_code', 'user')")
      .all();
    expect(actions).toEqual([
      { entity: "recovery_code", action: "generate" },
      { entity: "recovery_code", action: "use" },
      { entity: "user", action: "recover" },
    ]);
  });

  it("regenerates: unused codes are replaced, used ones kept", () => {
    const alex = enrolledPerson("user-a", "Alex");
    const { codes } = issueInitialRecoveryCodes(as(alex));
    redeemRecoveryCode(base(), { userId: "user-a", code: codes[0] ?? "" });
    const fresh = regenerateRecoveryCodes(as(alex)).codes;
    expect(count("SELECT count(*) FROM recovery_code")).toBe(11);
    expect(count("SELECT count(*) FROM recovery_code WHERE used_at IS NULL")).toBe(10);
    expect(code(() => redeemRecoveryCode(base(), { userId: "user-a", code: codes[1] ?? "" }))).toBe(
      "Unauthenticated",
    );
    expect(redeemRecoveryCode(base(), { userId: "user-a", code: fresh[0] ?? "" }).remaining).toBe(
      9,
    );
  });
});

describe("re-enrolment links on SQLite", () => {
  it("issues, supersedes and redeems a link, clearing every credential", () => {
    const alex = enrolledPerson("user-a", "Alex");
    const sam = enrolledPerson("user-b", "Sam");
    issueInitialRecoveryCodes(as(sam));
    const first = issueReEnrolmentLink(as(alex), { personId: sam });
    const second = issueReEnrolmentLink(as(alex), { personId: sam });
    const stored = db.prepare("SELECT * FROM re_enrolment_link ORDER BY id").all() as {
      token_hash: string;
      issued_by: string;
    }[];
    expect(stored.map((r) => r.token_hash)).toEqual([sha(first.token), sha(second.token)]);
    expect(stored.every((r) => r.issued_by === `person:${alex}`)).toBe(true);
    expect(
      code(() => redeemReEnrolmentLink(base(), { token: first.token, passwordHash: "new" })),
    ).toBe("Validation");
    // One open notice, for Sam only.
    expect(listNotices(as(sam)).map((n) => n.kind)).toEqual(["identity.partner-reset"]);
    expect(listNotices(as(alex))).toEqual([]);

    const redeemed = redeemReEnrolmentLink(base(), { token: second.token, passwordHash: "new" });
    expect(redeemed).toEqual({ personId: sam, userId: "user-b" });
    expect(count("SELECT count(*) FROM auth_passkey WHERE user_id = 'user-b'")).toBe(0);
    expect(count("SELECT count(*) FROM auth_two_factor WHERE user_id = 'user-b'")).toBe(0);
    expect(count("SELECT two_factor_enabled FROM auth_user WHERE id = 'user-b'")).toBe(0);
    expect(count("SELECT count(*) FROM auth_session WHERE user_id = 'user-b'")).toBe(0);
    expect(count("SELECT count(*) FROM recovery_code WHERE person_id = ?", sam)).toBe(0);
    expect(
      db.prepare("SELECT password FROM auth_account WHERE user_id = 'user-b'").pluck().get(),
    ).toBe("new");
    // Alex is untouched.
    expect(count("SELECT count(*) FROM auth_passkey WHERE user_id = 'user-a'")).toBe(1);
    expect(count("SELECT count(*) FROM auth_session WHERE user_id = 'user-a'")).toBe(1);
    expect(
      code(() => redeemReEnrolmentLink(base(), { token: second.token, passwordHash: "x" })),
    ).toBe("Validation");
    const audit = JSON.stringify(db.prepare("SELECT * FROM audit_log").all());
    expect(audit).not.toContain(second.token);
    expect(audit).not.toContain(sha(second.token));
    expect(audit).not.toContain('"new"');
  });

  it("refuses a link 24 hours after issue", () => {
    const alex = enrolledPerson("user-a", "Alex");
    const sam = enrolledPerson("user-b", "Sam");
    const link = issueReEnrolmentLink(as(alex), { personId: sam });
    now = now.add({ hours: 24 });
    expect(
      code(() => redeemReEnrolmentLink(base(), { token: link.token, passwordHash: "n" })),
    ).toBe("Validation");
  });

  it("resetUser clears at once and issues a cli:reset-user link", () => {
    enrolledPerson("user-a", "Alex");
    const sam = enrolledPerson("user-b", "Sam");
    const result = resetUser(
      { ...base(), viewer: systemViewer("cli:reset-user") },
      { personId: sam },
    );
    expect(result.cleared).toMatchObject({
      passwordChanged: true,
      passkeysRemoved: 1,
      sessionsRevoked: 1,
    });
    const password = db
      .prepare("SELECT password FROM auth_account WHERE user_id = 'user-b'")
      .pluck()
      .get() as string;
    expect(password).not.toBe("old-hash");
    expect(password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(db.prepare("SELECT issued_by FROM re_enrolment_link").pluck().get()).toBe(
      "cli:reset-user",
    );
    expect(
      db.prepare("SELECT DISTINCT actor FROM audit_log WHERE entity != 'person'").pluck().all(),
    ).toEqual(["cli:reset-user"]);
    expect(listNotices(as(sam))).toHaveLength(1);
  });
});
