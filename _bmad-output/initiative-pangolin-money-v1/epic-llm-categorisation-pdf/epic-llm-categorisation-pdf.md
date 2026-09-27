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

One LlmProvider interface with OpenAI-compatible and Anthropic-compatible adapters, per-purpose assignment, and encrypted keys. It serves batched categorisation suggestions, extraction of PDF statements checked deterministically against their balances, and merchant names, links and locally served logos. Milestone M2.

## Outcome

Categorisation mostly happens by itself and any bank's PDF statement can be imported. Using the app weekly instead of the spreadsheets is the M2 gate.

## Done when

1. We use it weekly instead of the spreadsheets. (M2 gate)
2. Both adapters pass contract tests against the mock server, covering malformed JSON, timeouts, 429s and refusals. The eval harness reports accuracy, calibration and latency for any configured provider.
3. A synthetic PDF statement with known totals imports only when opening balance + Σ amounts = closing balance to the cent. A failing statement blocks, and shows its rows beside the page image.
4. A cloud provider receives only description, amount, date and the category list, and never a private transaction. PDF extraction is refused on a cloud provider unless it is explicitly enabled.
5. Merchant logos are served from local attachments; the browser makes no third-party request.
6. Deployed to the home server with `pangolin upgrade`, and CI (lint, types, unit, migration, Playwright) is green on the release tag.

## Boundaries

packages/llm and PDF extraction in packages/importers. CAP-2 part: LLM suggestions and the confidence threshold. CAP-1 part: PDF statements. Owns touch point Ollama on the LAN GPU machine.

## References

- spec — _bmad-output/specs/spec-pangolin-money/SPEC.md, CAP-1, CAP-2
- llm — _bmad-output/specs/spec-pangolin-money/categorisation.md
- pdf — _bmad-output/specs/spec-pangolin-money/import-pipeline.md, section PDF statements

## Notes

- Open question: architecture spine (bmad-architecture, pending) must settle the job table/runner contract and the visibleAccounts()/redact() contract before inception; cite its section in References once written.
