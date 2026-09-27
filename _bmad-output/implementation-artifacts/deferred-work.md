- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Weekly `restic check` (Sundays 03:30, household time zone) reported through `pangolin status`, the web status page and a review item on failure (story 1.10b).
  evidence: Split from story 1.10 at planning (answer 6b) to keep the backup and verified-restore core within size; times agreed in answer 3.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Monthly restore drill (1st of the month, 04:00) into a temporary directory, running the restore checks and showing the result on the status page (story 1.10b).
  evidence: Split from story 1.10 at planning (answer 6b); it reuses 1.10's restore verification.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Decrypt a sample attachment with the escrowed app key in restore verification and the clean-host test, once epic 5 builds the attachment store.
  evidence: Answer 2b: no attachment store or app-key crypto exists yet.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Snapshot the attachments with the database (a hardlink copy or a manifest of blobs) so a push hours later cannot miss or mismatch them, and verify them on restore.
  evidence: Review of story 1.10: the push reads /data/attachments at push time; no attachments exist until epic 5, which should settle it with the attachment store.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Stage backups under a fixed path (or pass --parent) so restic finds a parent snapshot and does not re-read every attachment nightly.
  evidence: Review of story 1.10: staging paths differ per job, so restic's parent detection never matches; negligible until attachments exist.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Warn in pangolin status, the status page and readiness when the last good backup is older than about 48 hours (story 1.10b, with the check and drill).
  evidence: Review of story 1.10: only a dead job raises an alert; a schedule that silently stops, or backups switched off, raises nothing.
- source_plan: `_bmad-output/initiative-pangolin-money-v1/epic-platform-foundations/story-backups-and-restore-plan.md`
  summary: Test the backup handlers' idempotent re-runs (a snapshot already recorded, a push already pushed).
  evidence: Verification-gap review of story 1.10: no handler-level test re-runs after a recorded row; worst case is a duplicate snapshot or stale checksum, not a failed restore.
