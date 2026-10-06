// The snapshot worker (story 1.10): runs `VACUUM INTO` and builds the manifest on its own SQLite
// connection, off the main thread, so the job runner keeps renewing leases and the server keeps
// answering while a large database is copied. Bundled as dist/backup-worker.js.
//
// workerData: { dbFile, outDir, takenAt?, balanceDate }. Writes <outDir>/pangolin.sqlite and <outDir>/manifest.json,
// then posts the manifest's summary. Any failure throws, which the parent sees as an `error`.
import { parentPort, workerData } from "node:worker_threads";
import { writeSnapshot } from "@pangolin/db/manifest";

const { dbFile, outDir, takenAt, balanceDate } = workerData as {
  readonly dbFile: string;
  readonly outDir: string;
  readonly takenAt?: string;
  readonly balanceDate: string;
};
const { manifest } = writeSnapshot(
  dbFile,
  outDir,
  takenAt === undefined ? { balanceDate } : { balanceDate, takenAt },
);
parentPort?.postMessage({
  schemaVersion: manifest.schemaVersion,
});
