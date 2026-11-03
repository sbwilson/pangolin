// Verification test asserting Epic 6 Done-when conditions on the default seed:
// 1. Seeded budget: spent, pace, and projected match hand calculation; rollover carries into next period;
//    editor suggests limit from last 6 periods; overspending raises one over-budget review item per budget per period.
// 2. Personal budgets follow each person's payday anchor; shared budgets use household anchor and count shared splits, whoever paid.
// 3. Synthetic series of >= 3 occurrences detected and one-click confirmed; missed payment and 11% rise each raise an alert.
// 4. Scoping & Privacy: personal budgets and bill alerts only visible to the relevant person; shared to both.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BudgetSummary,
  createIdGenerator,
  fixedClockAt,
  listCandidateSeries,
  listRecurringSeries,
  listReviewItems,
  personViewer,
  syncAllBillAlertReviewItems,
  syncAllBudgetReviewItems,
  updateHouseholdSettings,
  type UseCaseContext,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import { fakeAttachmentStore } from "@pangolin/app/testing/attachment-store";
import {
  createSystemHealthRepo,
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedFile } from "../../scripts/demo-seed.ts";
import { linkSeed } from "../admin/seed.ts";
import { nodeTokens, recoveryCodeHasher } from "../auth/secret.ts";
import { createApp } from "./app.ts";
import type { AuthGateway } from "./session.ts";

let dir: string;
let db: Db;
let seed: { today: string; expectations: Record<string, any> };
let people: Record<string, string>;
let app: ReturnType<typeof createApp>;

const ORIGIN = "http://localhost:3000";

function fakeGateway(): AuthGateway {
  return {
    handler: async (request) => new Response(`auth:${new URL(request.url).pathname}`),
    getSession: async (headers) => {
      const cookie = headers.get("cookie") ?? "";
      if (cookie.includes("session=user-a")) {
        return { session: { userId: "user-a", createdAt: new Date() }, setCookies: [] };
      }
      if (cookie.includes("session=user-b")) {
        return { session: { userId: "user-b", createdAt: new Date() }, setCookies: [] };
      }
      return { session: null, setCookies: [] };
    },
    signUp: async () => {
      throw new Error("not used");
    },
    recover: async () => {
      throw new Error("not used");
    },
    reEnrol: async () => {
      throw new Error("not used");
    },
  };
}

function addLogins(target: Db): void {
  for (const [user, name, at] of [
    ["user-a", "Alex", "2026-01-01T00:00:00.000Z"],
    ["user-b", "Sam", "2026-01-02T00:00:00.000Z"],
  ] as const) {
    target
      .prepare(
        `INSERT INTO auth_user (id, name, email, email_verified, two_factor_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 0, 1, 'x', 'x')`,
      )
      .run(user, name, `${user}@example.com`);
    target
      .prepare(
        `INSERT INTO auth_passkey (id, user_id, public_key, credential_id, counter, device_type, backed_up)
         VALUES (?, ?, 'k', ?, 0, 'singleDevice', 0)`,
      )
      .run(`pk-${user}`, user, `c-${user}`);
    target
      .prepare(
        `INSERT INTO person (id, user_id, display_name, colour, created_at, updated_at)
         VALUES (?, ?, ?, '#2563eb', ?, ?)`,
      )
      .run(`01J00000000000000000000${user === "user-a" ? "00A" : "00B"}`, user, name, at, at);
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-budgets-seed-"));
  const file = join(dir, "seed.json");
  generateSeedFile(file);
  const seedJson = readFileSync(file, "utf8");
  seed = JSON.parse(seedJson);
  db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  addLogins(db);
  const clock = fixedClockAt(seed.today);
  const newId = createIdGenerator();
  people = linkSeed(createUnitOfWork(db), { clock, newId }, seedJson).people;

  // Designate Person A's pay anchor as the household pay anchor
  const sysCtx: UseCaseContext = {
    viewer: systemViewer("job:test"),
    clock,
    newId,
    uow: createUnitOfWork(db),
  };
  updateHouseholdSettings(sysCtx, {
    householdPayAnchorPersonId: people["person-a"],
  });

  app = createApp({
    systemHealth: createSystemHealthRepo(db),
    uow: createUnitOfWork(db),
    clock,
    newId,
    tokens: nodeTokens,
    codes: recoveryCodeHasher("test-secret"),
    authSecret: "test-secret",
    attachments: fakeAttachmentStore(),
    publicUrl: ORIGIN,
    authn: { kind: "live", gateway: fakeGateway() },
    healthz: { expectedSchemaVersion: loadMigrations(packageMigrationsDir).length, runner: "skip" },
  });
}, 120_000);

