// Who a use case runs as (AD-3, AD-6). Every use case takes a `Viewer`, and every field is
// required. A `SystemViewer` sees everything, so its factory lives on its own subpath,
// `@pangolin/app/system-viewer`, which lint bans outside `apps/server/src/{jobs,admin}`.
import type { Id } from "@pangolin/shared";
import { Temporal } from "@pangolin/shared/temporal";

declare const systemViewerBrand: unique symbol;

/** A signed-in person. `authAt` is when they last authenticated (for re-auth windows). */
export interface PersonViewer {
  readonly kind: "person";
  readonly personId: Id<"Person">;
  readonly authAt: Temporal.Instant;
}

/** The audit actor of a job (`job:<kind>`) or an admin CLI command (`cli:<command>`). */
export type SystemActor = `job:${string}` | `cli:${string}`;

/**
 * Unrestricted access for jobs and admin commands. The brand means it can only be built by
 * `systemViewer` from `@pangolin/app/system-viewer`, not written as an object literal.
 */
export interface SystemViewer {
  readonly kind: "system";
  readonly actor: SystemActor;
  readonly [systemViewerBrand]: true;
}

export type Viewer = PersonViewer | SystemViewer;

/** A person viewer. Throws `TypeError` when `authAt` is not a `Temporal.Instant`. */
export function personViewer(personId: Id<"Person">, authAt: Temporal.Instant): PersonViewer {
  if (!(authAt instanceof Temporal.Instant)) {
    throw new TypeError("personViewer: authAt must be a Temporal.Instant");
  }
  return Object.freeze({ kind: "person", personId, authAt });
}

/** The audit-log `actor` for a viewer: `person:<personId>`, or the system viewer's actor. */
export function actorOf(viewer: Viewer): string {
  switch (viewer.kind) {
    case "person":
      return `person:${viewer.personId}`;
    case "system":
      return viewer.actor;
  }
}
