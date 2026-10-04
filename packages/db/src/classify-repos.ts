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
  TagRepo,
  TagRow,
  TaxCategoryRepo,
  TaxCategoryRow,
} from "@pangolin/app";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
    softDelete: (id, at) => {
      check();
      return (
        orm
          .update(tag)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(tag.id, id), isNull(tag.deletedAt)))
          .run().changes === 1
      );
    },
    attach: (row) => {
      check();
      orm.insert(splitTag).values(row).run();
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
    softDelete: (id, at) => {
      check();
      return (
        orm
          .update(activity)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(activity.id, id), isNull(activity.deletedAt)))
          .run().changes === 1
      );
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
    softDelete: (id, at) => {
      check();
      return (
        orm
          .update(payee)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(payee.id, id), isNull(payee.deletedAt)))
          .run().changes === 1
      );
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
    softDelete: (id, at) => {
      check();
      return (
        orm
          .update(payeeAlias)
          .set({ deletedAt: at, updatedAt: at })
          .where(and(eq(payeeAlias.id, id), isNull(payeeAlias.deletedAt)))
          .run().changes === 1
      );
    },
  };
}
