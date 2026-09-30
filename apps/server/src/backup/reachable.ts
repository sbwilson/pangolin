// A quick "can we open a connection to the backup server?" before restic runs. A firewall that
// drops packets (the allowlist does) makes restic wait through its own long retries in silence;
// this fails in seconds and names the host and port to allow.
import { connect } from "node:net";

export const REACHABLE_TIMEOUT_MS = 5000;

/** host and port of a `rest:http(s)://…` repository; undefined for any other kind. */
export function restEndpoint(repository: string): { host: string; port: number } | undefined {
  if (!repository.startsWith("rest:")) return undefined;
  let url: URL;
  try {
    url = new URL(repository.slice("rest:".length));
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
}

export class RepositoryUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryUnreachable";
  }
}

/** Resolves when the REST server accepts a TCP connection; other repository kinds pass. */
export function checkRepositoryReachable(
  repository: string,
  timeoutMs: number = REACHABLE_TIMEOUT_MS,
): Promise<void> {
  const endpoint = restEndpoint(repository);
  if (endpoint === undefined) return Promise.resolve();
  const where = `${endpoint.host}:${endpoint.port}`;
  return new Promise((resolve, reject) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    const fail = (why: string) => {
      socket.destroy();
      reject(
        new RepositoryUnreachable(
          `Cannot reach the backup server ${where} (${why}). Check the URL, and that ${where} is in /opt/pangolin/allowlist.conf (then: systemctl start pangolin-allowlist.service).`,
        ),
      );
    };
    socket.setTimeout(timeoutMs, () => fail(`no answer in ${Math.round(timeoutMs / 1000)} s`));
    socket.once("error", (error) => fail(error.message));
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
  });
}
