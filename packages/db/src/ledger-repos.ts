import type {
  AccountOwnerRow,
  AccountRepo,
  AccountRow,
  BalanceSnapshotRepo,
  BalanceSnapshotRow,
  InstitutionRepo,
  InstitutionRow,
  OwnedAccount,
  SplitRow,
  TransactionRepo,
  TransactionRow,
  TransferGroupRepo,
  TransferGroupRow,
  VisibleTransaction,
} from "@pangolin/app";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { balanceAsOf } from "./balance.ts";
import type { Db } from "./open.ts";
import {
  liveVisibleTxn,
  requireViewer,
  type TxnProjection,
  visibleAccounts,
  visibleTxn,
} from "./privacy.ts";
import { account } from "./schema/account.ts";
import { accountOwner } from "./schema/account-owner.ts";
import { activity } from "./schema/activity.ts";
import { balanceSnapshot } from "./schema/balance-snapshot.ts";
import { institution } from "./schema/institution.ts";
import { payee } from "./schema/payee.ts";
import { split } from "./schema/split.ts";
import { splitTag } from "./schema/split-tag.ts";
import { tag } from "./schema/tag.ts";
import { transaction } from "./schema/transaction.ts";
import { transferGroup } from "./schema/transfer-group.ts";

type Orm = BetterSQLite3Database;
/** An `Orm` that also hands out its connection, which the balance function runs on. */
type OrmWithClient = Orm & { readonly $client: Pick<Db, "prepare"> };

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

/** The columns of a transaction read: name fields come from the privacy projection (AD-4). */
function viewColumns(p: TxnProjection) {
  const {
    descriptionRaw: _d,
    payeeId: _p,
    fingerprint: _f,
    externalId: _e,
    ...plain
  } = transactionColumns;
  return {
    ...plain,
    descriptionRaw: p.descriptionRaw,
    fingerprint: p.fingerprint,
    externalId: p.externalId,
    payeeId: p.payeeId,
    payeeName: p.payeeName,
    logoAttachmentId: p.logoAttachmentId,
    nameHidden: p.hidden,
    transferLabel: p.transferLabel,
  };
}

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
  categorySource: split.categorySource,
  activitySource: split.activitySource,
  taxCategorySource: split.taxCategorySource,
  beneficiarySource: split.beneficiarySource,
  deductibleBpSource: split.deductibleBpSource,
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

    update: (row) => {
      check();
      const changed = orm
        .update(account)
        .set({
          name: row.name,
          isPrivate: row.isPrivate,
          institutionId: row.institutionId,
          openedOn: row.openedOn,
          closedOn: row.closedOn,
          isSavings: row.isSavings,
          updatedAt: row.updatedAt,
        })
        .where(and(eq(account.id, row.id), isNull(account.deletedAt)))
        .run().changes;
      if (changed !== 1) throw new Error(`Account ${row.id} not found`);
    },

    replaceOwners: (accountId, owners) => {
      check();
      orm.delete(accountOwner).where(eq(accountOwner.accountId, accountId)).run();
      if (owners.length > 0)
        orm
          .insert(accountOwner)
          .values([...owners])
          .run();
    },

    hasSplitForOthers: (accountId, ownerId) => {
      check();
      return (
        orm
          .select({ id: split.id })
          .from(split)
          .innerJoin(transaction, eq(split.transactionId, transaction.id))
          .where(
            and(
              eq(transaction.accountId, accountId),
              isNull(transaction.deletedAt),
              ne(split.beneficiary, ownerId),
            ),
          )
          .limit(1)
          .get() !== undefined
      );
    },

    scopedReferences: (accountId) => {
      check();
      // Live transactions only; a soft-deleted scoped row still counts while one uses it.
      const live = and(eq(transaction.accountId, accountId), isNull(transaction.deletedAt));
      const payees = orm
        .selectDistinct({ id: payee.id, name: payee.name })
        .from(transaction)
        .innerJoin(payee, eq(payee.id, transaction.payeeId))
        .where(and(live, isNotNull(payee.scopePersonId)))
        .orderBy(asc(payee.name), asc(payee.id))
        .all();
      const tags = orm
        .selectDistinct({ id: tag.id, name: tag.name })
        .from(splitTag)
        .innerJoin(split, eq(split.id, splitTag.splitId))
        .innerJoin(transaction, eq(transaction.id, split.transactionId))
        .innerJoin(tag, eq(tag.id, splitTag.tagId))
        .where(and(live, isNotNull(tag.scopePersonId)))
        .orderBy(asc(tag.name), asc(tag.id))
        .all();
      const activities = orm
        .selectDistinct({ id: activity.id, name: activity.name })
        .from(split)
        .innerJoin(transaction, eq(transaction.id, split.transactionId))
        .innerJoin(activity, eq(activity.id, split.activityId))
        .where(and(live, isNotNull(activity.scopePersonId)))
        .orderBy(asc(activity.name), asc(activity.id))
        .all();
      return { payees, tags, activities };
    },

    ownedBy: (personId) => {
      check();
      return orm
        .select({ ...accountColumns, deletedAt: account.deletedAt })
        .from(account)
        .where(
          inArray(
            account.id,
            orm
              .select({ id: accountOwner.accountId })
              .from(accountOwner)
              .where(eq(accountOwner.personId, personId)),
          ),
        )
        .orderBy(asc(account.createdAt), asc(account.id))
        .all()
        .map(
          ({ deletedAt, ...row }): OwnedAccount => ({
            row: row as AccountRow,
            deleted: deletedAt !== null,
          }),
        );
    },

    deleteRows: (accountId) => {
      check();
      orm.delete(accountOwner).where(eq(accountOwner.accountId, accountId)).run();
      orm.delete(account).where(eq(account.id, accountId)).run();
    },
  };
}

