---
review: tech-currency
target: ../ARCHITECTURE-SPINE.md
date: 2026-09-27
lens: "Was every committed decision checked against the web, the existing project or the current starter, rather than asserted from training data? Are versions current, does each named technology still exist and fit, and are a starter's live defaults confirmed?"
method: npm registry (`npm view`, `npm pack` plus a grep of the shipped code for drizzle-orm/drizzle-kit 1.0.0-rc.4, echarts/zrender 6.1.0 and temporal-polyfill 1.0.5), GitHub issues and PRs, MDN source, web search. Some official doc sites (orm.drizzle.team, echarts.apache.org, better-auth.com, devblogs.microsoft.com, developer.mozilla.org) are blocked by the egress proxy, so the review read package code, GitHub and search results instead.
---

# Tech-currency review: Pangolin Money v1 spine

## Verdict

**The Stack table's versions are current. Several conventions and ADs rest on library behaviour nobody checked, and four of those behaviours don't hold as written.** Every version in the Stack table matches the npm registry today, so the `.memlog.md` `(version)` entry holds up and wasn't repeated here. The checks stopped at version numbers, though. The gaps are in the **Web and HTTP security** convention (CSP against ECharts and shadcn/Radix/sonner), the **Tables** and **Migrations** conventions (against what drizzle-kit 1.0 RC actually emits and how its migrator runs), **AD-3** (a Drizzle RC query-filter behaviour that can silently drop a visibility predicate), and the TypeScript 6 + 7 set-up (how to install both, and whether TS 6 is needed at all).

## Confirmed (no action)

| Item | Evidence |
| --- | --- |
| Registry versions | `npm view` on 2026-09-27: hono 4.13.9, better-sqlite3 13.0.3, drizzle-orm/kit `rc` = 1.0.0-rc.4, zod 4.6.5, better-auth and @better-auth/passkey 1.7.6, vite 8.3.1, vitest 5.0.2, @tanstack/react-router 1.170.x, tailwindcss 4.3.3, shadcn 4.21.0, echarts 6.1.0, pdfjs-dist 6.3.289, temporal-polyfill 1.0.5, @biomejs/biome 2.5.14, decimal.js 10.6.0, typescript `latest` 7.0.2 (6.0.3 is the last 6.x). All match the Stack table. |
| better-sqlite3 13 on Node 26 | N-API build with prebuilds in the tarball; `engines.node >=22`; 13.0.3 ships a Node 26 prebuild. Versions 11.x break on Node 26 because of removed V8 APIs, so the pin matters. |
| FTS5 via better-sqlite3 | The bundled build (SQLite 3.53.4) compiles with `SQLITE_ENABLE_FTS5` and `SQLITE_ENABLE_JSON1` (docs/compilation.md). `STRICT` needs SQLite 3.37 or later, which this build meets. |
| Drizzle RC + better-sqlite3 | The drizzle-orm@1.0.0-rc.4 peer range is `better-sqlite3 >=9.3.0`. |
| **Does drizzle-kit 1.0 RC need the TypeScript compiler API?** | **No.** drizzle-kit@1.0.0-rc.4 has no `typescript` peer or dependency. It loads the config and schema through `jiti`, `esbuild` and `get-tsconfig`. The better-auth CLI (`auth@1.7.6`) also uses `jiti` plus `@babel/preset-typescript`. (Aside: drizzle-kit rc.4 still depends on the stale `@js-temporal/polyfill` 0.5.1. This affects dev tooling only.) |
| better-auth + Drizzle RC | better-auth 1.7.6 has the peer range `drizzle-orm ^0.45.2 \|\| >=1.0.0-rc.1 <2.0.0`, and the Drizzle adapter is bundled (`@better-auth/drizzle-adapter`). `@better-auth/passkey` 1.7.6 needs `zod ^4.5.4` and `@simplewebauthn/server ^13`. The pieces fit. |
| **Hono RPC with TS 7** | It works. The Hono author's benchmark on TS 7.0 shows Hono RPC inference 3–4x faster than TS 6 (400 routes: check time 0.89s down to 0.29s). TS 7 supports `--build` and project references, so the web-to-server type-only `AppType` import can still use references. The inference limits are the same as before: nested unions and complex Zod types can widen. |
| TanStack Router typed search params + Zod 4 | Pass the Zod 4 schema straight to `validateSearch` as a Standard Schema. **Do not add `@tanstack/zod-adapter`**, whose peer range is `zod ^3.23.8`. |
| Vite 8 ecosystem | `@tanstack/router-plugin` (vite `>=8`), `@tailwindcss/vite` (`^8`), `@vitejs/plugin-react` (`^8`), `vite-plugin-pwa` (`^8`) and `vitest` 5 (vite `^8`, node `>=26`) are all compatible. None of them needs the TS API. |
| pdfjs-dist 6 in Node | `engines.node >=22.13`. `@napi-rs/canvas` is optional and not needed for text extraction. Use `pdfjs-dist/legacy/build/pdf.mjs` and point `cMapUrl`/`standardFontDataUrl` at the package's `cmaps/` and `standard_fonts/`, or CJK and standard-font PDFs extract as blanks. The container is read-only, so these paths must sit inside the image. |
| Temporal | Node 26 ships Temporal unflagged. TS 6.0 includes `lib: esnext.temporal`. Browsers: Chrome/Edge 144+ and Firefox 139+ are native, and **Safari stable is not**, so the iOS PWA needs the polyfill. `temporal-polyfill/global` runs `install()`, which uses native Temporal when present (checked in `shim.js`). The default entry supports only the iso8601 and gregory calendars, which is enough here. |
| QSuper | Still operates as a brand of Australian Retirement Trust, with unit prices at `qsuper.qld.gov.au/investments/performance/unit-prices`. |
| Biome 2 import boundaries | `style/noRestrictedImports` with `patterns`/`group` and nested `biome.json` (`root: false`) can express the package graph. |

