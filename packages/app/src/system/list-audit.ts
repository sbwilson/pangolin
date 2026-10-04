// The audit log read (AD-1, AD-3, AD-4): rows the viewer's accounts and person allow, with
// hidden transaction names removed in SQL and rendered by `redact`.
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { parseInput } from "../errors.ts";
import type { AuditView } from "../ports/unit-of-work.ts";
import { redact } from "../redact.ts";

export const listAuditInput = z.object({}).strict();
export type ListAuditInput = z.input<typeof listAuditInput>;

/**
 * `system.listAudit`: the audit rows the viewer may see, oldest first. That includes the
 * partner's entries about a transaction whose name the viewer cannot see: they read "Hidden
 * until <date>" until then. Notes stay visible.
 */
export function listAudit(ctx: UseCaseContext, input: ListAuditInput = {}): AuditView[] {
  parseInput(listAuditInput, input);
  const today = ctx.clock.today().toString();
  const rows = ctx.uow.read((repos) => repos.audit.listVisible(ctx.viewer, today));
  return redact(ctx.viewer, rows);
}
