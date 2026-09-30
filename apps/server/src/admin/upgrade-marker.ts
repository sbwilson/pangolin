// A rolled-back `pangolin upgrade` leaves `<dataDir>/upgrade-failed.json` in the data volume. The
// next start raises one review item for it and removes the marker.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Clock,
  type IdGenerator,
  raiseReviewItem,
  type UnitOfWork,
  UPGRADE_FAILED_REVIEW,
  write,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";

export interface UpgradeMarkerDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly newId: IdGenerator;
  readonly dataDir: string;
}

export function raiseUpgradeFailedIfMarked(deps: UpgradeMarkerDeps): void {
  const markerFile = join(deps.dataDir, "upgrade-failed.json");
  if (!existsSync(markerFile)) return;
  try {
    const ctx = {
      uow: deps.uow,
      clock: deps.clock,
      newId: deps.newId,
      viewer: systemViewer("cli:upgrade"),
    };
    write(ctx, (tx, audit) => {
      raiseReviewItem(tx, audit, ctx, {
        kind: UPGRADE_FAILED_REVIEW,
        entityRef: "system",
        dedupeKey: "upgrade-failed",
      });
    });
  } catch {
    // Raising the review item failed (e.g. a DB lock): continue rather than crash-loop.
  } finally {
    rmSync(markerFile, { force: true });
  }
}
