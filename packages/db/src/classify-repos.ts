import type {
  ActivityRepo,
  ActivityRow,
  CategoryGroupRepo,
  CategoryGroupRow,
  CategoryRepo,
  CategoryRow,
  PayeeAliasRepo,
  PayeeAliasRow,
  PayeeRepo,
  PayeeRow,
  SplitTagged,
  TagRepo,
  TagRow,
  TaxCategoryRepo,
  TaxCategoryRow,
} from "@pangolin/app";
import type { Id } from "@pangolin/shared";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { requireViewer, visibleScope, visibleTxnId } from "./privacy.ts";
import { activity } from "./schema/activity.ts";
import { category } from "./schema/category.ts";
import { categoryGroup } from "./schema/category-group.ts";
import { payee } from "./schema/payee.ts";
import { payeeAlias } from "./schema/payee-alias.ts";
import { split } from "./schema/split.ts";
import { splitTag } from "./schema/split-tag.ts";
import { tag } from "./schema/tag.ts";
import { taxCategory } from "./schema/tax-category.ts";
import { optimizeSearchIndex } from "./search-index.ts";

type Orm = BetterSQLite3Database;

/** The `category_group` repository (no soft delete). */
export function createCategoryGroupRepo(orm: Orm, check: () => void): CategoryGroupRepo {
  const columns = {
    id: categoryGroup.id,
    name: categoryGroup.name,
    kind: categoryGroup.kind,
    sort: categoryGroup.sort,
    createdAt: categoryGroup.createdAt,
    updatedAt: categoryGroup.updatedAt,
  };
  return {
    insert: (row) => {
      check();
      orm.insert(categoryGroup).values(row).run();
    },
    update: (row) => {
      check();
      const changed = orm
        .update(categoryGroup)
        .set({ name: row.name, kind: row.kind, sort: row.sort, updatedAt: row.updatedAt })
        .where(eq(categoryGroup.id, row.id))
        .run().changes;
      if (changed !== 1) throw new Error(`Category group ${row.id} not found`);
    },
    find: (viewer, id) => {
      requireViewer(viewer, "categoryGroups.find");
      check();
      return orm.select(columns).from(categoryGroup).where(eq(categoryGroup.id, id)).get() as
        | CategoryGroupRow
        | undefined;
    },
    list: (viewer) => {
      requireViewer(viewer, "categoryGroups.list");
      check();
      return orm
        .select(columns)
        .from(categoryGroup)
        .orderBy(asc(categoryGroup.sort), asc(categoryGroup.name), asc(categoryGroup.id))
        .all() as CategoryGroupRow[];
    },
  };
}

/** The `category` repository. */
export function createCategoryRepo(orm: Orm, check: () => void): CategoryRepo {
  const columns = {
    id: category.id,
    groupId: category.groupId,
    name: category.name,
    isFixedCost: category.isFixedCost,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
  return {
    insert: (row) => {
      check();
      orm.insert(category).values(row).run();
    },
    update: (row) => {
      check();
      const changed = orm
        .update(category)
        .set({
          groupId: row.groupId,
          name: row.name,
          isFixedCost: row.isFixedCost,
          updatedAt: row.updatedAt,
        })
        .where(and(eq(category.id, row.id), isNull(category.deletedAt)))
        .run().changes;
      if (changed !== 1) throw new Error(`Category ${row.id} not found`);
    },
    find: (viewer, id) => {
      requireViewer(viewer, "categories.find");
      check();
      return orm
        .select(columns)
        .from(category)
        .where(and(eq(category.id, id), isNull(category.deletedAt)))
        .get() as CategoryRow | undefined;
    },
    list: (viewer) => {
      requireViewer(viewer, "categories.list");
      check();
      return orm
        .select(columns)
        .from(category)
        .where(isNull(category.deletedAt))
        .orderBy(asc(category.name), asc(category.id))
        .all() as CategoryRow[];
    },
    softDelete: (id, at) => {
      check();
      return (
        orm
          .update(category)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(category.id, id), isNull(category.deletedAt)))
          .run().changes === 1
      );
    },
  };
}

