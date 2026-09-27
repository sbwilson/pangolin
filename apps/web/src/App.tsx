import { useQuery } from "@tanstack/react-query";
import { fetchHealth } from "./api.ts";

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
    </main>
  );
}
