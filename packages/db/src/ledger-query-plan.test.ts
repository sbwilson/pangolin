import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemViewer } from "@pangolin/app/system-viewer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, packageMigrationsDir } from "./migrate.ts";
import { type Db, openDatabase } from "./open.ts";
import { createUnitOfWork } from "./unit-of-work.ts";

let dir: string;
let db: Db;

function explainPlan(database: Db, fn: () => void): { detail: string }[] {
  let capturedSql: string | undefined;
  let capturedParams: unknown[] = [];
  const origPrepare = database.prepare.bind(database);
  (database as unknown as { prepare: unknown }).prepare = (sql: string) => {
    const stmt = origPrepare(sql);
    if (sql.includes('from "transaction"') || sql.includes("from `transaction`")) {
      capturedSql = sql;
      const origAll = stmt.all.bind(stmt);
      stmt.all = (...params: unknown[]) => {
        capturedParams = params;
        return origAll(...params);
      };
      const origGet = stmt.get.bind(stmt);
      stmt.get = (...params: unknown[]) => {
        capturedParams = params;
        return origGet(...params);
      };
    }
    return stmt;
  };
  try {
    fn();
  } finally {
    database.prepare = origPrepare;
  }
  if (!capturedSql) throw new Error("No transaction query was captured");
  return database.prepare(`EXPLAIN QUERY PLAN ${capturedSql}`).all(...capturedParams) as {
    detail: string;
  }[];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-query-plan-"));
  db = openDatabase(join(dir, "plan.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("transaction list query plans", () => {
  const viewer = systemViewer("cli:query-plan-test");
  const today = "2026-07-15";

  describe("sort and paging", () => {
    it("walks transaction_posted_id_idx without temp B-tree on unfiltered first page", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) => r.transactions.listPage(viewer, today, {}, { offset: 0 }, 50));
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses keyset cursor directly on transaction_posted_id_idx after a cursor", () => {
      const uow = createUnitOfWork(db);
      const cursor = { postedOn: "2026-06-01", id: "01J00000000000000000000001" };
      const plan = explainPlan(db, () => {
        uow.read((r) => r.transactions.listPage(viewer, today, {}, { after: cursor }, 50));
      });
      const details = plan.map((p) => p.detail);
      expect(
        details.some(
          (d) =>
            d.includes("INDEX transaction_posted_id_idx") && d.includes("(posted_on,id)<(?,?)"),
        ),
      ).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses keyset cursor directly on transaction_posted_id_idx before a cursor", () => {
      const uow = createUnitOfWork(db);
      const cursor = { postedOn: "2026-06-01", id: "01J00000000000000000000001" };
      const plan = explainPlan(db, () => {
        uow.read((r) => r.transactions.listPage(viewer, today, {}, { before: cursor }, 50));
      });
      const details = plan.map((p) => p.detail);
      expect(
        details.some(
          (d) =>
            d.includes("INDEX transaction_posted_id_idx") && d.includes("(posted_on,id)>(?,?)"),
        ),
      ).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("walks transaction_posted_id_idx without temp B-tree on OFFSET last-page jump", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) => r.transactions.listPage(viewer, today, {}, { offset: 49950 }, 50));
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("seeks range on transaction_posted_id_idx for date bounds without temp B-tree", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(
            viewer,
            today,
            { from: "2026-01-01", to: "2026-06-30" },
            { offset: 0 },
            50,
          ),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(
        details.some(
          (d) => d.includes("INDEX transaction_posted_id_idx") && d.includes("posted_on"),
        ),
      ).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("evaluates dayNets without temp B-tree for GROUP BY", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.dayNets(viewer, today, {}, ["2026-07-01", "2026-07-02", "2026-07-03"]),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });
  });

  describe("indexed filters", () => {
    it("uses transaction_account_posted_idx for accountId filter without temp B-tree", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { accountId: "acc-1" }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("INDEX transaction_account_posted_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses transaction_payee_idx for payeeId filter without temp B-tree", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { payeeId: "payee-1" }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("INDEX transaction_payee_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses covering split_transaction_idx for categoryId filter", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { categoryId: "cat-1" }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(
        details.some(
          (d) =>
            d.includes("COVERING INDEX split_transaction_idx") &&
            d.includes("transaction_id=? AND category_id=?"),
        ),
      ).toBe(true);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses covering split_transaction_idx for uncategorised filter", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { uncategorised: true }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(
        details.some(
          (d) =>
            d.includes("COVERING INDEX split_transaction_idx") &&
            d.includes("transaction_id=? AND category_id=?"),
        ),
      ).toBe(true);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses split_tag index for tagId filter", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { tagId: "tag-1" }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("split_tag") && d.includes("INDEX"))).toBe(true);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("walks transaction_posted_id_idx for transfers filter without temp B-tree", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { transfers: true }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("INDEX transaction_posted_id_idx"))).toBe(true);
      expect(details.some((d) => d.includes("USE TEMP B-TREE"))).toBe(false);
    });

    it("uses txn_fts virtual table for text search filter q", () => {
      const uow = createUnitOfWork(db);
      const plan = explainPlan(db, () => {
        uow.read((r) =>
          r.transactions.listPage(viewer, today, { q: "groceries" }, { offset: 0 }, 50),
        );
      });
      const details = plan.map((p) => p.detail);
      expect(details.some((d) => d.includes("txn_fts"))).toBe(true);
    });
  });
});
