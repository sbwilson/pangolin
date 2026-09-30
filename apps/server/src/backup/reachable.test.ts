import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { checkRepositoryReachable, restEndpoint } from "./reachable.ts";

describe("restEndpoint", () => {
  it("reads host and port, defaulting by scheme, and ignores credentials", () => {
    expect(restEndpoint("rest:https://u:p@restic.example.com/pangolin")).toEqual({
      host: "restic.example.com",
      port: 443,
    });
    expect(restEndpoint("rest:http://nas.lan:8000/x")).toEqual({ host: "nas.lan", port: 8000 });
    expect(restEndpoint("rest:http://nas.lan/x")?.port).toBe(80);
    expect(restEndpoint("/srv/repo")).toBeUndefined();
    expect(restEndpoint("s3:s3.amazonaws.com/bucket")).toBeUndefined();
  });
});

describe("checkRepositoryReachable", () => {
  it("passes for a server that accepts and for a non-REST repository", async () => {
    const server = createServer((socket) => socket.end()).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };
    try {
      await expect(
        checkRepositoryReachable(`rest:http://127.0.0.1:${port}/r`),
      ).resolves.toBeUndefined();
      await expect(checkRepositoryReachable("/srv/repo")).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("fails fast naming host:port and the allowlist when nothing listens", async () => {
    const server = createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };
    server.close();
    await expect(checkRepositoryReachable(`rest:http://127.0.0.1:${port}/r`)).rejects.toThrow(
      new RegExp(`127.0.0.1:${port}.*allowlist.conf`),
    );
  });
});
