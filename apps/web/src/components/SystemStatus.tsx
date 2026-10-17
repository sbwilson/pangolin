import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils.ts";
import {
  type BackupVerification,
  fetchBackupStatus,
  fetchDeadJobs,
  fetchHealth,
  fetchRecoveryBundle,
} from "../api.ts";

function HealthRow() {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth, retry: false });

  if (health.isPending) {
    return <p className="py-2.5 text-xs text-muted-foreground">Checking…</p>;
  }

  if (health.isError || !health.data?.healthy) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-[13.5px]">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 text-destructive" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </span>
          <div>
            <div className="font-medium text-foreground">Health</div>
            <p role="status" className="text-xs text-destructive">
              Unhealthy
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-[13.5px]">
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 text-money-in" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M8 12.5l3 3 5-6" />
          </svg>
        </span>
        <div>
          <div className="font-medium text-foreground">Health</div>
          <small className="block text-xs text-muted-foreground">
            <span role="status">Healthy</span> ·{" "}
            <span>Schema version {health.data.schemaVersion}</span>
          </small>
        </div>
      </div>
    </div>
  );
}

function Verification({
  label,
  none,
  result,
}: {
  readonly label: string;
  readonly none: string;
  readonly result: BackupVerification | null;
}) {
  if (result === null) {
    return <p className="border-b border-border py-2 text-xs text-muted-foreground">{none}</p>;
  }

  return (
    <div className="flex items-center gap-3 border-b border-border py-2.5 text-[13.5px]">
      <span
        className={cn("flex shrink-0", result.ok ? "text-money-in" : "text-warning")}
        aria-hidden="true"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          {result.ok ? <path d="M8 12.5l3 3 5-6" /> : <path d="M12 8v4M12 16h.01" />}
        </svg>
      </span>
      <div>
        <div className="font-medium text-foreground">{label}</div>
        <small className="block text-xs text-muted-foreground">
          <span role={result.ok ? undefined : "alert"}>
            {label} {result.ok ? "passed" : "failed"} <time dateTime={result.at}>{result.at}</time>:{" "}
            {result.summary}
          </span>
        </small>
      </div>
    </div>
  );
}

function BackupStatusSection() {
  const backup = useQuery({
    queryKey: ["system", "backup"],
    queryFn: fetchBackupStatus,
    retry: false,
  });

  if (backup.isPending) return null;
  if (backup.isError) {
    return (
      <p className="border-b border-border py-2 text-xs text-muted-foreground">
        Backup status unavailable
      </p>
    );
  }

  const { configured, last, stale, check, drill } = backup.data;
  if (!configured) {
    return (
      <p className="border-b border-border py-2 text-xs text-muted-foreground">
        Backups not configured
      </p>
    );
  }

  return (
    <>
      {last === null ? (
        <p className="border-b border-border py-2 text-xs text-muted-foreground">No backup yet</p>
      ) : (
        <div className="flex items-center gap-3 border-b border-border py-2.5 text-[13.5px]">
          <span className="flex shrink-0 text-money-in" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l3 3 5-6" />
            </svg>
          </span>
          <div>
            <div className="font-medium text-foreground">Backup</div>
            <small className="block text-xs text-muted-foreground">
              Last backup <time dateTime={last.pushedAt}>{last.pushedAt}</time> (snapshot{" "}
              <code title={last.snapshotId}>{last.snapshotId.slice(0, 8)}</code>)
            </small>
          </div>
        </div>
      )}
      {stale ? (
        <div className="border-b border-border py-2">
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg bg-warning-bg p-2 text-xs text-warning"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">
              !
            </span>
            <span>Warning: no good backup in the last 48 hours</span>
          </div>
        </div>
      ) : null}
      <Verification label="Repository check" none="No repository check yet" result={check} />
      <Verification label="Restore drill" none="No restore drill yet" result={drill} />
    </>
  );
}

function RecoveryBundleWarning() {
  const bundle = useQuery({
    queryKey: ["system", "recovery-bundle"],
    queryFn: fetchRecoveryBundle,
    retry: false,
  });

  if (bundle.isPending || bundle.isError || bundle.data.confirmed) return null;
  const { bundleId } = bundle.data;

  return (
    <div className="border-b border-border py-2">
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg bg-warning-bg p-2 text-xs text-warning"
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">
          !
        </span>
        <p>
          Warning: the recovery bundle
          {bundleId === undefined ? null : (
            <>
              {" "}
              <code>{bundleId}</code>
            </>
          )}{" "}
          is not confirmed stored safely. Store it offline, then run{" "}
          <code>sudo pangolin confirm-bundle</code> on the server.
        </p>
      </div>
    </div>
  );
}

function DeadJobsList() {
  const jobs = useQuery({ queryKey: ["system", "jobs"], queryFn: fetchDeadJobs, retry: false });

  if (jobs.isPending) return null;
  if (jobs.isError) {
    return (
      <p className="border-b border-border py-2 text-xs text-muted-foreground">
        Job status unavailable
      </p>
    );
  }
  if (jobs.data.length === 0) {
    return (
      <p className="border-b border-border py-2 text-xs text-muted-foreground">
        No jobs need attention
      </p>
    );
  }

  return (
    <section aria-labelledby="dead-jobs" className="border-b border-border py-2">
      <h4
        id="dead-jobs"
        className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Jobs that failed
      </h4>
      <ul className="space-y-1">
        {jobs.data.map((job, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: read-only list with no stable item key
          <li key={`${index}:${job.kind}@${job.failedAt}`} className="text-xs text-warning">
            {job.kind} — <time dateTime={job.failedAt}>{job.failedAt}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SystemStatus() {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </span>
          <h3 className="text-base font-semibold leading-tight">System status</h3>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Read-only. How the server, backups and background jobs are going.
        </p>
      </div>

      <div className="border-t border-border">
        <HealthRow />
        <BackupStatusSection />
        <RecoveryBundleWarning />
        <DeadJobsList />
      </div>

      <div className="flex items-start gap-2 pt-2 text-xs text-muted-foreground">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 shrink-0"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7.5v.5" />
        </svg>
        <span>
          Restores run from the server CLI, with Pangolin stopped. There&apos;s no restore button
          here on purpose.
        </span>
      </div>
    </div>
  );
}