## Findings

### F1 — High — Web and HTTP security convention vs ECharts 6 (CSP `style-src`)

**Where:** Consistency Conventions → Web and HTTP security ("Strict CSP with no inline scripts or styles injected at runtime"). Stack → Apache ECharts 6.

**Reality check:**
- apache/echarts#19938 (bar, line and pie tooltips break under `style-src 'self'`) and #19570/#19398 (tree and SVG) are **still open**, with no maintainer resolution.
- In the echarts@6.1.0 and zrender@6.1.0 tarballs:
  - `component/tooltip/tooltipMarkup.js` builds HTML strings with `style="..."` attributes. They are written through `innerHTML`, so CSP blocks them.
  - `TooltipHTMLContent` sets `cssText`.
  - The canvas `Painter` root sets `domRoot.style.cssText`, and the SVG painter does the same.
- MDN lists `setAttribute('style')` and `style.cssText` as blocked by `style-src` without `'unsafe-inline'`. Only per-property assignment (`el.style.x = …`) is allowed.
- ECharts has no nonce option.

**Consequence:** With the default HTML tooltips, charts on CAP-17 insight and CAP-8 forecasting will throw CSP violations and render tooltips unstyled. The root container styling may break too, and this depends on the browser, so it has to be tested on Safari, Chrome and Firefox.

**Fix (pick one and write it down):**
- (a) Use the canvas renderer only, with `tooltip.renderMode: 'richText'` everywhere, and add a Playwright test that fails on any `securitypolicyviolation` event.
- (b) Relax the policy to `style-src 'self'; style-src-attr 'unsafe-inline'`. That permits style attributes only, not `<style>` elements, and keeps scripts strict. Record it as an accepted exception.
- (c) Choose a charting library that works under strict CSP. Also add "CSP fit" to the Stack verification checklist.

### F2 — High — Web and HTTP security convention vs shadcn/ui v4 on Radix, plus sonner. Tailwind 4 is fine.

**Where:** Same convention; Stack → Tailwind CSS / shadcn CLI 4 / 4.

