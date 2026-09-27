# Tech stack

TypeScript end to end, strict mode, one repo. Every choice below is mainstream and well documented, so AI coding tools and search results cover it well.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript 5 (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | Closest to Swift/Rust discipline available on the web |
| Runtime | Node 22 LTS | Most stable; Bun optional later |
| Package manager | pnpm workspaces | Cargo-workspace equivalent |
| HTTP server | Hono | Small and typed, with typed RPC clients for the frontend |
| Database | SQLite via better-sqlite3, WAL mode | Synchronous, fast, single file |
| Queries + migrations | Drizzle ORM + drizzle-kit | SQL-shaped, typed, generates migration SQL you commit |
| Validation | Zod | Parse at every boundary (CSV rows, API bodies, LLM output) |
| Auth | better-auth | Passkeys, TOTP (authenticator codes), sessions, rate limiting |
| Frontend | React 19 + Vite | Largest ecosystem |
| UI kit | shadcn/ui + Tailwind CSS | Copy-in components you own |
| Data fetching | TanStack Query | Caching, refetch, optimistic edits |
| Routing | TanStack Router | Type-safe routes and search params (filters live in the URL) |
| Tables | TanStack Table + virtualisation | Transaction list with thousands of rows |
| Charts | Apache ECharts | Sankey, stacked area, treemap and calendar heatmaps built in |
| Money | Integer cents in a branded `Cents` type; `decimal.js` only for unit prices and FX | No floats anywhere near money |
| Dates | Temporal polyfill (`@js-temporal/polyfill`) | Plain dates without timezone bugs; FY and fortnight maths |
| Tests | Vitest (unit), Playwright (end to end) | Fast; Playwright drives a real browser in CI |
| Lint/format | Biome | One tool, like rustfmt + clippy |
| LLM | Two provider adapters: OpenAI-compatible (Ollama, LM Studio, vLLM, OpenAI, OpenRouter) and Anthropic Messages API; optional API key; schema-constrained output | Local by default; cloud only by explicit opt-in |
| Reverse proxy | Nginx Proxy Manager (existing); bundled Caddy as an optional Compose profile | NPM already handles Let's Encrypt; Caddy covers installs without a proxy |
| Backups | restic (encrypted, deduplicated) + `VACUUM INTO` snapshots | Consistent snapshot, encrypted copy to TrueNAS in append-only mode |
| CI/CD | GitHub Actions to GHCR images; Renovate for updates | Tag-driven releases |

## Architecture

One Node process serves the API and the built frontend, runs scheduled jobs, and is the only thing that writes to SQLite. That matches SQLite's single-writer model and keeps operations to one app container behind the reverse proxy already in use (Nginx Proxy Manager). A bundled Caddy is available as an optional Compose profile for installs without a proxy.

- **Frontend:** a React single-page app, served as static files by the same process. It is installable on phones as a PWA.
- **Domain services:** plain TypeScript modules with no HTTP or database types in their signatures (ledger, import, rules, budgets, forecasting, tax). They are unit-tested in isolation, the same split you'd use in a Rust crate.
- **Job runner:** jobs are rows in a SQLite table, polled in-process. It handles price and unit-price fetches, the LLM categorisation and PDF-extraction queues, recurring-bill detection and nightly backups. It needs no Redis or queue server.
- **Ollama** on a LAN machine with a GPU is the default LLM. The provider is configurable: any OpenAI-compatible or Anthropic-compatible endpoint, with an optional API key.

## Repo layout

A pnpm workspace. `domain` depends on nothing but `shared`, so the core logic stays testable and portable, the same way you'd isolate a Rust core crate.

```text
pangolin/
├─ apps/
│  ├─ server/          Hono API, auth, job runner, static hosting
│  └─ web/             React + Vite PWA
├─ packages/
│  ├─ shared/          Zod schemas, branded types (Cents, AccountId), money + date utils
│  ├─ domain/          ledger, import, rules, transfers, budgets, recurring, goals, lots, tax
│  ├─ db/              Drizzle schema, migrations, repositories, visibleAccounts(), redact()
│  ├─ importers/       OFX, QIF, CSV profiles, PDF extraction + anonymised samples
│  ├─ connectors/      price sources, super unit-price fetchers
│  └─ llm/             provider adapters (OpenAI, Anthropic), prompts, schemas, eval harness
├─ tools/
│  ├─ mock-llm/        replays recorded OpenAI- and Anthropic-format responses
│  ├─ mock-prices/     offline price and unit-price server
│  └─ seed/            synthetic household generator (files + PDFs)
├─ deploy/            compose.yaml (+ optional caddy profile), install.sh, pangolin CLI
├─ e2e/               Playwright tests
└─ .github/workflows/ ci.yml, release.yml, restore-test.yml
```
