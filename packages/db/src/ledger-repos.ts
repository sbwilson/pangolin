import type {
  AccountOwnerRow,
  AccountRepo,
  AccountRow,
  SplitRow,
  TransactionRepo,
  TransactionRow,
  TransactionWithSplits,
} from "@pangolin/app";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { visibleAccounts, visibleTxn } from "./privacy.ts";
import { account } from "./schema/account.ts";
import { accountOwner } from "./schema/account-owner.ts";
import { split } from "./schema/split.ts";
import { transaction } from "./schema/transaction.ts";

type Orm = BetterSQLite3Database;

/** The `account` and `account_owner` repository. `check` throws once the transaction has ended. */
export function createAccountRepo(orm: Orm, check: () => void): AccountRepo {
  return {
    insert: (row, owners) => {
      check();
      orm.insert(account).values(row).run();
      if (owners.length > 0)
        orm
          .insert(accountOwner)
          .values([...owners])
          .run();
    },

    findVisible: (viewer, id) => {
      const visible = visibleAccounts(viewer);
      check();
      return orm
        .select({
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          isPrivate: account.isPrivate,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .from(account)
        .where(and(eq(account.id, id), isNull(account.deletedAt), visible))
        .get() as AccountRow | undefined;
    },

    any: () => {
      check();
      return orm.select({ id: account.id }).from(account).limit(1).get() !== undefined;
    },

    owners: (accountId) => {
      check();
      return orm
        .select()
        .from(accountOwner)
        .where(eq(accountOwner.accountId, accountId))
        .orderBy(asc(accountOwner.createdAt), asc(accountOwner.personId))
        .all() as AccountOwnerRow[];
    },
  };
}

/** The `transaction` and `split` repository. */
export function createTransactionRepo(orm: Orm, check: () => void): TransactionRepo {
  return {
    insert: (row: TransactionRow, splits: readonly SplitRow[]) => {
      check();
      orm.insert(transaction).values(row).run();
      if (splits.length > 0) {
        orm
          .insert(split)
          .values(splits.map((s) => ({ ...s })))
          .run();
      }
    },

    listVisible: (viewer) => {
      const visible = visibleTxn(viewer);
      check();
      const rows = orm
        .select({
          id: transaction.id,
          accountId: transaction.accountId,
          postedOn: transaction.postedOn,
          amountCents: transaction.amountCents,
          descriptionRaw: transaction.descriptionRaw,
          status: transaction.status,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
        })
        .from(transaction)
        .where(and(isNull(transaction.deletedAt), visible))
        .orderBy(desc(transaction.postedOn), desc(transaction.id))
        .all() as TransactionRow[];
      if (rows.length === 0) return [];
      const splits = new Map<string, SplitRow[]>();
      // Chunked: SQLite caps the number of bound parameters.
      for (let i = 0; i < rows.length; i += 500) {
        const ids = rows.slice(i, i + 500).map((row) => row.id);
        const found = orm
          .select({
            id: split.id,
            transactionId: split.transactionId,
            amountCents: split.amountCents,
            beneficiary: split.beneficiary,
            memo: split.memo,
            createdAt: split.createdAt,
            updatedAt: split.updatedAt,
          })
          .from(split)
          .where(inArray(split.transactionId, ids))
          .orderBy(asc(split.id))
          .all() as SplitRow[];
        for (const s of found) {
          const list = splits.get(s.transactionId) ?? [];
          list.push(s);
          splits.set(s.transactionId, list);
        }
      }
      return rows.map(
        (row): TransactionWithSplits => ({ ...row, splits: splits.get(row.id) ?? [] }),
      );
    },
  };
}
