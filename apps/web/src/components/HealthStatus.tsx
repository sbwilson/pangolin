import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "../api.ts";

export function HealthStatus() {
  const health = useQuery({ queryKey: ["system", "health"], queryFn: fetchHealth, retry: false });
  if (health.isPending) return <p>Checking…</p>;
  if (!health.data?.healthy) return <p role="status">Unhealthy</p>;
  return (
    <>
      <p role="status">Healthy</p>
      <p>Schema version {health.data.schemaVersion}</p>
    </>
  );
}
