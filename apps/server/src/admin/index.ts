// The admin entry: commands that run as `SystemViewer` (AD-6, AD-16).
export { AdminUnreachable, CLIENT_TIMEOUT_MS, callAdmin } from "./client.ts";
export {
  ADMIN_COMMANDS,
  type AdminCommand,
  type AdminDeps,
  BACKUPS_NOT_CONFIGURED,
  type BackupStarted,
  type BackupStatus,
  backupCommand,
  backupStatusCommand,
  type ConfirmedRecoveryBundle,
  confirmBundleCommand,
  isAdminCommand,
  type LoginChoice,
  type ResetUserDeps,
  type ResetUserOutput,
  resetUserCommand,
  runAdminCommand,
  type StatusResult,
  statusCommand,
} from "./commands.ts";
export { acquireDataDirLock, type DataDirLock, DataDirLocked, LOCK_FILE } from "./lock.ts";
export {
  type CredentialChoice,
  type CredentialOutcome,
  type RestoreDeps,
  type RestoreResult,
  restoreStopped,
} from "./restore.ts";
export { type AppliedSeed, applySeed, parseSeed, type SeedDeps } from "./seed.ts";
export { type FirstSetupLinkDeps, SETUP_LINK_FILE, writeFirstSetupLink } from "./setup-link.ts";
export {
  type AdminError,
  type AdminErrorCode,
  type AdminLog,
  type AdminResponse,
  type AdminSocket,
  type AdminSocketOptions,
  checkProof,
  IDLE_TIMEOUT_MS,
  listenAdminSocket,
  MAX_REQUEST_BYTES,
  PROOF_MAX_AGE_MS,
  PROOF_NAME,
} from "./socket.ts";
export { raiseUpgradeFailedIfMarked, type UpgradeMarkerDeps } from "./upgrade-marker.ts";
