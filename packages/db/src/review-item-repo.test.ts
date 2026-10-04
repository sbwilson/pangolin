import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAccount,
  createIdGenerator,
  createPerson,
  defineReviewKind,
  listReviewItems,
  personViewer,
  raiseReviewItem,
  resolveReviewItem,
  type UseCaseContext,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

const now = Temporal.Instant.from("2026-09-27T00:00:00Z");
const personal = defineReviewKind({ kind: "test.personal", module: "planning", scope: "person" });
const perAccount = defineReviewKind({ kind: "test.account", module: "ledger", scope: "account" });
const household = defineReviewKind({
  kind: "test.household",
  module: "system",
  scope: "household",
});

let dir: string;
let db: Db;
let ctx: UseCaseContext;
let personA: Id<"Person">;
let personB: Id<"Person">;
let acc1: Id<"Account">;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-review-"));
  db = openDatabase(join(dir, "test.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  let ms = now.epochMilliseconds;
  ctx = {
    viewer: systemViewer("cli:test"),
    clock: { now: () => now, today: () => now.toZonedDateTimeISO("UTC").toPlainDate() },
    newId: createIdGenerator({ now: () => ++ms, random: Math.random }),
    uow: createUnitOfWork(db),
  };
  personA = createPerson(ctx, { displayName: "A", colour: "#000000" });
  personB = createPerson(ctx, { displayName: "B", colour: "#ffffff" });
  acc1 = createAccount(ctx, {
    name: "Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [{ personId: personA, shareBp: 10000 }],
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function raise(input: Parameters<typeof raiseReviewItem>[3]) {
  return write(ctx, (tx, audit) => raiseReviewItem(tx, audit, ctx, input));
}

function resolve(dedupeKey: string) {
  return write(ctx, (tx, audit) =>
    resolveReviewItem(tx, audit, ctx, { dedupeKey, resolution: "dismissed" }),
  );
}

describe("review items on SQLite", () => {
  it("raises once per open key, resolves, then raises a new item", () => {
    const item = { kind: household, entityRef: "thing:1", dedupeKey: "thing:1" };
    const first = raise(item);
    expect(raise(item)).toEqual({ id: first.id, raised: false });
    expect(resolve("thing:1")).toBe(true);
    expect(resolve("thing:1")).toBe(false);
    const again = raise(item);
    expect(again.raised).toBe(true);
    expect(db.prepare("SELECT id, resolution FROM review_item ORDER BY id").all()).toEqual([
      { id: first.id, resolution: "dismissed" },
      { id: again.id, resolution: null },
    ]);
    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entity = 'review_item' ORDER BY id")
      .pluck()
      .all();
    expect(actions).toEqual(["raise", "resolve", "raise"]);
  });

  it("scopes visibility: own and household for people, everything for the system", () => {
    raise({ kind: personal, entityRef: "goal:a", dedupeKey: "a", personId: personA });
    raise({ kind: personal, entityRef: "goal:b", dedupeKey: "b", personId: personB });
    raise({ kind: household, entityRef: "thing:h", dedupeKey: "h" });
    raise({ kind: perAccount, entityRef: "acct:1", dedupeKey: "acc", accountId: acc1 });
    const refs = (viewer: UseCaseContext["viewer"]) =>
      listReviewItems({ ...ctx, viewer }).map((row) => row.entityRef);
    expect(refs(personViewer(personA, now))).toEqual(["goal:a", "thing:h"]);
    expect(refs(personViewer(personB, now))).toEqual(["goal:b", "thing:h"]);
    expect(refs(ctx.viewer)).toEqual(["goal:a", "goal:b", "thing:h", "acct:1"]);
  });

  it("throws when listing without a viewer", () => {
    expect(() =>
      ctx.uow.read((repos) => repos.reviewItems.listOpenFor(undefined as never)),
    ).toThrow(/viewer is required/);
  });

  it("refuses a row scoped to both an account and a person", () => {
    const insert = db.prepare(
      `INSERT INTO review_item (id, kind, account_id, person_id, entity_ref, dedupe_key, created_at)
       VALUES (?, 'test.x', ?, ?, 'e', ?, 'x')`,
    );
    insert.run("r1", acc1, null, "k1");
    insert.run("r2", null, personA, "k2");
    expect(() => insert.run("r3", acc1, personA, "k3")).toThrow(
      /CHECK constraint failed: review_item_scope/,
    );
  });

  it("refuses an account_id that is not an account", () => {
    expect(() =>
      raise({ kind: perAccount, entityRef: "acct:x", dedupeKey: "x", accountId: "nobody" }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("refuses a person_id that is not a person", () => {
    expect(() =>
      raise({ kind: personal, entityRef: "goal:x", dedupeKey: "x", personId: "nobody" }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
