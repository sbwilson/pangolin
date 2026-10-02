// The recovery bundle's safe-storage confirmation (story 1.17, AD-27), owned by `system`.
// install.sh gives every bundle it writes an id (`PANGOLIN_RECOVERY_BUNDLE_ID` in `.env`, also
// printed in the bundle). Until the household confirms that id with `pangolin confirm-bundle`,
// `/healthz`, `pangolin status` and the status page warn. A new bundle has a new id, so the
// warning comes back. Only the id ever reaches the server; the bundle's secrets never do.
import { formatInstant } from "@pangolin/shared/temporal";
import { z } from "zod";
import type { UseCaseContext } from "../context.ts";
import { AppError, parseInput } from "../errors.ts";
import type { RecoveryBundleRow, UnitOfWork } from "../ports/unit-of-work.ts";
import { write } from "../write.ts";

/** A bundle id as install.sh writes it: the UTC time, `YYYYMMDDTHHMMSSZ`, a hyphen, 4 hex. */
export const RECOVERY_BUNDLE_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{4}$/;

export const recoveryBundleId = z.string().regex(RECOVERY_BUNDLE_ID_PATTERN, {
  message: "Expected a recovery bundle id like 20261003T010203Z-a1b2",
});

/** The message `confirm-bundle` refuses with when the server has no bundle id. */
export const NO_RECOVERY_BUNDLE_ID =
  "no recovery bundle id is set (PANGOLIN_RECOVERY_BUNDLE_ID): re-run install.sh to add one";

export const confirmRecoveryBundleInput = z
  .object({
    /** The server's `PANGOLIN_RECOVERY_BUNDLE_ID`; undefined when it has none. */
    bundleId: recoveryBundleId.optional(),
  })
  .strict();
export type ConfirmRecoveryBundleInput = z.input<typeof confirmRecoveryBundleInput>;

export interface ConfirmedRecoveryBundle {
  readonly bundleId: string;
  /** When this id was first confirmed. */
  readonly confirmedAt: string;
  /** This id was already confirmed: nothing was written. */
  readonly alreadyConfirmed: boolean;
}

/**
 * `system.confirmRecoveryBundle`: records that the bundle with `bundleId` is stored safely,
 * audited as one `confirm` of `recovery_bundle`. Confirming the id already confirmed writes
 * nothing. `Validation` when there is no id to confirm.
 */
export function confirmRecoveryBundle(
  ctx: UseCaseContext,
  input: ConfirmRecoveryBundleInput,
): ConfirmedRecoveryBundle {
  const { bundleId } = parseInput(confirmRecoveryBundleInput, input);
  if (bundleId === undefined) throw new AppError("Validation", NO_RECOVERY_BUNDLE_ID);
  return write(ctx, (tx, audit) => {
    const before = tx.recoveryBundle.get();
    if (before?.bundleId === bundleId) {
      return { bundleId, confirmedAt: before.confirmedAt, alreadyConfirmed: true };
    }
    const after: RecoveryBundleRow = { bundleId, confirmedAt: formatInstant(ctx.clock.now()) };
    tx.recoveryBundle.set(after);
    audit({
      entity: "recovery_bundle",
      entityId: "1",
      action: "confirm",
      before: before ?? null,
      after,
    });
    return { ...after, alreadyConfirmed: false };
  });
}

/** What the status page shows: whether the current bundle's storage is confirmed. */
export interface RecoveryBundleStatus {
  /** True when the current bundle is confirmed, or when there is no bundle id (nothing to do). */
  readonly confirmed: boolean;
  /** The current bundle's id; absent when the server has none. */
  readonly bundleId?: string;
}

/**
 * `system.recoveryBundleStatus`. No viewer: it shows no household data. With no `bundleId`
 * (local dev, CI) there is nothing to confirm. A confirmation of another id (an older bundle, or
 * one a restore brought back) does not count.
 */
export function recoveryBundleStatus(
  uow: Pick<UnitOfWork, "read">,
  bundleId: string | undefined,
): RecoveryBundleStatus {
  if (bundleId === undefined) return { confirmed: true };
  const row = uow.read((repos) => repos.recoveryBundle.get());
  return { confirmed: row?.bundleId === bundleId, bundleId };
}

/** Whether the current bundle (`bundleId`) is confirmed; true when there is no bundle id. */
export function recoveryBundleConfirmed(
  uow: Pick<UnitOfWork, "read">,
  bundleId: string | undefined,
): boolean {
  return recoveryBundleStatus(uow, bundleId).confirmed;
}
