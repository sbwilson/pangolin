import { serveStatic } from "@hono/node-server/serve-static";
import { health, type SystemHealthPort } from "@pangolin/app";
import { type Context, Hono } from "hono";

export interface ApiDeps {
  readonly systemHealth: SystemHealthPort;
}

export interface AppDeps extends ApiDeps {
  /** Directory holding the built PWA. Omit to serve the API only. */
  readonly webRoot?: string;
}

/** The typed `/api/*` routes. `AppType` is derived from this for the Hono RPC client. */
export function createApi(deps: ApiDeps) {
  return new Hono().get("/api/system/health", (c) => {
    c.header("Cache-Control", "no-store");
    const result = health({ systemHealth: deps.systemHealth }, {});
    if (result.writable) return c.json(result, 200);
    return c.json(result, 503);
  });
}

export type AppType = ReturnType<typeof createApi>;

const notFound = (c: Context) => c.json({ error: { code: "NotFound", message: "Not found" } }, 404);

/** The whole HTTP surface: the API, then the static PWA with an SPA fallback to `index.html`. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.route("/", createApi(deps));
  app.all("/api/*", notFound);
  if (deps.webRoot !== undefined) {
    const root = deps.webRoot;
    // Hashed assets never change; the page shell and the service worker always revalidate.
    app.use("*", async (c, next) => {
      const immutable = c.req.path.startsWith("/assets/");
      c.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      await next();
    });
    app.use("*", serveStatic({ root }));
    // A missing hashed asset is a 404, never the page shell, and must not be cached.
    app.get("/assets/*", (c) => {
      c.header("Cache-Control", "no-store");
      return notFound(c);
    });
    app.get("*", serveStatic({ root, path: "index.html" }));
  }
  return app;
}