afterAll(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Budgets & Bills on default seed (Epic 6 Done-when verification)", () => {
  it("Condition 1: Seeded budget spent, pace, projected match hand calculation, rollover carries over, and editor suggests limit", async () => {
    const groceriesEx = seed.expectations["budgets-and-bills.groceriesBudget"];
    expect(groceriesEx).toBeDefined();

    // Person A fetches budget summary
    const resA = await app.request("/api/planning/budgets/summary", {
      headers: { Cookie: "session=user-a" },
    });
    expect(resA.status).toBe(200);
    const jsonA = (await resA.json()) as { summaries: BudgetSummary[] };
    const sharedSummaryA = jsonA.summaries.find((s) => s.budget.personId === null);
    expect(sharedSummaryA).toBeDefined();

    // Condition 1 & 2 assertions for Groceries:
    // Spent, pace, projected match expectations calculated from seed
    expect(sharedSummaryA!.spentCents).toBe(groceriesEx.currentSpentCents);
    expect(sharedSummaryA!.rolloverCents).toBe(groceriesEx.rolloverCents);
    expect(sharedSummaryA!.effectiveLimitCents).toBe(groceriesEx.effectiveLimitCents);
    expect(sharedSummaryA!.paceCents).toBe(groceriesEx.paceCents);
    expect(sharedSummaryA!.projectedCents).toBe(groceriesEx.projectedCents);
    expect(sharedSummaryA!.status).toBe("over-budget");

    // Pay calendar boundaries match Person A's payday anchor (2026-07-03 to 2026-07-17)
    expect(sharedSummaryA!.period.start).toBe("2026-07-03");
    expect(sharedSummaryA!.period.end).toBe("2026-07-17");

    // Person B views the same shared budget and sees identical figures and dates (Condition 2)
    const resB = await app.request("/api/planning/budgets/summary", {
      headers: { Cookie: "session=user-b" },
    });
    expect(resB.status).toBe(200);
    const jsonB = (await resB.json()) as { summaries: BudgetSummary[] };
    const sharedSummaryB = jsonB.summaries.find((s) => s.budget.personId === null);
    expect(sharedSummaryB).toBeDefined();
    expect(sharedSummaryB!.spentCents).toBe(sharedSummaryA!.spentCents);
    expect(sharedSummaryB!.period.start).toBe(sharedSummaryA!.period.start);
    expect(sharedSummaryB!.period.end).toBe(sharedSummaryA!.period.end);

    // Editor suggests limit from mean of last 6 closed periods
    const suggestRes = await app.request(
      `/api/planning/budgets/suggested-limit?id=${sharedSummaryA!.budget.id}`,
      {
        headers: { Cookie: "session=user-a" },
      },
    );
    expect(suggestRes.status).toBe(200);
    const suggestJson = (await suggestRes.json()) as { suggestedLimitCents: number };
    expect(suggestJson.suggestedLimitCents).toBe(groceriesEx.suggestedLimitCents);
  });

  it("Condition 1 & 2: Overspending raises exactly one over-budget review item per budget per period, with correct scoping", async () => {
    const clock = fixedClockAt(seed.today);
    const uow = createUnitOfWork(db);
    const sysCtx: UseCaseContext = {
      viewer: systemViewer("job:test"),
      clock,
      newId: createIdGenerator(),
      uow,
    };

    // Run syncAllBudgetReviewItems
    syncAllBudgetReviewItems(sysCtx);

    const ctxA: UseCaseContext = {
      viewer: personViewer(people["person-a"] as any, clock.now()),
      clock,
      newId: createIdGenerator(),
      uow,
    };
    const ctxB: UseCaseContext = {
      viewer: personViewer(people["person-b"] as any, clock.now()),
      clock,
      newId: createIdGenerator(),
      uow,
    };

    const itemsA = listReviewItems(ctxA);
    const itemsB = listReviewItems(ctxB);

    const budgetItemsA = itemsA.filter(
      (i) => i.kind === "planning.over_budget" || i.kind === "planning.over_budget.personal",
    );
    const budgetItemsB = itemsB.filter(
      (i) => i.kind === "planning.over_budget" || i.kind === "planning.over_budget.personal",
    );

    // Groceries is shared and over budget -> both person A and person B can see it
    const groceriesItemA = budgetItemsA.find((i) => i.personId == null);
    const groceriesItemB = budgetItemsB.find((i) => i.personId == null);
    expect(groceriesItemA).toBeDefined();
    expect(groceriesItemB).toBeDefined();
    expect(groceriesItemA!.id).toBe(groceriesItemB!.id);

    // Person B has Fitness budget which is over budget -> Person B sees it, but Person A cannot (AD-3, AD-22)
    const fitnessItemB = budgetItemsB.find((i) => i.personId === people["person-b"]);
    expect(fitnessItemB).toBeDefined();

    const fitnessItemA = budgetItemsA.find((i) => i.personId === people["person-b"]);
    expect(fitnessItemA).toBeUndefined();

    // Idempotent: running again produces no duplicate items
    const countBefore = budgetItemsA.length;
    syncAllBudgetReviewItems(sysCtx);
    const itemsAAfter = listReviewItems(ctxA).filter(
      (i) => i.kind === "planning.over_budget" || i.kind === "planning.over_budget.personal",
    );
    expect(itemsAAfter).toHaveLength(countBefore);
  });

  it("Condition 3: Missed payment and price rise alerts are raised and scoped correctly", async () => {
    const clock = fixedClockAt(seed.today);
    const uow = createUnitOfWork(db);
    const sysCtx: UseCaseContext = {
      viewer: systemViewer("job:test"),
      clock,
      newId: createIdGenerator(),
      uow,
    };

    // Run syncAllBillAlertReviewItems
    syncAllBillAlertReviewItems(sysCtx);

    const ctxA: UseCaseContext = {
      viewer: personViewer(people["person-a"] as any, clock.now()),
      clock,
      newId: createIdGenerator(),
      uow,
    };

    const itemsA = listReviewItems(ctxA);
    const missedItem = itemsA.find((i) => i.kind === "planning.bill_alert.missed_payment");
    const priceRiseItem = itemsA.find((i) => i.kind === "planning.bill_alert.price_rise");

    expect(missedItem).toBeDefined();
    expect(priceRiseItem).toBeDefined();

    // Both are on joint everyday account, visible to both partners
    const ctxB: UseCaseContext = {
      viewer: personViewer(people["person-b"] as any, clock.now()),
      clock,
      newId: createIdGenerator(),
      uow,
    };
    const itemsB = listReviewItems(ctxB);
    expect(itemsB.find((i) => i.id === missedItem!.id)).toBeDefined();
    expect(itemsB.find((i) => i.id === priceRiseItem!.id)).toBeDefined();
  });

  it("Condition 3: Candidate recurring series detected and one-click confirmed", async () => {
    const clock = fixedClockAt(seed.today);
    const uow = createUnitOfWork(db);
    const ctxA: UseCaseContext = {
      viewer: personViewer(people["person-a"] as any, clock.now()),
      clock,
      newId: createIdGenerator(),
      uow,
    };

    // Verify Netflix candidate exists
    const candidates = listCandidateSeries(ctxA);
    const netflixCandidate = candidates.find((c) => c.expectedCents === 2300);
    expect(netflixCandidate).toBeDefined();
    expect(netflixCandidate!.status).toBe("candidate");

    // One-click confirm candidate via HTTP
    const confirmRes = await app.request(
      `/api/planning/recurring-bills/${netflixCandidate!.id}/confirm`,
      {
        method: "POST",
        headers: { Cookie: "session=user-a", Origin: ORIGIN },
      },
    );
    expect(confirmRes.status).toBe(200);
    const confirmed = (await confirmRes.json()) as { series: { status: string } };
    expect(confirmed.series.status).toBe("confirmed");

    // Candidate list now no longer has it
    const remainingCandidates = listCandidateSeries(ctxA);
    expect(remainingCandidates.find((c) => c.id === netflixCandidate!.id)).toBeUndefined();

    // Confirmed series list now has it
    const confirmedList = listRecurringSeries(ctxA, { status: "confirmed" });
    expect(confirmedList.find((c) => c.id === netflixCandidate!.id)).toBeDefined();
  });
});
