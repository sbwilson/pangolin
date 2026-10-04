import type {
  AccountOwnerRow,
  AccountRepo,
  AccountRow,
  BalanceSnapshotRepo,
  BalanceSnapshotRow,
  InstitutionRepo,
  InstitutionRow,
  SplitRow,
  TransactionRepo,
  TransactionRow,
  TransactionWithSplits,
  TransferGroupRepo,
  TransferGroupRow,
} from "@pangolin/app";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { requireViewer, visibleAccounts, visibleTxn } from "./privacy.ts";
import { account } from "./schema/account.ts";
import { accountOwner } from "./schema/account-owner.ts";
import { balanceSnapshot } from "./schema/balance-snapshot.ts";
import { institution } from "./schema/institution.ts";
import { split } from "./schema/split.ts";
import { transaction } from "./schema/transaction.ts";
import { transferGroup } from "./schema/transfer-group.ts";

type Orm = BetterSQLite3Database;

const accountColumns = {
  id: account.id,
  name: account.name,
  type: account.type,
  currency: account.currency,
  isPrivate: account.isPrivate,
  institutionId: account.institutionId,
  openedOn: account.openedOn,
  closedOn: account.closedOn,
  isSavings: account.isSavings,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
};

const transactionColumns = {
  id: transaction.id,
  accountId: transaction.accountId,
  postedOn: transaction.postedOn,
  amountCents: transaction.amountCents,
  descriptionRaw: transaction.descriptionRaw,
  payeeId: transaction.payeeId,
  status: transaction.status,
  externalId: transaction.externalId,
  fingerprint: transaction.fingerprint,
  fingerprintVersion: transaction.fingerprintVersion,
  importId: transaction.importId,
  performedBy: transaction.performedBy,
  transferGroupId: transaction.transferGroupId,
  needsReview: transaction.needsReview,
  isHidden: transaction.isHidden,
  nameHiddenBy: transaction.nameHiddenBy,
  nameHiddenUntil: transaction.nameHiddenUntil,
  notes: transaction.notes,
  createdAt: transaction.createdAt,
  updatedAt: transaction.updatedAt,
};

const splitColumns = {
  id: split.id,
  transactionId: split.transactionId,
  amountCents: split.amountCents,
  categoryId: split.categoryId,
  activityId: split.activityId,
  beneficiary: split.beneficiary,
  propertyId: split.propertyId,
  taxCategoryId: split.taxCategoryId,
  deductibleBp: split.deductibleBp,
  memo: split.memo,
  createdAt: split.createdAt,
  updatedAt: split.updatedAt,
};

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
        .select(accountColumns)
        .from(account)
        .where(and(eq(account.id, id), isNull(account.deletedAt), visible))
        .get() as AccountRow | undefined;
    },

    list: (viewer) => {
      const visible = visibleAccounts(viewer);
      check();
      return orm
        .select(accountColumns)
        .from(account)
        .where(and(isNull(account.deletedAt), visible))
        .orderBy(asc(account.createdAt), asc(account.id))
        .all() as AccountRow[];
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

/** Attaches each transaction's splits, in chunks: SQLite caps the number of bound parameters. */
function withSplits(orm: Orm, rows: TransactionRow[]): TransactionWithSplits[] {
  if (rows.length === 0) return [];
  const splits = new Map<string, SplitRow[]>();
  for (let i = 0; i < rows.length; i += 500) {
    const ids = rows.slice(i, i + 500).map((row) => row.id);
    const found = orm
      .select(splitColumns)
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
  return rows.map((row): TransactionWithSplits => ({ ...row, splits: splits.get(row.id) ?? [] }));
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

    findVisible: (viewer, id) => {
      const visible = visibleTxn(viewer);
      check();
      const row = orm
        .select(transactionColumns)
        .from(transaction)
        .where(and(eq(transaction.id, id), isNull(transaction.deletedAt), visible))
        .get() as TransactionRow | undefined;
      return row === undefined ? undefined : withSplits(orm, [row])[0];
    },

    softDelete: (viewer, id, at) => {
      const visible = visibleTxn(viewer);
      check();
      return (
        orm
          .update(transaction)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(transaction.id, id), isNull(transaction.deletedAt), visible))
          .run().changes === 1
      );
    },

    listVisible: (viewer) => {
      const visible = visibleTxn(viewer);
      check();
      const rows = orm
        .select(transactionColumns)
        .from(transaction)
        .where(and(isNull(transaction.deletedAt), visible))
        .orderBy(desc(transaction.postedOn), desc(transaction.id))
        .all() as TransactionRow[];
      return withSplits(orm, rows);
    },
  };
}

