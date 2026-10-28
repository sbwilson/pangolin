// The merchant-domain link (merchant-domain story), owned by `classify`: when an accepted
// LLM or import suggestion confirms a payee's domain, the domain lands on the payee row and a
// logo fetch is queued — ALL inside the accepting write transaction (AD-8: a refused
// transaction enqueues nothing). The listener rides `ledger.registerSplitFieldListener`, which
// runs it in that transaction and rolls it back with any throw.
import { formatInstant } from "@pangolin/shared/temporal";
import type { UseCaseContext } from "../context.ts";
import { registerSplitFieldListener, type SplitFieldWrite } from "../ledger/set-split-field.ts";
import type { PayeeRow, TxRepos } from "../ports/unit-of-work.ts";
import { enqueueLogoFetch, payeeNeedsLogoFetch } from "../system/logos.ts";
import type { Audit } from "../write.ts";
import { normaliseDomain } from "./domain.ts";
import { auditScope } from "./scope.ts";

/**
 * Split-field sources that confirm a domain: the LLM suggestion flow, and the import
 * confirmation flow once it writes through `setSplitField`. A user or rule closing the same
 * suggestion did not confirm the domain, so it links nothing.
 */
const CONFIRMING_SOURCES: readonly string[] = ["llm", "import"];

/**
 * `classify.onSplitFieldWrite`: links an accepted suggestion's domain onto the transaction's
 * payee as `https://<domain>` — once, never overwriting a stored website — and enqueues the
 * `logo-fetch` job when the payee still needs one. A private payee's domain is linked (it is
 * local data) but NEVER fetched: `payeeNeedsLogoFetch` refuses it (AD-8).
 */
export function onSplitFieldWrite(
  ctx: UseCaseContext,
  tx: TxRepos,
  audit: Audit,
  event: SplitFieldWrite,
): void {
  const closed = event.closedSuggestion;
  if (closed === undefined || closed.outcome !== "accepted") return;
  if (!CONFIRMING_SOURCES.includes(event.source)) return;
  const domain = normaliseDomain(closed.websiteDomain);
  if (domain === null) return;

  const today = ctx.clock.today().toString();
  const transaction = tx.transactions.findVisible(ctx.viewer, event.transactionId, today);
  if (transaction === undefined || transaction.payeeId === null) return;
  const before = tx.payees.find(ctx.viewer, transaction.payeeId);
  if (before === undefined) return;

  let next: PayeeRow = before;
  if (before.websiteUrl === null) {
    next = {
      ...before,
      websiteUrl: `https://${domain}`,
      updatedAt: formatInstant(ctx.clock.now()),
    };
    if (!tx.payees.update(ctx.viewer, next)) return;
    const origin = tx.payees.originOf(ctx.viewer, before.id) ?? null;
    audit({
      entity: "payee",
      entityId: before.id,
      action: "update",
      before,
      after: next,
      ...auditScope(before.scopePersonId, origin),
    });
  }
  // A public payee that already carries a website still gets its logo: the accepted domain is
  // a fresh confirmation, and the frozen enqueue row reads "the privacy guard applies to the
  // run, not the enqueue" (negotiated 2026-10-28).
  if (payeeNeedsLogoFetch(next)) enqueueLogoFetch(tx, ctx, before.id);
}

// Self-registering: `packages/app/src/index.ts` imports this module, so every process that
// loads the package listens — the acceptance flow never has to know the link exists.
registerSplitFieldListener(onSplitFieldWrite);