**Reality check:**
- **Tailwind 4:** Production output is a static, hashed CSS file, so `style-src 'self'` works. Only Vite dev/HMR injects `<style>` tags, so the dev server needs its own, looser CSP. That split isn't stated anywhere.
- **shadcn on Radix:** Dialog, Sheet, AlertDialog, Select and DropdownMenu use `react-remove-scroll` → `react-style-singleton`, which **injects a `<style>` element at runtime**. ScrollArea and Select `Viewport` render their own `<style>`. Both need a nonce, through `get-nonce`'s `setNonce()` and the `nonce` prop (radix-ui/primitives#2057 and #3063).
- **sonner** (the shadcn toast) injects its CSS inline (emilkowalski/sonner#449). Its stylesheet has to be imported as a file instead.
- React `style={…}` props are set per property through CSSOM, which CSP allows, so Radix Popper positioning is fine.

**Consequence:** As written, "no styles injected at runtime" rules out the stock shadcn dialog, select and toast components. A nonce also means the PWA shell can no longer be a purely static file: Hono has to template a per-request nonce into `index.html`, which collides with service-worker caching of the shell.

**Fix:** Restate the convention as `style-src 'self' 'nonce-…'`. Hono injects the nonce into `index.html` and a `<meta property="csp-nonce">`, and the app calls `setNonce()` before rendering. Import `sonner`'s CSS as a file. Give dev its own CSP. Alternatively, evaluate shadcn v4 on Base UI, but still verify it for injected `<style>`. Put the same `securitypolicyviolation` e2e guard from F1 in CI.

### F3 — High — AD-3 visibility vs Drizzle 1.0.0-rc.4: RQB v2 silently drops `undefined` filters

**Where:** AD-3 (visibility composed into SQL, "including aggregates"). Stack → Drizzle "1.0 release candidate (pinned exactly)".

**Reality check:** In drizzle-orm@1.0.0-rc.4 `relations.js`, `relationsFilterToSQL` and `relationsFieldFilterToSQL` do `if (value === void 0) continue;`. A relational-query `where: { ownerId: viewer.personId }` with an `undefined` value therefore produces **no predicate at all**. Other empty inputs are also skipped without error: `OR: []`, `AND: []` and `isNull: false`. The open rc.5 PR (drizzle-orm#5966, not yet published) changes this to throw ("Unexpected 'undefined' in filter value"), and its notes list a fix for a "security vulnerability regarding `undefined` filter values". Meanwhile, **0.45.3 stable shipped on 2026-09-21**, while rc.4 dates from 2026-06-27. The stable line is maintained and the RC is three months old. The spine also doesn't say *which* RC it pins.

**Consequence:** A bug in a `Viewer` field or a partial object turns a scoped read into an unscoped one. That is exactly the leak AD-3 exists to prevent, and it happens quietly.

**Fix:**
- Name the exact pin (`1.0.0-rc.4`, or rc.5 once published) and note the behaviour change between them.
- Require `visibleAccounts(viewer)` to be a `sql` fragment or `RAW` filter that **throws** on a missing viewer, and never an object filter.
- Brand `Viewer` so its fields are never optional.
- Add a repository-level test per scoped table: a viewer with an `undefined` person must throw, not return rows.
- Alternatively, reconsider Drizzle 0.45.3 stable, which the memlog weighed as an option.

### F4 — Medium-High — Tables and Migrations conventions vs what drizzle-kit 1.0 RC actually emits and runs

**Where:** Conventions → Tables (`STRICT`) and Migrations ("Generated by drizzle-kit as SQL… Foreign keys are switched off around the migration transaction, then `PRAGMA foreign_key_check` must pass before commit. FTS5 tables and triggers are created in migrations").

**Reality check (drizzle 1.0.0-rc.4 code):**
1. **STRICT:** `sqlite-core` has no `strict` table option, and the drizzle-kit SQLite generator never emits `STRICT`. The request (drizzle-orm#202) sits on the roadmap, but the rc.4 code doesn't have it. Generated `CREATE TABLE` statements will be non-STRICT. A hand-added `STRICT` is lost the first time drizzle-kit **recreates** the table (`__new_<t>`, copy, drop, rename), which it does for most column alterations.
2. **FK off "around the transaction":** `migrateSync` in drizzle-orm (`sqlite-core/async/session.js`) wraps *all* pending migrations in a single `BEGIN … COMMIT` and has no hook before commit. drizzle-kit writes `PRAGMA foreign_keys=OFF/ON` *inside* the migration SQL, and SQLite ignores that pragma inside a transaction. So:
   - `PRAGMA foreign_keys=OFF` has to be set on the connection *before* `migrate()` is called;
   - `foreign_key_check` cannot run "before commit" unless the project writes its own runner on top of `readMigrationFiles()`.
3. **FTS5 + triggers:** Drizzle has no model for virtual tables. `drizzle-kit generate --custom` (present in rc.4) is the right tool. But when drizzle-kit recreates a content table (`transaction`, `payee`…), **the triggers are dropped with the old table**. Because IDs are ULID `TEXT` primary keys, rowids are not kept by `INSERT … SELECT`, so an external-content FTS5 index silently points at the wrong rows.

**Fix:**
- Decide on a thin custom migrator (`readMigrationFiles` → FK off on the connection → `BEGIN` → statements → `foreign_key_check` → `COMMIT`).
- Add a lint or CI step that rejects any generated `CREATE TABLE` without `STRICT`, or post-processes it in, and re-checks after every recreate.
- Declare FTS5 as contentless or `content_rowid`-stable, keyed on a stable `INTEGER` column.
- Require every migration that recreates a content table to recreate its triggers and run `INSERT INTO <fts>(<fts>) VALUES('rebuild')`.
- Extend the existing "CI applies them to … the previous release's database" step with an FTS row-count and match check.

### F5 — Medium — TypeScript 6 + 7 set-up is unverified, and TS 6's stated reason doesn't hold

**Where:** Stack → TypeScript ("`typescript` ~6.0 (compiler API for tooling); TypeScript 7.0 native checker for CI").

**Reality check:**
- `typescript@latest` is now 7.0.2, the Go build. Its only binary is `tsc`, and it ships no `tsserver` and no JS API.
- Microsoft's documented way to run both is the `@typescript/typescript6` compatibility package (binary `tsc6`), aliased so that `typescript` resolves to the 6.0 API while `tsc` comes from 7.0. The spine doesn't say how the two installs coexist, and both packages ship a `tsc` binary.
- Also, none of the named tools imports the TS API: drizzle-kit, the better-auth CLI, Vite 8, Vitest 5, the TanStack router plugin and Biome all check out. typescript-eslint isn't used. The "compiler API for tooling" reason is therefore unsupported.

**Fix:** Either drop TS 6 and use TS 7 alone (and say what the editor language service is), or name the tool that needs the 6.0 API and specify the aliasing (`"typescript": "npm:@typescript/typescript6@6.0.x"` and `"@typescript/native": "npm:typescript@7.0.x"`, or the Nx pattern). Configure Renovate so it can't cross the 6 → 7 major on `typescript`.

### F6 — Medium — Outbound allowlist vs Yahoo Finance's current access flow

**Where:** Outbound allowlist convention; Context diagram ("Yahoo Finance"); AD-8 (net lane, allowlisted hosts).

**Reality check:** Yahoo's unofficial chart and quote endpoints now need a cookie-and-crumb handshake (`fc.yahoo.com` → `/v1/test/getcrumb` → `query1`/`query2.finance.yahoo.com`), sometimes with consent redirects. `v7/finance/quote` returns 401 without a crumb. Rate limits are undocumented and change without notice. Two consequences: the allowlist has to list more than one host, and "`install.sh` generates the firewall rules from it" runs into Yahoo's CDN-rotated IPs, because a host firewall can't pin hostnames reliably.

**Fix:** Name the exact host set per `PriceSource`. Make the firewall rule an egress proxy or DNS-based allowlist instead of IP rules, or accept code-level enforcement only for CDN hosts. Treat Yahoo as best-effort: the self-healing "status page only" classification in AD-9 already fits this. Keep the issuer-NAV fallback.

### F7 — Low — Small currency and fit notes

- **better-auth telemetry:** `@better-auth/telemetry` is a hard dependency of better-auth 1.7.6. It is off by default, but the spine's "no third-party error tracking" and allowlist rules call for `telemetry: { enabled: false }` plus `BETTER_AUTH_TELEMETRY=0` in the Zod config schema, as a stated guarantee.
- **Biome type-only boundary:** The graph allows `apps/web` to import server code only for types (`AppType`). Whether `noRestrictedImports` pattern groups can tell `import type` apart is an open Biome discussion (biomejs/biome#7337). Verify this, or expose `AppType` through a dedicated `apps/server/rpc-types.ts` entry.
- **Temporal typing:** State that `shared` uses the *global* `Temporal`, typed with `lib: ["esnext.temporal"]`, and that the web entry imports `temporal-polyfill/global`. Importing `temporal-polyfill` as a module in `shared` would make the server use the polyfill instead of native Temporal.
- **Node 26:** On 2026-09-27 it is still "Current"; LTS status arrives on 2026-10-28, a month away. That's acceptable and already acknowledged, but `.nvmrc` should pin a minor version, not just `26`.
- **Deferred `node:sqlite`:** The spine says to revisit it "with Drizzle 1.0 final". drizzle-orm rc.4 already ships a `node-sqlite` driver, so the option is real now.

## Named technologies checked beyond the Stack table

| Named in | Technology | Status |
| --- | --- | --- |
| AD-2, AD-3, conventions | FTS5 via better-sqlite3 | Verified available. The migration interplay is F4. |
| AD-8, Context | Yahoo Finance, issuer NAV, QSuper/Aware unit prices, payee icons | Yahoo is F6. QSuper exists (under ART). Aware Super and the issuer-NAV hosts were not checked. |
| AD-9 | TanStack Query polling | Fine (v5). |
| AD-16 | Unix admin socket | `@hono/node-server` 2.1.1 (Node ≥20) can listen on a socket. It isn't named in the Stack table and should be. |
| Web security | CSP + ECharts / shadcn / Tailwind | F1 and F2. |
| Structural seed | Nginx Proxy Manager, Tang, TrueNAS restic REST, Ollama, Caddy, Tailscale, WireGuard, GHCR, cosign | Out of scope for package currency. restic and cosign versions were checked in the memlog. The Tang/Clevis LUKS unlock on Debian 13 was not checked. |
| PWA | Service worker tooling | Not named. `vite-plugin-pwa` supports Vite 8. Its `injectRegister` must not be `'inline'` under the CSP, and a nonce'd `index.html` (F2) must not be precached as a static shell. |
