/**
 * Synchronous repository port for the `system.health` use case (AD-2).
 * Implemented in `packages/db`.
 */
export interface SystemHealthPort {
  /** Number of migrations applied to the database. */
  schemaVersion(): number;
  /** True when the database accepts a write lock; false when it is read-only. */
  probeWrite(): boolean;
}
