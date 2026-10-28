// The `logo-fetch` handler and the real fetcher's guardrails. The handler never reaches the
// network itself: a fake fetcher proves the guards (who gets fetched, who never does) and the
// storage; a fake `fetch` proves the one GET, the manual redirect, the mime allowlist and the
// size cap.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Clock,
  createAccount,
  createIdGenerator,
  createPayee,
  createPerson,
  fixedClockAt,
  type JobContext,
  systemClock,
} from "@pangolin/app";
import { systemViewer } from "@pangolin/app/system-viewer";
import {
  type FakeAttachmentStore,
  fakeAttachmentStore,
} from "@pangolin/app/testing/attachment-store";
import {
  createUnitOfWork,
  type Db,
  loadMigrations,
  migrate,
  openDatabase,
  packageMigrationsDir,
} from "@pangolin/db";
import { ProxyAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogoFetcher, type LogoFetchInit, logoJobs } from "./logo-fetch.ts";

let dir: string;
let db: Db;
let now: ReturnType<Clock["now"]>;
let ms: number;
let store: FakeAttachmentStore;

const clock: Clock = systemClock("UTC", () => now);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pangolin-logo-jobs-"));
  db = openDatabase(join(dir, "pangolin.sqlite"));
  migrate(db, loadMigrations(packageMigrationsDir));
  now = fixedClockAt("2026-09-27").now();
  ms = now.epochMilliseconds;
  store = fakeAttachmentStore();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const newId = () => createIdGenerator({ now: () => ++ms, random: Math.random });

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function baseCtx() {
  return {
    viewer: systemViewer("cli:test"),
    clock,
    newId: newId(),
    uow: createUnitOfWork(db),
  };
}

