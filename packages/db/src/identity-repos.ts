import type {
  LoginAttemptRepo,
  PersonRepo,
  PersonRow,
  SetupLinkRepo,
  SetupLinkRow,
  UserRepo,
} from "@pangolin/app";
import type { Id } from "@pangolin/shared";
import { and, asc, count, eq, gt, gte, isNull, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { authPasskey, authUser } from "./schema/auth.ts";
import { loginAttempt } from "./schema/login-attempt.ts";
import { person } from "./schema/person.ts";
import { setupLink } from "./schema/setup-link.ts";

type Orm = BetterSQLite3Database;

/** `person` (owned by `identity`). `check` throws once the owning transaction has ended. */
export function createPersonRepo(orm: Orm, check: () => void): PersonRepo {
  const active = isNull(person.deletedAt);
  return {
    insert: (row) => {
      check();
      orm.insert(person).values(row).run();
    },
    findByUserId: (userId) => {
      check();
      const row = orm
        .select()
        .from(person)
        .where(and(eq(person.userId, userId), active))
        .get();
      return row as PersonRow | undefined;
    },
    listActive: () => {
      check();
      return orm
        .select()
        .from(person)
        .where(active)
        .orderBy(asc(person.createdAt), asc(person.id))
        .all() as PersonRow[];
    },
  };
}

/** better-auth's `auth_user` and `auth_passkey`, read only: better-auth writes them. */
export function createUserRepo(orm: Orm, check: () => void): UserRepo {
  return {
    count: () => {
      check();
      return orm.select({ n: count() }).from(authUser).get()?.n ?? 0;
    },
    enrolment: (userId) => {
      check();
      const user = orm
        .select({ totp: authUser.twoFactorEnabled })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .get();
      if (user === undefined) return undefined;
      const passkeys =
        orm.select({ n: count() }).from(authPasskey).where(eq(authPasskey.userId, userId)).get()
          ?.n ?? 0;
      return { totp: user.totp === true, passkeys };
    },
  };
}

/** `setup_link` (owned by `identity`). */
export function createSetupLinkRepo(orm: Orm, check: () => void): SetupLinkRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(setupLink).values(row).run();
    },
    findByTokenHash: (tokenHash) => {
      check();
      const row = orm.select().from(setupLink).where(eq(setupLink.tokenHash, tokenHash)).get();
      return row as SetupLinkRow | undefined;
    },
    markUsed: (id: Id<"SetupLink">, usedAt) => {
      check();
      const result = orm
        .update(setupLink)
        .set({ usedAt })
        .where(and(eq(setupLink.id, id), isNull(setupLink.usedAt)))
        .run();
      return result.changes === 1;
    },
    listLive: (now) => {
      check();
      return orm
        .select()
        .from(setupLink)
        .where(and(isNull(setupLink.usedAt), gt(setupLink.expiresAt, now)))
        .orderBy(asc(setupLink.createdAt), asc(setupLink.id))
        .all() as SetupLinkRow[];
    },
    expire: (id: Id<"SetupLink">, at) => {
      check();
      const result = orm
        .update(setupLink)
        .set({ expiresAt: at })
        .where(and(eq(setupLink.id, id), isNull(setupLink.usedAt)))
        .run();
      return result.changes === 1;
    },
    hasLive: (now) => {
      check();
      const row = orm
        .select({ id: setupLink.id })
        .from(setupLink)
        .where(and(isNull(setupLink.usedAt), gt(setupLink.expiresAt, now)))
        .limit(1)
        .get();
      return row !== undefined;
    },
  };
}

/** `login_attempt` (owned by `identity`). */
export function createLoginAttemptRepo(orm: Orm, check: () => void): LoginAttemptRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(loginAttempt).values(row).run();
    },
    listSince: (email, since) => {
      check();
      return orm
        .select({ email: loginAttempt.email, at: loginAttempt.at, ok: loginAttempt.ok })
        .from(loginAttempt)
        .where(and(eq(loginAttempt.email, email), gte(loginAttempt.at, since)))
        .orderBy(asc(loginAttempt.at), asc(loginAttempt.id))
        .all();
    },
    deleteBefore: (before) => {
      check();
      orm.delete(loginAttempt).where(lt(loginAttempt.at, before)).run();
    },
  };
}
