// The `SystemViewer` factory (AD-6). Exported only as `@pangolin/app/system-viewer`, never
// from the package root; lint bans that subpath everywhere except
// `apps/server/src/jobs/**` and `apps/server/src/admin/**`.
import type { SystemActor, SystemViewer } from "./viewer.ts";

const ACTOR_RE = /^(job|cli):[a-z0-9-]+$/;

/**
 * A viewer that sees everything, audited as `actor` (`job:<kind>` or `cli:<command>`,
 * lowercase letters, digits and hyphens). Throws `TypeError` for any other actor.
 */
export function systemViewer(actor: SystemActor): SystemViewer {
  if (typeof actor !== "string" || !ACTOR_RE.test(actor)) {
    throw new TypeError(
      `systemViewer: actor must match job:<kind> or cli:<command>, got ${JSON.stringify(actor)}`,
    );
  }
  return Object.freeze({ kind: "system", actor }) as SystemViewer;
}
