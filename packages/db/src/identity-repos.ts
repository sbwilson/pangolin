import type {
  CredentialRepo,
  LoginAttemptRepo,
  LoginRow,
  PersonRepo,
  PersonRow,
  RecoveryCodeRepo,
  RecoveryCodeRow,
  ReEnrolmentLinkRepo,
  ReEnrolmentLinkRow,
  SetupLinkRepo,
  SetupLinkRow,
  UserRepo,
} from "@pangolin/app";
import type { Id } from "@pangolin/shared";
import { and, asc, count, eq, gt, gte, isNull, lt, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { authAccount, authPasskey, authSession, authTwoFactor, authUser } from "./schema/auth.ts";
import { loginAttempt } from "./schema/login-attempt.ts";
import { person } from "./schema/person.ts";
import { reEnrolmentLink } from "./schema/re-enrolment-link.ts";
import { recoveryCode } from "./schema/recovery-code.ts";
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
    listLogins: () => {
      check();
      return orm
        .select({ personId: person.id, displayName: person.displayName, email: authUser.email })
        .from(person)
        .innerJoin(authUser, eq(authUser.id, person.userId))
        .where(active)
        .orderBy(asc(person.createdAt), asc(person.id))
        .all() as LoginRow[];
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

/** `recovery_code` (owned by `identity`). */
export function createRecoveryCodeRepo(orm: Orm, check: () => void): RecoveryCodeRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(recoveryCode).values(row).run();
    },
    findUnused: (personId, codeHash) => {
      check();
      const row = orm
        .select()
        .from(recoveryCode)
        .where(
          and(
            eq(recoveryCode.personId, personId),
            eq(recoveryCode.codeHash, codeHash),
            isNull(recoveryCode.usedAt),
          ),
        )
        .get();
      return row as RecoveryCodeRow | undefined;
    },
    markUsed: (id: Id<"RecoveryCode">, usedAt) => {
      check();
      const result = orm
        .update(recoveryCode)
        .set({ usedAt })
        .where(and(eq(recoveryCode.id, id), isNull(recoveryCode.usedAt)))
        .run();
      return result.changes === 1;
    },
    deleteUnused: (personId) => {
      check();
      return orm
        .delete(recoveryCode)
        .where(and(eq(recoveryCode.personId, personId), isNull(recoveryCode.usedAt)))
        .run().changes;
    },
    deleteAll: (personId) => {
      check();
      return orm.delete(recoveryCode).where(eq(recoveryCode.personId, personId)).run().changes;
    },
    counts: (personId) => {
      check();
      const row = orm
        .select({
          total: count(),
          unused: count(sql`CASE WHEN ${recoveryCode.usedAt} IS NULL THEN 1 END`),
        })
        .from(recoveryCode)
        .where(eq(recoveryCode.personId, personId))
        .get();
      return { total: row?.total ?? 0, unused: row?.unused ?? 0 };
    },
  };
}

/** `re_enrolment_link` (owned by `identity`). */
export function createReEnrolmentLinkRepo(orm: Orm, check: () => void): ReEnrolmentLinkRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(reEnrolmentLink).values(row).run();
    },
    findByTokenHash: (tokenHash) => {
      check();
      const row = orm
        .select()
        .from(reEnrolmentLink)
        .where(eq(reEnrolmentLink.tokenHash, tokenHash))
        .get();
      return row as ReEnrolmentLinkRow | undefined;
    },
    findById: (id) => {
      check();
      const row = orm.select().from(reEnrolmentLink).where(eq(reEnrolmentLink.id, id)).get();
      return row as ReEnrolmentLinkRow | undefined;
    },
    markUsed: (id: Id<"ReEnrolmentLink">, usedAt) => {
      check();
      const result = orm
        .update(reEnrolmentLink)
        .set({ usedAt })
        .where(and(eq(reEnrolmentLink.id, id), isNull(reEnrolmentLink.usedAt)))
        .run();
      return result.changes === 1;
    },
    listLive: (personId, now) => {
      check();
      return orm
        .select()
        .from(reEnrolmentLink)
        .where(
          and(
            eq(reEnrolmentLink.personId, personId),
            isNull(reEnrolmentLink.usedAt),
            gt(reEnrolmentLink.expiresAt, now),
          ),
        )
        .orderBy(asc(reEnrolmentLink.createdAt), asc(reEnrolmentLink.id))
        .all() as ReEnrolmentLinkRow[];
    },
    expire: (id: Id<"ReEnrolmentLink">, at) => {
      check();
      const result = orm
        .update(reEnrolmentLink)
        .set({ expiresAt: at })
        .where(and(eq(reEnrolmentLink.id, id), isNull(reEnrolmentLink.usedAt)))
        .run();
      return result.changes === 1;
    },
  };
}

/**
 * better-auth's credential rows for one login (`auth_passkey`, `auth_two_factor`,
 * `auth_user.two_factor_enabled`, `auth_session`, `auth_account.password`), cleared by account
 * recovery inside an `identity` transaction.
 */
export function createCredentialRepo(orm: Orm, check: () => void): CredentialRepo {
  return {
    deletePasskeys: (userId) => {
      check();
      return orm.delete(authPasskey).where(eq(authPasskey.userId, userId)).run().changes;
    },
    disableTwoFactor: (userId) => {
      check();
      const secrets = orm.delete(authTwoFactor).where(eq(authTwoFactor.userId, userId)).run();
      const flag = orm
        .update(authUser)
        .set({ twoFactorEnabled: false })
        .where(and(eq(authUser.id, userId), eq(authUser.twoFactorEnabled, true)))
        .run();
      return secrets.changes > 0 || flag.changes > 0;
    },
    revokeSessions: (userId) => {
      check();
      return orm.delete(authSession).where(eq(authSession.userId, userId)).run().changes;
    },
    setPasswordHash: (userId, passwordHash, at) => {
      check();
      const result = orm
        .update(authAccount)
        .set({ password: passwordHash, updatedAt: new Date(at) })
        .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, "credential")))
        .run();
      return result.changes > 0;
    },
  };
}