/** The `tax_category` repository (no soft delete). */
export function createTaxCategoryRepo(orm: Orm, check: () => void): TaxCategoryRepo {
  const columns = {
    id: taxCategory.id,
    code: taxCategory.code,
    label: taxCategory.label,
    defaultDeductibleBp: taxCategory.defaultDeductibleBp,
    createdAt: taxCategory.createdAt,
    updatedAt: taxCategory.updatedAt,
  };
  return {
    insert: (row) => {
      check();
      orm.insert(taxCategory).values(row).run();
    },
    update: (row) => {
      check();
      const changed = orm
        .update(taxCategory)
        .set({
          code: row.code,
          label: row.label,
          defaultDeductibleBp: row.defaultDeductibleBp,
          updatedAt: row.updatedAt,
        })
        .where(eq(taxCategory.id, row.id))
        .run().changes;
      if (changed !== 1) throw new Error(`Tax category ${row.id} not found`);
    },
    find: (viewer, id) => {
      requireViewer(viewer, "taxCategories.find");
      check();
      return orm.select(columns).from(taxCategory).where(eq(taxCategory.id, id)).get() as
        | TaxCategoryRow
        | undefined;
    },
    list: (viewer) => {
      requireViewer(viewer, "taxCategories.list");
      check();
      return orm
        .select(columns)
        .from(taxCategory)
        .orderBy(asc(taxCategory.code), asc(taxCategory.id))
        .all() as TaxCategoryRow[];
    },
  };
}