/** The context a runner gives the `logo-fetch` handler. */
function jobCtx(): JobContext {
  return {
    ...baseCtx(),
    viewer: systemViewer("job:logo-fetch"),
    job: { id: "01J000000000000000000000J" as never, kind: "logo-fetch", attempt: 1 },
    signal: {
      aborted: false,
      reason: undefined,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
}

/** A shared payee with a website and no logo, ready to be fetched. */
let payeeSeq = 0;
function seedPayee(websiteUrl: string | null = "https://www.shop.example.com/deep/path") {
  payeeSeq += 1;
  const ctx = baseCtx();
  const personId = createPerson(ctx, { displayName: `Alex${payeeSeq}`, colour: "#000000" });
  const account = createAccount(ctx, {
    name: "Joint",
    type: "transaction",
    currency: "AUD",
    isPrivate: false,
    owners: [{ personId, shareBp: 10_000 }],
  });
  const privateAccount = createAccount(ctx, {
    name: "Alex private",
    type: "transaction",
    currency: "AUD",
    isPrivate: true,
    owners: [{ personId, shareBp: 10_000 }],
  });
  const payee = createPayee(ctx, {
    name: `Shop ${payeeSeq}`,
    websiteUrl,
    originAccountId: account,
  });
  const privatePayee = createPayee(ctx, {
    name: `Private Clinic ${payeeSeq}`,
    websiteUrl: "https://clinic.example.com",
    originAccountId: privateAccount,
  });
  return { ctx, payee, privatePayee };
}

const runHandler = async (deps: Parameters<typeof logoJobs>[0], payeeId: string): Promise<void> => {
  const [registration] = logoJobs(deps);
  if (registration === undefined) throw new Error("logo-fetch not registered");
  // The registry erases the payload type; this is the one job that schema is for.
  await (registration.handler as (ctx: JobContext, payload: { payeeId: string }) => Promise<void>)(
    jobCtx(),
    { payeeId },
  );
};

const payeeRow = (id: string) =>
  db.prepare("SELECT website_url, logo_attachment_id FROM payee WHERE id = ?").get(id) as
    | { website_url: string | null; logo_attachment_id: string | null }
    | undefined;

const attachmentRows = () =>
  db.prepare("SELECT mime, bytes FROM attachment ORDER BY created_at").all() as {
    mime: string;
    bytes: number;
  }[];

describe("the logo-fetch job handler", () => {
  it("fetches once for a shared payee, stores the bytes encrypted and links the row", async () => {
    const { payee } = seedPayee();
    const calls: string[] = [];
    const fetcher = {
      fetchFavicon: vi.fn(async (domain: string) => {
        calls.push(domain);
        return { bytes: PNG, mime: "image/png" };
      }),
    };

    await runHandler({ attachments: store, logoFetcher: fetcher }, payee.id);

    expect(calls).toEqual(["shop.example.com"]);
    const row = payeeRow(payee.id);
    expect(row?.logo_attachment_id).not.toBeNull();
    expect(attachmentRows()).toEqual([{ mime: "image/png", bytes: PNG.length }]);
    // The bytes went through the encrypted store, and the row points at its name.
    const stored = db
      .prepare("SELECT name FROM attachment WHERE id = ?")
      .get(row?.logo_attachment_id ?? "") as { name: string };
    expect(store.files.has(stored.name)).toBe(true);
    expect(store.get(stored.name)).toEqual(PNG);
    const actor = db
      .prepare(
        "SELECT actor FROM audit_log WHERE entity = 'payee' AND action = 'update' ORDER BY id DESC LIMIT 1",
      )
      .pluck()
      .get();
    expect(actor).toBe("job:logo-fetch");
  });

  it("never fetches a private payee, one without a website, or one that has a logo", async () => {
    const { payee, privatePayee } = seedPayee();
    const fetcher = { fetchFavicon: vi.fn(async () => ({ bytes: PNG, mime: "image/png" })) };

    await runHandler({ attachments: store, logoFetcher: fetcher }, privatePayee.id);
    expect(fetcher.fetchFavicon).not.toHaveBeenCalled();

    const { payee: noSite } = seedPayee(null);
    await runHandler({ attachments: store, logoFetcher: fetcher }, noSite.id);
    expect(fetcher.fetchFavicon).not.toHaveBeenCalled();

    // The first run stored a logo: a second run for the same payee fetches nothing.
    const fetcher2 = { fetchFavicon: vi.fn(async () => ({ bytes: PNG, mime: "image/png" })) };
    await runHandler({ attachments: store, logoFetcher: fetcher2 }, payee.id);
    expect(fetcher2.fetchFavicon).toHaveBeenCalledTimes(1);
    await runHandler({ attachments: store, logoFetcher: fetcher2 }, payee.id);
    expect(fetcher2.fetchFavicon).toHaveBeenCalledTimes(1);
  });

  it("does nothing when logo fetching is switched off", async () => {
    const { payee } = seedPayee();
    const fetcher = { fetchFavicon: vi.fn(async () => ({ bytes: PNG, mime: "image/png" })) };
    await runHandler({ logosEnabled: false, attachments: store, logoFetcher: fetcher }, payee.id);
    expect(fetcher.fetchFavicon).not.toHaveBeenCalled();
    expect(payeeRow(payee.id)?.logo_attachment_id).toBeNull();
  });

  it("completes quietly when the site has no favicon, and links nothing", async () => {
    const { payee } = seedPayee();
    const fetcher = { fetchFavicon: vi.fn(async () => null) };
    await runHandler({ attachments: store, logoFetcher: fetcher }, payee.id);
    expect(fetcher.fetchFavicon).toHaveBeenCalledTimes(1);
    expect(payeeRow(payee.id)?.logo_attachment_id).toBeNull();
    expect(attachmentRows()).toEqual([]);
  });

  it("fails the attempt when the fetch throws, storing nothing", async () => {
    const { payee } = seedPayee();
    const fetcher = {
      fetchFavicon: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    };
    await expect(
      runHandler({ attachments: store, logoFetcher: fetcher }, payee.id),
    ).rejects.toThrow("connection reset");
    expect(payeeRow(payee.id)?.logo_attachment_id).toBeNull();
    expect(attachmentRows()).toEqual([]);
  });

  it("links nothing when the payee vanished while the fetch was in flight", async () => {
    const { payee } = seedPayee();
    const fetcher = {
      fetchFavicon: vi.fn(async () => {
        db.prepare("UPDATE payee SET deleted_at = ? WHERE id = ?").run(
          "2026-09-27T00:00:01.000Z",
          payee.id,
        );
        return { bytes: PNG, mime: "image/png" };
      }),
    };
    await runHandler({ attachments: store, logoFetcher: fetcher }, payee.id);
    const [registration] = logoJobs({ attachments: store, logoFetcher: fetcher });
    // (The write re-check inside `recordPayeeLogo` saw the deletion: no attachment row.)
    expect(attachmentRows()).toEqual([]);
    expect(registration).toBeDefined();
  });
});

// A Response stand-in: the fetcher only reads status, ok, headers and body.
function httpRes(
  status: number,
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array> | null = null,
) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    body,
  } as unknown as Response;
}

function stream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[i];
      if (chunk === undefined) controller.close();
      else {
        i += 1;
        controller.enqueue(chunk);
      }
    },
  });
}

