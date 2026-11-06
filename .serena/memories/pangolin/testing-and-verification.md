# Pangolin - how to run checks
- Vitest runs ONLY from the repo root: pnpm test (= vitest run, config vitest.config.ts, include apps,packages,tools,scripts,deploy). pnpm --filter @pangolin/app test / @pangolin/web test do not exist (no test scripts) and fail.
- Targeted: npx vitest run apps/web packages/app/src/planning <paths...>. Full run ~4 min.
- pnpm typecheck = tsc per package + root tsc -p . --noEmit (root also covers e2e/*.spec.ts).
- pnpm lint = biome check (warnings do not fail, errors do) + scripts/check-boundaries.ts.
- E2E: Playwright in e2e/ (project @pangolin/e2e), config e2e/playwright.config.ts, testDir '.' - new specs auto-collect in the chromium project unless listed in testIgnore. Needs the compose/Docker stack (pnpm e2e); Docker was unavailable in the Nov 2026 sandbox, so e2e was only typechecked + --list collected locally, executed in CI.
- packages/app/src/testing/memory-uow.ts mirrors db-core FK semantics: deleting a referenced row must throw ForeignKeyViolation (repo-parity.test.ts catches drift).
- Story plans for BMAD live in _bmad-output/initiative-pangolin-money-v1/tickets/epic-goals-savings/tickets/; the .build/{story} work-directory convention from the plan does not exist in this repo.