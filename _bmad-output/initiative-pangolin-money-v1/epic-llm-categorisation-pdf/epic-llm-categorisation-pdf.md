---
type: epic
title: "LLM categorisation and PDF statements"
parent: initiative-pangolin-money-v1
covers: [CAP-2, CAP-1]
after: []
assignee: ""
risk: high
---

# LLM categorisation and PDF statements

## Description

One LlmProvider interface with OpenAI-compatible and Anthropic-compatible adapters, per-purpose assignment, and encrypted keys. It serves batched categorisation suggestions, extraction of PDF statements checked deterministically against their balances, reading of set-aside import rows (`row_interpret`), and merchant names, links and locally served logos. Milestone M2.

## Outcome

Categorisation mostly happens by itself and any bank's PDF statement can be imported. Using the app weekly instead of the spreadsheets is the M2 gate.

## Done when

1. We use it weekly instead of the spreadsheets. (M2 gate)
2. Both adapters pass contract tests against the mock server, covering malformed JSON, timeouts, 429s and refusals. The eval harness reports accuracy, calibration and latency for any configured provider.
3. A synthetic PDF statement with known totals imports only when opening balance + Σ amounts = closing balance to the cent. A failing statement blocks, and shows its rows beside the page image.
4. A cloud provider receives only description, amount, date and the category list, and never a private transaction. PDF extraction is refused on a cloud provider unless it is explicitly enabled. Set-aside row interpretation runs on a local provider by default. It is refused on a cloud provider unless explicitly enabled, never sends a private account's row to one, and creates nothing until the person confirms.
5. Merchant logos are served from local attachments; the browser makes no third-party request.
6. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright, axe on its routes) is green on the release tag.

## Boundaries

packages/llm and PDF extraction in packages/importers. CAP-2 part: LLM suggestions and the confidence threshold, with suggestions at ≥ 90% confidence batched into one bulk-accept card until the threshold is tuned. CAP-1 part: PDF statements, and the `row_interpret` purpose for set-aside rows. The Settings › LLM providers card. Statements and logos use the attachment storage epic-import-dedupe-transfers builds; attachment storage itself is not this epic's. The loan rate-change target of `row_interpret` needs epic-loans-property, so until it ships only transaction proposals ship. Owns touch point Ollama on the LAN GPU machine.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-1, CAP-2
- llm — _bmad-output/specs/spec-pangolin-money/categorisation.md, section Providers
- set-aside rows — _bmad-output/specs/spec-pangolin-money/import-pipeline.md, step 1 (Parse)
- pdf — _bmad-output/specs/spec-pangolin-money/import-pipeline.md, section PDF statements
- architecture — _bmad-output/planning-artifacts/architecture/architecture-pangolin-2026-09-27/ARCHITECTURE-SPINE.md, AD-6, AD-8, AD-9, AD-10, AD-17, AD-18, AD-21
- ux — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/EXPERIENCE.md, sections Interaction Primitives (Import popover, steps 5 and 6), Needs review item kinds, Component Patterns (Accounts, settings, auth & feedback)
- mockups — _bmad-output/planning-artifacts/ux-designs/ux-pangolin-2026-10-05/mockups/key-settings.html, key-needs-review.html, key-import-popover.html
- change — _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-05.md, section E-8

## Notes

- Decision: the cross-epic contracts this epic adopts are settled in the architecture spine (final, 2026-09-27); see References.
- Decision (2026-10-05, D5): a third purpose, `row_interpret`, reads set-aside CSV/OFX/QIF rows; local by default, cloud only if explicitly enabled (`cloud_rows`), never for a private account's row, and it only proposes (AD-6).
- Decision (2026-10-05): attachment storage moves to epic-import-dedupe-transfers (AD-21); this epic adds statements and logos on it.
- Waits on epic-platform-foundations because: the job runner and the mock LLM server.
- Waits on epic-import-dedupe-transfers because: the pipeline stages, import_row staging, set-aside rows, attachment storage and the review inbox.
- Waits on epic-app-shell-settings-theming because: the LLM providers card sits on its Settings page.