describe("createLogoFetcher", () => {
  // A resolver standing in for `dns.promises.lookup`: the tests' host is a public site, and a
  // public answer is what lets a request through. Every fetcher here injects one, so no test
  // ever touches real DNS.
  const publicResolver = async () => [{ address: "93.184.216.34" }];

  it("makes exactly one manual-redirect GET for the favicon", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: LogoFetchInit) =>
      httpRes(200, { "content-type": "image/png" }, stream(PNG)),
    );
    const fetched = await createLogoFetcher({ resolve: publicResolver, fetchImpl }).fetchFavicon(
      "shop.example.com",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, LogoFetchInit | undefined];
    expect(url).toBe("https://shop.example.com/favicon.ico");
    expect(init?.redirect).toBe("manual");
    expect(fetched).not.toBeNull();
    expect(fetched?.mime).toBe("image/png");
    expect(Array.from(fetched?.bytes ?? [])).toEqual(Array.from(PNG));
  });

  it("answers null for 404 and throws for every other non-OK answer", async () => {
    const fetch404 = createLogoFetcher({
      resolve: publicResolver,
      fetchImpl: vi.fn(async () => httpRes(404, {})),
    });
    expect(await fetch404.fetchFavicon("shop.example.com")).toBeNull();

    const fetch500 = createLogoFetcher({
      resolve: publicResolver,
      fetchImpl: vi.fn(async () => httpRes(503, {})),
    });
    await expect(fetch500.fetchFavicon("shop.example.com")).rejects.toThrow(/503/);
  });

  it("never follows a redirect, however it is surfaced", async () => {
    const raw3xx = createLogoFetcher({
      resolve: publicResolver,
      fetchImpl: vi.fn(async () => httpRes(301, { location: "https://cdn.example.com/f.png" })),
    });
    await expect(raw3xx.fetchFavicon("shop.example.com")).rejects.toThrow(/redirected/);

    const opaque = createLogoFetcher({
      resolve: publicResolver,
      fetchImpl: vi.fn(async () => httpRes(0, {})),
    });
    await expect(opaque.fetchFavicon("shop.example.com")).rejects.toThrow(/redirected/);
  });

  it("accepts only the allowlisted image types, and normalises the header", async () => {
    for (const mime of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/x-icon",
      "image/vnd.microsoft.icon",
    ]) {
      const fetcher = createLogoFetcher({
        resolve: publicResolver,
        fetchImpl: vi.fn(async () =>
          httpRes(200, { "content-type": `${mime}; charset=binary` }, stream(PNG)),
        ),
      });
      const fetched = await fetcher.fetchFavicon("shop.example.com");
      expect(fetched?.mime).toBe(mime);
    }
    for (const mime of ["image/svg+xml", "text/html", "application/octet-stream", ""]) {
      const fetcher = createLogoFetcher({
        resolve: publicResolver,
        fetchImpl: vi.fn(async () => httpRes(200, { "content-type": mime }, stream(PNG))),
      });
      await expect(fetcher.fetchFavicon("shop.example.com")).rejects.toThrow(/served/);
    }
  });

  it("refuses bodies over 256 KiB, by header or by stream", async () => {
    const byHeader = createLogoFetcher({
      resolve: publicResolver,
      fetchImpl: vi.fn(async () =>
        httpRes(200, { "content-type": "image/png", "content-length": "262145" }, stream(PNG)),
      ),
    });
    await expect(byHeader.fetchFavicon("shop.example.com")).rejects.toThrow(/too large/);

    const big = new Uint8Array(200_000);
    const byStream = createLogoFetcher({
      resolve: publicResolver,
      fetchImpl: vi.fn(async () => httpRes(200, { "content-type": "image/png" }, stream(big, big))),
    });
    await expect(byStream.fetchFavicon("shop.example.com")).rejects.toThrow(/too large/);
  });

  it("passes the job signal through to fetch", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (_input: string, init?: LogoFetchInit) => {
      await new Promise<void>((resolve) => {
        if (init?.signal?.aborted) return resolve();
        init?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      throw init?.signal?.reason ?? new Error("aborted");
    });
    const fetcher = createLogoFetcher({ resolve: publicResolver, fetchImpl });
    // A faithful `JobSignal`: `aborted`/`reason` track the underlying controller, as a real
    // runner's AbortSignal does — the DNS check now runs before the request is wired up.
    const run = fetcher.fetchFavicon("shop.example.com", {
      get aborted() {
        return controller.signal.aborted;
      },
      get reason() {
        return controller.signal.reason;
      },
      addEventListener: (_t, listener) =>
        controller.signal.addEventListener("abort", listener, { once: true }),
      removeEventListener: (_t, listener) =>
        controller.signal.removeEventListener("abort", listener),
    });
    controller.abort(new Error("timeout"));
    await expect(run).rejects.toThrow(/timeout|aborted/i);
  });

  // Frozen row: "A domain that resolves to an internal address is never requested". The
  // resolver is injected, so each case proves the fetch mock sees ZERO calls.
  it.each([
    ["RFC1918 10/8", "10.0.0.5"],
    ["RFC1918 172.16/12", "172.20.0.4"],
    ["RFC1918 192.168/16", "192.168.1.9"],
    ["loopback IPv4", "127.0.0.1"],
    ["loopback IPv6", "::1"],
    ["link-local / metadata", "169.254.169.254"],
    ["link-local IPv6", "fe80::1"],
    ["unique-local IPv6", "fc00::a"],
    ["unspecified IPv4", "0.0.0.0"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
  ])("refuses %s without making a request", async (_name, address) => {
    const fetchImpl = vi.fn(async () => httpRes(200, { "content-type": "image/png" }, stream(PNG)));
    const fetcher = createLogoFetcher({ resolve: async () => [{ address }], fetchImpl });
    await expect(fetcher.fetchFavicon("internal.example.com")).rejects.toThrow(/blocked address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses when ANY answer is internal, even beside a public one", async () => {
    const fetchImpl = vi.fn(async () => httpRes(200, { "content-type": "image/png" }, stream(PNG)));
    const fetcher = createLogoFetcher({
      resolve: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }],
      fetchImpl,
    });
    await expect(fetcher.fetchFavicon("split-horizon.example.com")).rejects.toThrow(
      /blocked address/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("public answers proceed to exactly one request", async () => {
    const fetchImpl = vi.fn(async () => httpRes(200, { "content-type": "image/png" }, stream(PNG)));
    const fetcher = createLogoFetcher({
      resolve: async () => [
        { address: "93.184.216.34" },
        { address: "2606:2800:220:1:248:1893:25c8:1946" },
      ],
      fetchImpl,
    });
    expect(await fetcher.fetchFavicon("shop.example.com")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails the attempt when the resolver throws, without ever fetching", async () => {
    const fetchImpl = vi.fn(async () => httpRes(200, { "content-type": "image/png" }, stream(PNG)));
    const fetcher = createLogoFetcher({
      resolve: async () => {
        throw Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
      },
      fetchImpl,
    });
    // The attempt fails (the job kind allows exactly one, so it dies: never retried); no I/O.
    await expect(fetcher.fetchFavicon("gone.example")).rejects.toThrow(/did not resolve/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("issues a proxied request with an undici ProxyAgent on the init", async () => {
    const seen: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: string, init?: LogoFetchInit) => {
      seen.push(init?.dispatcher);
      return httpRes(200, { "content-type": "image/png" }, stream(PNG));
    });
    const fetcher = createLogoFetcher({
      resolve: publicResolver,
      proxyUrl: "http://proxy.internal:8080",
      fetchImpl,
    });
    expect(await fetcher.fetchFavicon("shop.example.com")).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBeInstanceOf(ProxyAgent);
  });
});

// The egress-proxy pairing (AD-8): when a proxy is configured the request must ride undici's
// OWN `fetch` — the copy that built the `ProxyAgent` — never Node's bundled-fetch with a
// foreign dispatcher. The mock replaces undici's `fetch` and proves the real module picks it.
describe("createLogoFetcher with an egress proxy", () => {
  it("issues the request through undici's own fetch, not the global one", async () => {
    const undiciFetchMock = vi.fn(async (_input: string, init?: LogoFetchInit) => {
      expect(init?.dispatcher).toBeInstanceOf(ProxyAgent);
      return httpRes(200, { "content-type": "image/png" }, stream(PNG));
    });
    vi.resetModules(); // drop the cached module so the re-import picks the mock up
    vi.doMock("undici", async (importOriginal) => ({
      ...(await importOriginal<typeof import("undici")>()),
      fetch: undiciFetchMock,
    }));
    const globalFetch = vi.fn(async () => {
      throw new Error("the proxied path must not use the global fetch");
    });
    vi.stubGlobal("fetch", globalFetch);
    try {
      const { createLogoFetcher: freshModule } = await import("./logo-fetch.ts");
      const fetcher = freshModule({
        resolve: async () => [{ address: "93.184.216.34" }],
        proxyUrl: "http://proxy.internal:8080",
      });
      const fetched = await fetcher.fetchFavicon("shop.example.com");
      expect(fetched?.mime).toBe("image/png");
      expect(undiciFetchMock).toHaveBeenCalledTimes(1);
      const [undiciUrl] = undiciFetchMock.mock.calls[0] as [string, LogoFetchInit | undefined];
      expect(undiciUrl).toBe("https://shop.example.com/favicon.ico");
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("undici");
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