/** Attaches each transaction's splits, in chunks: SQLite caps the number of bound parameters. */
function withSplits<T extends { readonly id: string }>(
  orm: Orm,
  rows: T[],
): (T & { readonly splits: SplitRow[] })[] {
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
  return rows.map((row) => ({ ...row, splits: splits.get(row.id) ?? [] }));
}

/** SQLite hands the hidden flag back as 0 or 1. */
function toView(row: { nameHidden: unknown; [key: string]: unknown }): VisibleTransaction {
  return { ...row, nameHidden: Number(row.nameHidden) === 1 } as unknown as VisibleTransaction;
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

    findVisible: (viewer, id, today) => {
      const projection = visibleTxn(viewer, today);
      check();
      const row = orm
        .select(viewColumns(projection))
        .from(transaction)
        .where(and(eq(transaction.id, id), projection.where))
        .get();
      return row === undefined ? undefined : withSplits(orm, [toView(row)])[0];
    },

    findStored: (viewer, id) => {
      const visible = liveVisibleTxn(viewer);
      check();
      const row = orm
        .select(transactionColumns)
        .from(transaction)
        .where(and(eq(transaction.id, id), visible))
        .get() as TransactionRow | undefined;
      return row === undefined ? undefined : withSplits(orm, [row])[0];
    },

    update: (viewer, change) => {
      const visible = liveVisibleTxn(viewer);
      check();
      return (
        orm
          .update(transaction)
          .set({
            postedOn: change.postedOn,
            amountCents: change.amountCents,
            ...(change.descriptionRaw === undefined
              ? {}
              : { descriptionRaw: change.descriptionRaw }),
            notes: change.notes,
            updatedAt: change.updatedAt,
          })
          .where(and(eq(transaction.id, change.id), visible))
          .run().changes === 1
      );
    },

    updateSplitAmount: (splitId, amountCents, at) => {
      check();
      return (
        orm.update(split).set({ amountCents, updatedAt: at }).where(eq(split.id, splitId)).run()
          .changes === 1
      );
    },

    replaceSplits: (transactionId, splits) => {
      check();
      for (const s of splits) {
        if (s.transactionId !== transactionId) {
          throw new Error(`Split ${s.id} belongs to another transaction`);
        }
      }
      const keep = new Set<string>(splits.map((s) => s.id));
      const existing = orm
        .select({ id: split.id })
        .from(split)
        .where(eq(split.transactionId, transactionId))
        .all()
        .map((r) => r.id);
      const gone = existing.filter((id) => !keep.has(id));
      if (gone.length > 0) {
        orm.delete(splitTag).where(inArray(splitTag.splitId, gone)).run();
        orm.delete(split).where(inArray(split.id, gone)).run();
      }
      const present = new Set(existing);
      for (const { id, createdAt: _c, ...rest } of splits) {
        if (present.has(id)) orm.update(split).set(rest).where(eq(split.id, id)).run();
      }
      const fresh = splits.filter((s) => !present.has(s.id));
      if (fresh.length > 0)
        orm
          .insert(split)
          .values(fresh.map((s) => ({ ...s })))
          .run();
    },

    updateSplit: (row) => {
      check();
      const { id, createdAt: _c, transactionId: _t, ...rest } = row;
      return orm.update(split).set(rest).where(eq(split.id, id)).run().changes === 1;
    },

    setNeedsReview: (id, value, at) => {
      check();
      return (
        orm
          .update(transaction)
          .set({ needsReview: value, updatedAt: at })
          .where(and(eq(transaction.id, id), ne(transaction.needsReview, value)))
          .run().changes === 1
      );
    },

    setNameHidden: (viewer, id, by, until, at) => {
      const visible = liveVisibleTxn(viewer);
      check();
      return (
        orm
          .update(transaction)
          .set({ nameHiddenBy: by, nameHiddenUntil: until, updatedAt: at })
          .where(and(eq(transaction.id, id), visible))
          .run().changes === 1
      );
    },

    setTransferGroup: (ids, groupId, at) => {
      check();
      let changed = 0;
      for (let i = 0; i < ids.length; i += 500) {
        changed += orm
          .update(transaction)
          .set({ transferGroupId: groupId, updatedAt: at })
          .where(inArray(transaction.id, ids.slice(i, i + 500) as string[]))
          .run().changes;
      }
      return changed;
    },

    softDelete: (viewer, id, at) => {
      const visible = liveVisibleTxn(viewer);
      check();
      return (
        orm
          .update(transaction)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(transaction.id, id), visible))
          .run().changes === 1
      );
    },

    latestPostedOn: (viewer, accountId) => {
      const visible = liveVisibleTxn(viewer);
      check();
      const row = orm
        .select({ postedOn: transaction.postedOn })
        .from(transaction)
        .where(and(eq(transaction.accountId, accountId), visible))
        .orderBy(desc(transaction.postedOn))
        .limit(1)
        .get();
      return row?.postedOn;
    },

    listManualAfter: (viewer, accountId, day, limit) => {
      const visible = liveVisibleTxn(viewer);
      check();
      const after = and(
        eq(transaction.accountId, accountId),
        gt(transaction.postedOn, day),
        visible,
      );
      const manual = and(isNull(transaction.importId), isNull(transaction.externalId));
      const rows = orm
        .select({ id: transaction.id, postedOn: transaction.postedOn })
        .from(transaction)
        .where(and(after, manual))
        .orderBy(asc(transaction.postedOn), asc(transaction.id))
        .limit(limit)
        .all();
      const imported = orm
        .select({ n: count() })
        .from(transaction)
        .where(and(after, or(isNotNull(transaction.importId), isNotNull(transaction.externalId))))
        .get();
      return { manual: rows, importedCount: imported?.n ?? 0 };
    },

    listVisible: (viewer, today) => {
      const projection = visibleTxn(viewer, today);
      check();
      const rows = orm
        .select(viewColumns(projection))
        .from(transaction)
        .where(projection.where)
        .orderBy(desc(transaction.postedOn), desc(transaction.id))
        .all();
      return withSplits(orm, rows.map(toView));
    },

    hidingsBy: (personId) => {
      check();
      const rows = orm
        .select(transactionColumns)
        .from(transaction)
        .where(eq(transaction.nameHiddenBy, personId))
        .orderBy(asc(transaction.id))
        .all() as TransactionRow[];
      return withSplits(orm, rows);
    },

    clearNameHidden: (ids, at) => {
      check();
      let changed = 0;
      for (let i = 0; i < ids.length; i += 500) {
        changed += orm
          .update(transaction)
          .set({ nameHiddenBy: null, nameHiddenUntil: null, updatedAt: at })
          .where(inArray(transaction.id, ids.slice(i, i + 500) as string[]))
          .run().changes;
      }
      return changed;
    },

    clearScopedPayees: (personId) => {
      check();
      return orm
        .update(transaction)
        .set({ payeeId: null })
        .where(
          inArray(
            transaction.payeeId,
            orm.select({ id: payee.id }).from(payee).where(eq(payee.scopePersonId, personId)),
          ),
        )
        .run().changes;
    },

    unlinkGroup: (groupId) => {
      check();
      return orm
        .update(transaction)
        .set({ transferGroupId: null })
        .where(eq(transaction.transferGroupId, groupId))
        .run().changes;
    },

    deleteForAccount: (accountId) => {
      check();
      const rows = orm
        .select({ id: transaction.id })
        .from(transaction)
        .where(eq(transaction.accountId, accountId));
      const splits = orm
        .select({ id: split.id })
        .from(split)
        .where(inArray(split.transactionId, rows));
      orm.delete(splitTag).where(inArray(splitTag.splitId, splits)).run();
      orm.delete(split).where(inArray(split.transactionId, rows)).run();
      orm.delete(transaction).where(eq(transaction.accountId, accountId)).run();
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
    update: (row) => {
      check();
      const changed = orm
        .update(institution)
        .set({
          name: row.name,
          kind: row.kind,
          websiteUrl: row.websiteUrl,
          updatedAt: row.updatedAt,
        })
        .where(and(eq(institution.id, row.id), isNull(institution.deletedAt)))
        .run().changes;
      if (changed !== 1) throw new Error(`Institution ${row.id} not found`);
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
export function createBalanceSnapshotRepo(
  orm: OrmWithClient,
  check: () => void,
): BalanceSnapshotRepo {
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
    balanceAsOf: (viewer, accountId, date) => {
      const visible = visibleAccounts(viewer);
      check();
      const seen = orm
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.id, accountId), visible))
        .get();
      return seen === undefined ? undefined : balanceAsOf(orm.$client, accountId, date);
    },
    deleteForAccount: (accountId) => {
      check();
      return orm.delete(balanceSnapshot).where(eq(balanceSnapshot.accountId, accountId)).run()
        .changes;
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
      const visible = liveVisibleTxn(viewer);
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
                .where(and(isNotNull(transaction.transferGroupId), visible)),
            ),
          ),
        )
        .get() as TransferGroupRow | undefined;
    },
    delete: (id) => {
      check();
      return orm.delete(transferGroup).where(eq(transferGroup.id, id)).run().changes === 1;
    },
    members: (viewer, id) => {
      const visible = liveVisibleTxn(viewer);
      check();
      const rows = orm
        .select(transactionColumns)
        .from(transaction)
        .where(and(eq(transaction.transferGroupId, id), visible))
        .orderBy(asc(transaction.id))
        .all() as TransactionRow[];
      const live = orm
        .select({ id: transaction.id })
        .from(transaction)
        .where(and(eq(transaction.transferGroupId, id), isNull(transaction.deletedAt)))
        .all().length;
      return { rows, hidden: live - rows.length };
    },
    upkeepMembers: (id) => {
      check();
      return orm
        .select(transactionColumns)
        .from(transaction)
        .where(and(eq(transaction.transferGroupId, id), isNull(transaction.deletedAt)))
        .orderBy(asc(transaction.id))
        .all() as TransactionRow[];
    },
    idsInAccount: (accountId) => {
      check();
      return orm
        .selectDistinct({ id: transaction.transferGroupId })
        .from(transaction)
        .where(and(eq(transaction.accountId, accountId), isNotNull(transaction.transferGroupId)))
        .orderBy(asc(transaction.transferGroupId))
        .all()
        .map((row) => row.id as string);
    },
  };
}
