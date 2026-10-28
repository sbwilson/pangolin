// Merchant logo fetching (the merchant-domain story), owned by `system`: the job kind, its
// dedupe key, the enqueue helper, and the use case that records a fetched favicon on the payee.
// The fetch itself — the single GET, manual redirects, size cap, mime allowlist, proxy — is
// I/O the server's job handler does BEFORE calling these (AD-2); everything here is the guards
// and the short write.
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import { normaliseDomain } from "../classify/domain.ts";
import { attachLogoToPayee } from "../classify/payees.ts";
import type { AttachmentContext, UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import { idInput } from "../inputs.ts";
import { enqueueJob } from "../jobs/enqueue.ts";
import { defineJobKind } from "../jobs/registry.ts";
import type { AttachmentRow, PayeeRow, TxRepos } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

/** Body cap for a favicon: 256 KiB. Enforced by the fetcher AND re-checked on record. */
export const MAX_LOGO_BYTES = 262_144;

/** Content types a favicon may arrive as. SVG is deliberately absent (it is scriptable). */
export const LOGO_MIMES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

/**
 * Fetches one public payee's favicon once. Net lane, external effects, and deliberately NOT
 * `needsPersonWhenDead`: a missing logo is cosmetic, never something to nag a person about.
 */
export const LOGO_FETCH_JOB = defineJobKind({
  kind: "logo-fetch",
  schema: z.object({ payeeId: idInput }).strict(),
  lane: "net",
  // Once-ever (frozen row): a failed attempt goes straight to `dead`, never retried
  // automatically. A new confirmation (acceptance, a newly set website) may enqueue again.
  retry: { maxAttempts: 1 },
  externalEffects: true,
  needsPersonWhenDead: false,
  timeoutMs: 30_000,
});

/** At most one live logo job per payee. */
export function logoDedupeKey(payeeId: string): string {
  return `logo:${payeeId}`;
}

/**
 * Puts a logo fetch in the outbox inside the caller's write transaction. Idempotent while a
 * job for the same payee is pending or running (dedupe key).
 */
export function enqueueLogoFetch(
  tx: TxRepos,
  ctx: Pick<UseCaseContext, "clock" | "newId">,
  payeeId: string,
): void {
  enqueueJob(tx, ctx, LOGO_FETCH_JOB, { payeeId }, { dedupeKey: logoDedupeKey(payeeId) });
}

/**
 * True when a payee should get a logo job: a SHARED payee (a private one would leak that the
 * person banks somewhere by fetching its site) with a website and no logo yet.
 */
export function payeeNeedsLogoFetch(payee: PayeeRow): boolean {
  return (
    payee.scopePersonId === null && payee.websiteUrl !== null && payee.logoAttachmentId === null
  );
}

export const recordPayeeLogoInput = z
  .object({
    payeeId: idInput,
    bytes: z.instanceof(Uint8Array),
    mime: z.string(),
  })
  .strict();
export type RecordPayeeLogoInput = z.infer<typeof recordPayeeLogoInput>;

/**
 * `system.recordPayeeLogo`: stores the fetched bytes in the encrypted attachment store and
 * links the row onto the payee. The store write happens BEFORE the write transaction (AD-2);
 * the transaction re-checks every guard, so a job that raced itself or a payee that changed
 * while the fetch ran simply links nothing.
 *
 * Returns the attachment id used, or null when nothing was written (payee gone, made private,
 * or already carrying a logo).
 */
export function recordPayeeLogo(
  ctx: AttachmentContext,
  input: RecordPayeeLogoInput,
): string | null {
  const parsed = parseInput(recordPayeeLogoInput, input);
  if (parsed.bytes.length === 0 || parsed.bytes.length > MAX_LOGO_BYTES) {
    throw new AppError("Validation", "Logo is empty or too large");
  }
  if (!LOGO_MIMES.includes(parsed.mime)) {
    throw new AppError("Validation", "Unsupported logo type");
  }
  const name = ctx.attachments.put(parsed.bytes);
  try {
    const linked = write(ctx, (tx, audit) => {
      // Read the guards BEFORE the attachment row exists: a payee that links nothing must not
      // leave an orphan row behind. `attachLogoToPayee` re-checks every one of them as it
      // writes, so nothing can slip between the two.
      const before = tx.payees.find(ctx.viewer, parsed.payeeId);
      if (before === undefined || !payeeNeedsLogoFetch(before)) return null;
      // The domain is re-checked here as a final belt: the payee's own stored website must
      // still normalise to a public host before bytes get attached to it.
      if (normaliseDomain(before.websiteUrl) === null) return null;
      let attachment: AttachmentRow | undefined = tx.attachments.findByName(name);
      if (attachment === undefined) {
        attachment = {
          id: ctx.newId<"Attachment">(),
          name,
          mime: parsed.mime,
          bytes: parsed.bytes.length,
          createdAt: formatInstant(ctx.clock.now()),
        };
        tx.attachments.insert(attachment);
      }
      // The `payee` row belongs to `classify` (AD-10): the link and its audit run through
      // `attachLogoToPayee`, inside this same write.
      if (!attachLogoToPayee(ctx, tx, audit, parsed.payeeId, attachment.id)) return null;
      return attachment.id;
    });
    if (linked === null) removeIfUnlinked(ctx, name);
    return linked;
  } catch (error) {
    removeIfUnlinked(ctx, name);
    throw error;
  }
}

function removeIfUnlinked(ctx: AttachmentContext, name: string): void {
  try {
    const orphan = write(ctx, (tx) => tx.attachments.findByName(name) === undefined);
    if (orphan) ctx.attachments.remove(name);
  } catch {
    // Best effort: the original error is the one to report.
  }
}
