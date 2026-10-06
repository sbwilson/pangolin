// Takes a consistent database snapshot for a backup (story 1.10) in a worker thread with its own
// connection (see snapshot-worker.ts), so the main thread keeps renewing job leases meanwhile.
import { Worker } from "node:worker_threads";
import type { JobSignal } from "@pangolin/app";

/** What `backup_snapshot` records of the manifest: its schema version, no figures. */
export interface SnapshotSummary {
  readonly schemaVersion: number;
}

/**
 * The worker's file: the TypeScript source next to this module when running from source (tests),
 * and `backup-worker.js` next to the bundle (dist/main.js, dist/cli.js) in the image.
 */
export function defaultWorkerFile(): URL {
  const here = import.meta.url;
  return here.endsWith(".ts")
    ? new URL("./snapshot-worker.ts", here)
    : new URL("./backup-worker.js", here);
}

export interface TakeSnapshotOptions {
  /** The live database. */
  readonly dbFile: string;
  /** Where to write `pangolin.sqlite` and `manifest.json`; replaced if it exists. */
  readonly outDir: string;
  /** Recorded in the manifest as when the snapshot was taken. */
  readonly takenAt?: string;
  /** The `YYYY-MM-DD` day the manifest's account balances are taken on (the household's today). */
  readonly balanceDate: string;
  /** Aborting it terminates the worker. */
  readonly signal?: JobSignal;
  readonly workerFile?: URL;
}

function isSummary(value: unknown): value is SnapshotSummary {
  const v = value as Partial<SnapshotSummary> | null;
  return typeof v === "object" && v !== null && Number.isSafeInteger(v.schemaVersion);
}

/**
 * Writes `VACUUM INTO <outDir>/pangolin.sqlite` and its manifest, off the main thread. Rejects
 * with the worker's error, or the signal's reason when it is aborted.
 */
export function takeSnapshot(options: TakeSnapshotOptions): Promise<SnapshotSummary> {
  const { signal } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<SnapshotSummary>((resolve, reject) => {
    const worker = new Worker(options.workerFile ?? defaultWorkerFile(), {
      workerData: {
        dbFile: options.dbFile,
        outDir: options.outDir,
        takenAt: options.takenAt,
        balanceDate: options.balanceDate,
      },
    });
    let result: SnapshotSummary | undefined;
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      void worker.terminate();
      settle(() => reject(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.on("message", (message: unknown) => {
      if (isSummary(message)) result = message;
    });
    worker.on("error", (error) => settle(() => reject(error)));
    worker.on("exit", (code) => {
      settle(() => {
        if (result !== undefined && code === 0) resolve(result);
        else reject(new Error(`The snapshot worker exited with code ${code} and no result`));
      });
    });
  });
}
