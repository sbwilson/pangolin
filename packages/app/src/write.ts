// The single write path (AD-1, AD-2): one short synchronous transaction in which a use case
// writes its rows and their audit rows together.
import { formatInstant } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "./context.ts";
import type { AuditRow, TxRepos } from "./ports/unit-of-work.ts";
import { actorOf } from "./viewer.ts";

/** What a use case says about a change; `write` stamps the id, time and actor. */
export interface AuditEntry {
  readonly entity: string;
  readonly entityId: string;
  readonly action: string;
  /** The entity before the change, serialised as JSON; `null`/`undefined` store NULL. */
  readonly before: unknown;
  /** The entity after the change, serialised as JSON; `null`/`undefined` store NULL. */
  readonly after: unknown;
  readonly accountId?: string;
  readonly personId?: string;
}

/** Appends one audit row to the current transaction. */
export type Audit = (entry: AuditEntry) => void;

function toJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError("audit: before/after must be JSON-serialisable");
  return text;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Runs `fn` inside one `BEGIN IMMEDIATE` transaction through `ctx.uow`. `audit` appends an
 * audit row in that same transaction, stamped with `ctx.newId()`, `formatInstant(ctx.clock.now())` and the
 * viewer's actor. When `fn` throws, nothing is written. When `fn` returns a promise or any
 * thenable, the transaction is rolled back and `write` throws: no `await` inside a write (AD-2).
 */
export function write<T>(ctx: UseCaseContext, fn: (tx: TxRepos, audit: Audit) => T): T {
  const actor = actorOf(ctx.viewer);
  let open = true;
  try {
    return ctx.uow.transaction((tx) => {
      const audit: Audit = (entry) => {
        if (!open) throw new Error("audit called after its write transaction ended");
        const row: AuditRow = {
          id: ctx.newId<"AuditLog">(),
          at: formatInstant(ctx.clock.now()),
          actor,
          entity: entry.entity,
          entityId: entry.entityId,
          accountId: entry.accountId ?? null,
          personId: entry.personId ?? null,
          action: entry.action,
          before: toJson(entry.before),
          after: toJson(entry.after),
        };
        tx.audit.append(row);
      };
      const result = fn(tx, audit);
      if (isThenable(result)) {
        // Swallow a later rejection so it cannot surface as an unhandled rejection.
        result.then(undefined, () => {});
        throw new TypeError("write: the callback returned a promise; no await inside a write");
      }
      return result;
    });
  } finally {
    open = false;
  }
}
