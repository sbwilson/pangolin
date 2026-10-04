// The review inbox (AD-17): one stored list of things that need a person, owned by `system`.
// Epics raise and resolve items only through `raiseReviewItem` and `resolveReviewItem`.
import type { Id } from "@pangolin/shared";
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { ReviewItemRow, TxRepos } from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";
import type { Audit } from "../write.ts";

/** Who an item's kind is scoped to: an account (AD-3), one person, or the whole household. */
export type ReviewScope = "account" | "person" | "household";

export interface ReviewKind {
  /** `<module>.<name>`, e.g. `job.dead`. */
  readonly kind: string;
  /** The owning `app` module. */
  readonly module: string;
  readonly scope: ReviewScope;
}

const KIND_RE = /^[a-z0-9-]+\.[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;
const registry = new Map<string, ReviewKind>();

/**
 * Registers a review kind once (AD-17). Defining the same kind again with the same module and
 * scope returns the first definition; a different one throws `TypeError`.
 */
export function defineReviewKind(spec: ReviewKind): ReviewKind {
  if (!KIND_RE.test(spec.kind)) {
    throw new TypeError(`defineReviewKind: kind must look like module.name, got ${spec.kind}`);
  }
  if (!["account", "person", "household"].includes(spec.scope)) {
    throw new TypeError(`defineReviewKind: unknown scope ${String(spec.scope)}`);
  }
  const existing = registry.get(spec.kind);
  if (existing !== undefined) {
    if (existing.module === spec.module && existing.scope === spec.scope) return existing;
    throw new TypeError(`defineReviewKind: ${spec.kind} is already registered differently`);
  }
  const kind = Object.freeze({ kind: spec.kind, module: spec.module, scope: spec.scope });
  registry.set(kind.kind, kind);
  return kind;
}

/** A job that died and needs a person (AD-9). Household scope; entity `job:<id>`. */
export const UPGRADE_FAILED_REVIEW = defineReviewKind({
  kind: "system.upgrade-failed",
  module: "system",
  scope: "household",
});

/**
 * A restore rolled the data back to a snapshot (story 1.16). Household scope; entity
 * `backup_snapshot:<restic snapshot ID>`, one item per snapshot restored.
 */
export const RESTORED_REVIEW = defineReviewKind({
  kind: "system.restored",
  module: "system",
  scope: "household",
});

export const JOB_DEAD_REVIEW = defineReviewKind({
  kind: "job.dead",
  module: "system",
  scope: "household",
});

const raiseInput = z
  .object({
    entityRef: z.string().min(1),
    dedupeKey: z.string().min(1),
    accountId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
  })
  .strict();

export interface RaiseReviewItemInput {
  readonly kind: ReviewKind;
  readonly entityRef: string;
  readonly dedupeKey: string;
  /** Required for `account` scope, and only there. */
  readonly accountId?: string;
  /** Required for `person` scope, and only there. */
  readonly personId?: string;
}

function checkScope(
  kind: ReviewKind,
  input: { accountId?: string | undefined; personId?: string | undefined },
): void {
  const has = { account: input.accountId !== undefined, person: input.personId !== undefined };
  const ok =
    kind.scope === "account"
      ? has.account && !has.person
      : kind.scope === "person"
        ? has.person && !has.account
        : !has.account && !has.person;
  if (!ok) {
    throw new TypeError(`raiseReviewItem: ${kind.kind} items have ${kind.scope} scope`);
  }
}

/**
 * `system.raiseReviewItem`, inside the caller's `write` transaction. Idempotent on `dedupeKey`
 * among open items: raising a key that is already open changes nothing and returns that item.
 * A new item is audited as `raise` with its scope. Throws `TypeError` for an unregistered kind,
 * ids that do not match the kind's scope, or a key already open under another kind, and `AppError` `Validation` for empty strings.
 */
export function raiseReviewItem(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "clock" | "newId">,
  input: RaiseReviewItemInput,
): { readonly id: Id<"ReviewItem">; readonly raised: boolean } {
  const { kind, ...rest } = input;
  if (registry.get(kind.kind) !== kind) {
    throw new TypeError(`raiseReviewItem: ${kind.kind} is not a registered review kind`);
  }
  const parsed = parseInput(raiseInput, rest);
  checkScope(kind, parsed);
  const row: ReviewItemRow = {
    id: ctx.newId<"ReviewItem">(),
    kind: kind.kind,
    accountId: parsed.accountId ?? null,
    personId: parsed.personId ?? null,
    entityRef: parsed.entityRef,
    dedupeKey: parsed.dedupeKey,
    createdAt: formatInstant(ctx.clock.now()),
    resolvedAt: null,
    resolution: null,
  };
  const { item, inserted } = tx.reviewItems.raise(row);
  if (!inserted && item.kind !== kind.kind) {
    throw new TypeError(
      `raiseReviewItem: dedupe key ${parsed.dedupeKey} is already open as ${item.kind}, not ${kind.kind}`,
    );
  }
  if (inserted) {
    audit({
      entity: "review_item",
      entityId: item.id,
      action: "raise",
      before: null,
      after: item,
      ...(item.accountId === null ? {} : { accountId: item.accountId }),
      ...(item.personId === null ? {} : { personId: item.personId }),
    });
  }
  return { id: item.id, raised: inserted };
}

const resolveInput = z
  .object({ dedupeKey: z.string().min(1), resolution: z.string().min(1).max(200) })
  .strict();

export type ResolveReviewItemInput = z.input<typeof resolveInput>;

/**
 * `system.resolveReviewItem`, inside the caller's `write` transaction: sets `resolved_at` and
 * `resolution` on the open item with `dedupeKey`, audited as `resolve`. Returns false, writing
 * nothing, when no item with that key is open. Raising the key again opens a new item.
 */
export function resolveReviewItem(
  tx: TxRepos,
  audit: Audit,
  ctx: Pick<UseCaseContext, "clock">,
  input: ResolveReviewItemInput,
): boolean {
  const parsed = parseInput(resolveInput, input);
  const result = tx.reviewItems.resolve(
    parsed.dedupeKey,
    formatInstant(ctx.clock.now()),
    parsed.resolution,
  );
  if (result === undefined) return false;
  const { before, after } = result;
  audit({
    entity: "review_item",
    entityId: after.id,
    action: "resolve",
    before,
    after,
    ...(after.accountId === null ? {} : { accountId: after.accountId }),
    ...(after.personId === null ? {} : { personId: after.personId }),
  });
  return true;
}

/** An open review item as a use case returns it.  */
export interface ReviewItem {
  readonly id: Id<"ReviewItem">;
  readonly kind: string;
  readonly accountId: string | null;
  readonly personId: string | null;
  readonly entityRef: string;
  readonly createdAt: string;
}

export const listReviewItemsInput = z.object({}).strict();
export type ListReviewItemsInput = z.input<typeof listReviewItemsInput>;

/**
 * `system.listReviewItems`: the open items the viewer may see (those of an account they cannot
 * see are not listed), oldest first (AD-17), redacted (AD-4).
 */
export function listReviewItems(
  ctx: UseCaseContext,
  input: ListReviewItemsInput = {},
): ReviewItem[] {
  parseInput(listReviewItemsInput, input);
  const items = ctx.uow
    .read((repos) => repos.reviewItems.listOpenFor(ctx.viewer))
    .map(
      (row): ReviewItem => ({
        id: row.id,
        kind: row.kind,
        accountId: row.accountId,
        personId: row.personId,
        entityRef: row.entityRef,
        createdAt: row.createdAt,
      }),
    );
  return redact(ctx.viewer, items);
}
