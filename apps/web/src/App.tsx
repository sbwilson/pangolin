import { useQuery } from "@tanstack/react-query";
import { fetchDeadJobs, fetchHealth } from "./api.ts";

function DeadJobs() {
  const jobs = useQuery({ queryKey: ["system", "jobs"], queryFn: fetchDeadJobs, retry: false });
  if (jobs.isPending) return null;
  if (jobs.isError) return <p>Job status unavailable</p>;
  if (jobs.data.length === 0) return <p>No jobs need attention</p>;
  return (
    <section aria-labelledby="dead-jobs">
      <h2 id="dead-jobs">Jobs that failed</h2>
      <ul>
        {jobs.data.map((job, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a read-only list with no item state; two jobs of one kind can fail in the same millisecond, so kind and time alone collide.
          <li key={`${index}:${job.kind}@${job.failedAt}`}>
            {job.kind} — <time dateTime={job.failedAt}>{job.failedAt}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function App() {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth, retry: false });

  return (
    <main>
      <h1>Pangolin Money</h1>
      {health.isPending ? (
        <p>Checking…</p>
      ) : health.data?.healthy ? (
        <>
          <p role="status">Healthy</p>
          <p>Schema version {health.data.schemaVersion}</p>
        </>
      ) : (
        <p role="status">Unhealthy</p>
      )}
      <DeadJobs />
    </main>
  );
}
