// The restore mechanism (story 1.10, AD-16): fetch a restic snapshot into a fresh directory on
// the data volume, verify it, and swap it in. The caller (admin/restore.ts) holds the
// data-directory lock throughout, and cancels jobs with external effects after the swap.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  MANIFEST_FILE,
  type Migration,
  parseManifest,
  SNAPSHOT_FILE,
  type SnapshotVerdict,
  verifySnapshot,
} from "@pangolin/db";
import { DB_FILE, DB_SIDE_FILES } from "./paths.ts";
import type { Restic, ResticSnapshot } from "./restic.ts";

/** A snapshot restored into its own directory, not yet swapped in. */
export interface FetchedSnapshot {
  readonly snapshot: ResticSnapshot;
  /** Where the whole snapshot was restored (`<dataDir>/restore-<stamp>`). */
  readonly dir: string;
  /** The staged snapshot's directory in it: `pangolin.sqlite` and `manifest.json`. */
  readonly dbDir: string;
  /** The attachments in it, when the snapshot has them. */
  readonly attachmentsDir: string | undefined;
}

export class SnapshotNotFound extends Error {
  constructor(ref: string) {
    super(`No snapshot ${ref} in the repository`);
    this.name = "SnapshotNotFound";
  }
}

/** The staged-snapshot path a backup pushes: `<dataDir>/backup/staging/<id>`. */
const STAGED = /\/backup\/staging\/[0-9A-Za-z]+$/;

/**
 * Restores snapshot `ref` (an ID, or `latest`) into `dir`, an empty directory the caller
 * created, and finds
 * its staged database and attachments. Throws `SnapshotNotFound`, or an `Error` for a snapshot
 * that is not one of ours.
 */
export async function fetchSnapshot(
  restic: Restic,
  ref: string,
  dir: string,
): Promise<FetchedSnapshot> {
  const snapshot = await restic.findSnapshot(ref);
  if (snapshot === undefined) throw new SnapshotNotFound(ref);
  const staged = snapshot.paths.filter((path) => STAGED.test(path));
  if (staged.length !== 1) {
    throw new Error(`Snapshot ${snapshot.id.slice(0, 8)} is not a Pangolin backup`);
  }
  const attachments = snapshot.paths.find((path) => path.endsWith("/attachments"));
  await restic.restore(snapshot.id, dir);
  const inDir = (path: string) => join(dir, path);
  return {
    snapshot,
    dir,
    dbDir: inDir(staged[0] as string),
    attachmentsDir:
      attachments !== undefined && existsSync(inDir(attachments)) ? inDir(attachments) : undefined,
  };
}

/**
 * Verifies a fetched snapshot before any swap: `integrity_check`, every table against the
 * manifest pushed with it, and a schema no newer than this build's `migrations`.
 */
export function verifyFetched(
  fetched: FetchedSnapshot,
  migrations: readonly Migration[],
): SnapshotVerdict {
  const file = join(fetched.dbDir, SNAPSHOT_FILE);
  if (!existsSync(file)) {
    return { ok: false, check: "integrity", message: "the snapshot has no database file" };
  }
  let manifest: ReturnType<typeof parseManifest>;
  try {
    manifest = parseManifest(readFileSync(join(fetched.dbDir, MANIFEST_FILE), "utf8"));
  } catch (error) {
    return {
      ok: false,
      check: "manifest",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return verifySnapshot(file, manifest, migrations);
}

export interface Swapped {
  /** Where the replaced database and attachments went. */
  readonly preRestoreDir: string;
  /** Puts everything back as it was before the swap. */
  undo(): void;
}

/**
 * Swaps a verified snapshot in: the live database (with its side files) and attachments move to
 * `<dataDir>/pre-restore-<stamp>/`, then the snapshot's database and attachments move into their
 * places. Renames only, within the data volume. When a step fails, the moves already made are
 * undone and the error rethrown.
 */
export function swapIn(dataDir: string, fetched: FetchedSnapshot, stamp: string): Swapped {
  const preRestoreDir = join(dataDir, `pre-restore-${stamp}`);
  const moves: { readonly from: string; readonly to: string }[] = [];
  const move = (from: string, to: string) => {
    renameSync(from, to);
    moves.push({ from, to });
  };
  const undo = () => {
    for (const { from, to } of moves.splice(0).reverse()) {
      if (existsSync(to)) renameSync(to, from);
    }
  };
  // Outside the try: when it already exists (EEXIST) it is not ours, and must not be removed.
  mkdirSync(preRestoreDir, { mode: 0o700 });
  try {
    for (const suffix of ["", ...DB_SIDE_FILES]) {
      const live = join(dataDir, `${DB_FILE}${suffix}`);
      if (existsSync(live)) move(live, join(preRestoreDir, `${DB_FILE}${suffix}`));
    }
    const attachments = join(dataDir, "attachments");
    if (existsSync(attachments)) move(attachments, join(preRestoreDir, "attachments"));
    move(join(fetched.dbDir, SNAPSHOT_FILE), join(dataDir, DB_FILE));
    if (fetched.attachmentsDir !== undefined) move(fetched.attachmentsDir, attachments);
  } catch (error) {
    undo();
    rmSync(preRestoreDir, { recursive: true, force: true });
    throw error;
  }
  return {
    preRestoreDir,
    undo: () => {
      // Side files now beside the live name belong to the snapshot's database; left there, a
      // WAL could be replayed into the database moved back.
      for (const suffix of DB_SIDE_FILES)
        rmSync(join(dataDir, `${DB_FILE}${suffix}`), { force: true });
      undo();
      rmSync(preRestoreDir, { recursive: true, force: true });
    },
  };
}