/** Code-point order, which is what SQLite's BINARY collation gives ULIDs and plain names. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The `tag` and `split_tag` repository. Reads compose `visibleScope`. */
export function createTagRepo(orm: Orm, check: () => void): TagRepo {
  const columns = {
    id: tag.id,
    name: tag.name,
    scopePersonId: tag.scopePersonId,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
  return {
    insert: (row, originAccountId) => {
      check();
      orm
        .insert(tag)
        .values({ ...row, originAccountId })
        .run();
    },
    find: (viewer, id) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(tag)
        .where(and(eq(tag.id, id), isNull(tag.deletedAt), scope))
        .get() as TagRow | undefined;
    },
    list: (viewer) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(tag)
        .where(and(isNull(tag.deletedAt), scope))
        .orderBy(asc(tag.name), asc(tag.id))
        .all() as TagRow[];
    },
    update: (viewer, row) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      check();
      return (
        orm
          .update(tag)
          .set({ name: row.name, updatedAt: row.updatedAt })
          .where(and(eq(tag.id, row.id), isNull(tag.deletedAt), scope))
          .run().changes === 1
      );
    },
    softDelete: (viewer, id, at) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      check();
      return (
        orm
          .update(tag)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(tag.id, id), isNull(tag.deletedAt), scope))
          .run().changes === 1
      );
    },
    originOf: (viewer, id) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      check();
      return orm
        .select({ origin: tag.originAccountId })
        .from(tag)
        .where(and(eq(tag.id, id), isNull(tag.deletedAt), scope))
        .get()?.origin as Id<"Account"> | null | undefined;
    },
    replaceForSplit: (viewer, splitId, tagIds, at) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      check();
      const wanted = new Set<string>(tagIds);
      const have = orm
        .select({ tagId: splitTag.tagId })
        .from(splitTag)
        .innerJoin(tag, eq(splitTag.tagId, tag.id))
        .where(and(eq(splitTag.splitId, splitId), isNull(tag.deletedAt), scope))
        .all()
        .map((r) => r.tagId);
      const drop = have.filter((id) => !wanted.has(id));
      if (drop.length > 0) {
        orm
          .delete(splitTag)
          .where(and(eq(splitTag.splitId, splitId), inArray(splitTag.tagId, drop)))
          .run();
      }
      const present = new Set(have);
      const add = [...wanted].filter((id) => !present.has(id));
      if (add.length > 0) {
        orm
          .insert(splitTag)
          .values(add.map((tagId) => ({ splitId, tagId, createdAt: at, updatedAt: at })))
          .run();
      }
    },
    listForSplits: (viewer, splitIds) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      const visible = visibleTxnId(split.transactionId, viewer);
      check();
      const out: SplitTagged[] = [];
      for (let i = 0; i < splitIds.length; i += 400) {
        const chunk = splitIds.slice(i, i + 400);
        const found = orm
          .select({
            splitId: splitTag.splitId,
            id: tag.id,
            name: tag.name,
            scopePersonId: tag.scopePersonId,
            createdAt: tag.createdAt,
            updatedAt: tag.updatedAt,
          })
          .from(splitTag)
          .innerJoin(tag, eq(splitTag.tagId, tag.id))
          .where(
            and(
              inArray(splitTag.splitId, chunk),
              isNull(tag.deletedAt),
              scope,
              inArray(splitTag.splitId, orm.select({ id: split.id }).from(split).where(visible)),
            ),
          )
          .all();
        for (const { splitId, ...row } of found) {
          out.push({ splitId: splitId as Id<"Split">, tag: row as TagRow });
        }
      }
      return out.sort(
        (a, b) =>
          cmp(a.splitId, b.splitId) || cmp(a.tag.name, b.tag.name) || cmp(a.tag.id, b.tag.id),
      );
    },
    listForSplit: (viewer, splitId) => {
      const scope = visibleScope(tag.scopePersonId, viewer);
      const visible = visibleTxnId(split.transactionId, viewer);
      check();
      return orm
        .select(columns)
        .from(tag)
        .where(
          and(
            isNull(tag.deletedAt),
            scope,
            inArray(
              tag.id,
              orm
                .select({ id: splitTag.tagId })
                .from(splitTag)
                .where(
                  and(
                    eq(splitTag.splitId, splitId),
                    inArray(
                      splitTag.splitId,
                      orm.select({ id: split.id }).from(split).where(visible),
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(tag.name), asc(tag.id))
        .all() as TagRow[];
    },
    deleteScopedTo: (personId) => {
      check();
      const mine = orm.select({ id: tag.id }).from(tag).where(eq(tag.scopePersonId, personId));
      orm.delete(splitTag).where(inArray(splitTag.tagId, mine)).run();
      const changes = orm.delete(tag).where(eq(tag.scopePersonId, personId)).run().changes;
      optimizeSearchIndex(orm);
      return changes;
    },
  };
}

/** The `activity` repository. Reads compose `visibleScope`. */
export function createActivityRepo(orm: Orm, check: () => void): ActivityRepo {
  const columns = {
    id: activity.id,
    name: activity.name,
    startsOn: activity.startsOn,
    endsOn: activity.endsOn,
    budgetCents: activity.budgetCents,
    scopePersonId: activity.scopePersonId,
    createdAt: activity.createdAt,
    updatedAt: activity.updatedAt,
  };
  return {
    insert: (row, originAccountId) => {
      check();
      orm
        .insert(activity)
        .values({ ...row, originAccountId })
        .run();
    },
    find: (viewer, id) => {
      const scope = visibleScope(activity.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(activity)
        .where(and(eq(activity.id, id), isNull(activity.deletedAt), scope))
        .get() as ActivityRow | undefined;
    },
    list: (viewer) => {
      const scope = visibleScope(activity.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(activity)
        .where(and(isNull(activity.deletedAt), scope))
        .orderBy(asc(activity.name), asc(activity.id))
        .all() as ActivityRow[];
    },
    update: (viewer, row) => {
      const scope = visibleScope(activity.scopePersonId, viewer);
      check();
      return (
        orm
          .update(activity)
          .set({
            name: row.name,
            startsOn: row.startsOn,
            endsOn: row.endsOn,
            budgetCents: row.budgetCents,
            updatedAt: row.updatedAt,
          })
          .where(and(eq(activity.id, row.id), isNull(activity.deletedAt), scope))
          .run().changes === 1
      );
    },
    softDelete: (viewer, id, at) => {
      const scope = visibleScope(activity.scopePersonId, viewer);
      check();
      return (
        orm
          .update(activity)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(activity.id, id), isNull(activity.deletedAt), scope))
          .run().changes === 1
      );
    },
    originOf: (viewer, id) => {
      const scope = visibleScope(activity.scopePersonId, viewer);
      check();
      return orm
        .select({ origin: activity.originAccountId })
        .from(activity)
        .where(and(eq(activity.id, id), isNull(activity.deletedAt), scope))
        .get()?.origin as Id<"Account"> | null | undefined;
    },
    deleteScopedTo: (personId) => {
      check();
      const mine = orm
        .select({ id: activity.id })
        .from(activity)
        .where(eq(activity.scopePersonId, personId));
      orm.update(split).set({ activityId: null }).where(inArray(split.activityId, mine)).run();
      return orm.delete(activity).where(eq(activity.scopePersonId, personId)).run().changes;
    },
  };
}

/** The `payee` repository. Reads compose `visibleScope`. */
export function createPayeeRepo(orm: Orm, check: () => void): PayeeRepo {
  const columns = {
    id: payee.id,
    name: payee.name,
    websiteUrl: payee.websiteUrl,
    logoAttachmentId: payee.logoAttachmentId,
    defaultCategoryId: payee.defaultCategoryId,
    scopePersonId: payee.scopePersonId,
    createdAt: payee.createdAt,
    updatedAt: payee.updatedAt,
  };
  return {
    insert: (row, originAccountId) => {
      check();
      orm
        .insert(payee)
        .values({ ...row, originAccountId })
        .run();
    },
    clearDefaultCategory: (categoryId, at) => {
      check();
      const live = and(eq(payee.defaultCategoryId, categoryId), isNull(payee.deletedAt));
      const before = orm
        .select({ ...columns, origin: payee.originAccountId })
        .from(payee)
        .where(live)
        .orderBy(asc(payee.id))
        .all();
      orm.update(payee).set({ defaultCategoryId: null, updatedAt: at }).where(live).run();
      return before.map(({ origin, ...row }) => ({
        before: row as PayeeRow,
        originAccountId: origin as Id<"Account"> | null,
      }));
    },
    find: (viewer, id) => {
      const scope = visibleScope(payee.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(payee)
        .where(and(eq(payee.id, id), isNull(payee.deletedAt), scope))
        .get() as PayeeRow | undefined;
    },
    list: (viewer) => {
      const scope = visibleScope(payee.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(payee)
        .where(and(isNull(payee.deletedAt), scope))
        .orderBy(asc(payee.name), asc(payee.id))
        .all() as PayeeRow[];
    },
    update: (viewer, row) => {
      const scope = visibleScope(payee.scopePersonId, viewer);
      check();
      return (
        orm
          .update(payee)
          .set({
            name: row.name,
            websiteUrl: row.websiteUrl,
            defaultCategoryId: row.defaultCategoryId,
            updatedAt: row.updatedAt,
          })
          .where(and(eq(payee.id, row.id), isNull(payee.deletedAt), scope))
          .run().changes === 1
      );
    },
    softDelete: (viewer, id, at) => {
      const scope = visibleScope(payee.scopePersonId, viewer);
      check();
      return (
        orm
          .update(payee)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(payee.id, id), isNull(payee.deletedAt), scope))
          .run().changes === 1
      );
    },
    originOf: (viewer, id) => {
      const scope = visibleScope(payee.scopePersonId, viewer);
      check();
      return orm
        .select({ origin: payee.originAccountId })
        .from(payee)
        .where(and(eq(payee.id, id), isNull(payee.deletedAt), scope))
        .get()?.origin as Id<"Account"> | null | undefined;
    },
    deleteScopedTo: (personId) => {
      check();
      const changes = orm.delete(payee).where(eq(payee.scopePersonId, personId)).run().changes;
      optimizeSearchIndex(orm);
      return changes;
    },
  };
}

/** The `payee_alias` repository. Reads compose `visibleScope`. */
export function createPayeeAliasRepo(orm: Orm, check: () => void): PayeeAliasRepo {
  const columns = {
    id: payeeAlias.id,
    pattern: payeeAlias.pattern,
    matchKind: payeeAlias.matchKind,
    payeeId: payeeAlias.payeeId,
    scopePersonId: payeeAlias.scopePersonId,
    createdAt: payeeAlias.createdAt,
    updatedAt: payeeAlias.updatedAt,
  };
  return {
    insert: (row, originAccountId) => {
      check();
      orm
        .insert(payeeAlias)
        .values({ ...row, originAccountId })
        .run();
    },
    softDeleteForPayee: (payeeId, at) => {
      check();
      const live = and(eq(payeeAlias.payeeId, payeeId), isNull(payeeAlias.deletedAt));
      const before = orm
        .select({ ...columns, origin: payeeAlias.originAccountId })
        .from(payeeAlias)
        .where(live)
        .orderBy(asc(payeeAlias.id))
        .all();
      orm.update(payeeAlias).set({ deletedAt: at, updatedAt: at }).where(live).run();
      return before.map(({ origin, ...row }) => ({
        before: row as PayeeAliasRow,
        originAccountId: origin as Id<"Account"> | null,
      }));
    },
    find: (viewer, id) => {
      const scope = visibleScope(payeeAlias.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(payeeAlias)
        .where(and(eq(payeeAlias.id, id), isNull(payeeAlias.deletedAt), scope))
        .get() as PayeeAliasRow | undefined;
    },
    list: (viewer) => {
      const scope = visibleScope(payeeAlias.scopePersonId, viewer);
      check();
      return orm
        .select(columns)
        .from(payeeAlias)
        .where(and(isNull(payeeAlias.deletedAt), scope))
        .orderBy(asc(payeeAlias.pattern), asc(payeeAlias.id))
        .all() as PayeeAliasRow[];
    },
    update: (viewer, row) => {
      const scope = visibleScope(payeeAlias.scopePersonId, viewer);
      check();
      return (
        orm
          .update(payeeAlias)
          .set({ pattern: row.pattern, matchKind: row.matchKind, updatedAt: row.updatedAt })
          .where(and(eq(payeeAlias.id, row.id), isNull(payeeAlias.deletedAt), scope))
          .run().changes === 1
      );
    },
    softDelete: (viewer, id, at) => {
      const scope = visibleScope(payeeAlias.scopePersonId, viewer);
      check();
      return (
        orm
          .update(payeeAlias)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(payeeAlias.id, id), isNull(payeeAlias.deletedAt), scope))
          .run().changes === 1
      );
    },
    originOf: (viewer, id) => {
      const scope = visibleScope(payeeAlias.scopePersonId, viewer);
      check();
      return orm
        .select({ origin: payeeAlias.originAccountId })
        .from(payeeAlias)
        .where(and(eq(payeeAlias.id, id), isNull(payeeAlias.deletedAt), scope))
        .get()?.origin as Id<"Account"> | null | undefined;
    },
    deleteScopedTo: (personId) => {
      check();
      const mine = orm
        .select({ id: payee.id })
        .from(payee)
        .where(eq(payee.scopePersonId, personId));
      return orm
        .delete(payeeAlias)
        .where(or(eq(payeeAlias.scopePersonId, personId), inArray(payeeAlias.payeeId, mine)))
        .run().changes;
    },
  };
}