/** The `institution` repository. */
export function createInstitutionRepo(orm: Orm, check: () => void): InstitutionRepo {
  const columns = {
    id: institution.id,
    name: institution.name,
    kind: institution.kind,
    websiteUrl: institution.websiteUrl,
    createdAt: institution.createdAt,
    updatedAt: institution.updatedAt,
  };
  return {
    insert: (row) => {
      check();
      orm.insert(institution).values(row).run();
    },
    find: (viewer, id) => {
      requireViewer(viewer, "institutions.find");
      check();
      return orm
        .select(columns)
        .from(institution)
        .where(and(eq(institution.id, id), isNull(institution.deletedAt)))
        .get() as InstitutionRow | undefined;
    },
    list: (viewer) => {
      requireViewer(viewer, "institutions.list");
      check();
      return orm
        .select(columns)
        .from(institution)
        .where(isNull(institution.deletedAt))
        .orderBy(asc(institution.name), asc(institution.id))
        .all() as InstitutionRow[];
    },
    softDelete: (id, at) => {
      check();
      return (
        orm
          .update(institution)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(institution.id, id), isNull(institution.deletedAt)))
          .run().changes === 1
      );
    },
  };
}

/** The `balance_snapshot` repository: reads compose `visibleAccounts`. */
export function createBalanceSnapshotRepo(orm: Orm, check: () => void): BalanceSnapshotRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(balanceSnapshot).values(row).run();
    },
    listVisible: (viewer, accountId) => {
      const visible = visibleAccounts(viewer);
      check();
      return orm
        .select({
          id: balanceSnapshot.id,
          accountId: balanceSnapshot.accountId,
          asOf: balanceSnapshot.asOf,
          balanceCents: balanceSnapshot.balanceCents,
          source: balanceSnapshot.source,
          createdAt: balanceSnapshot.createdAt,
          updatedAt: balanceSnapshot.updatedAt,
        })
        .from(balanceSnapshot)
        .where(
          and(
            eq(balanceSnapshot.accountId, accountId),
            inArray(
              balanceSnapshot.accountId,
              orm
                .select({ id: account.id })
                .from(account)
                .where(and(isNull(account.deletedAt), visible)),
            ),
          ),
        )
        .orderBy(desc(balanceSnapshot.asOf), desc(balanceSnapshot.id))
        .all() as BalanceSnapshotRow[];
    },
  };
}

/** The `transfer_group` repository: a group is visible through its visible transactions. */
export function createTransferGroupRepo(orm: Orm, check: () => void): TransferGroupRepo {
  return {
    insert: (row) => {
      check();
      orm.insert(transferGroup).values(row).run();
    },
    find: (viewer, id) => {
      const visible = visibleTxn(viewer);
      check();
      return orm
        .select({
          id: transferGroup.id,
          matchedBy: transferGroup.matchedBy,
          createdAt: transferGroup.createdAt,
          updatedAt: transferGroup.updatedAt,
        })
        .from(transferGroup)
        .where(
          and(
            eq(transferGroup.id, id),
            inArray(
              transferGroup.id,
              orm
                .select({ id: transaction.transferGroupId })
                .from(transaction)
                .where(
                  and(
                    isNotNull(transaction.transferGroupId),
                    isNull(transaction.deletedAt),
                    visible,
                  ),
                ),
            ),
          ),
        )
        .get() as TransferGroupRow | undefined;
    },
  };
}
