# Categorisation, merchants and the local LLM

Rules decide; the LLM only suggests. A transaction is categorised by the first of:

1. a matching rule;
2. the payee's default category;
3. an LLM suggestion.

An LLM suggestion is applied automatically only above a confidence threshold tuned from our own acceptance rate. Everything else waits in the review inbox.

## LLM call design

- Transactions are sent in batches of about 20. Each prompt includes the category list and up to 10 similar past transactions already categorised, found with SQLite full-text search (FTS5). No vector database is needed.
- Output is constrained by a JSON schema (`payee_name`, `website_domain`, `category_id`, `confidence`, optional `tax_category_id`, `activity_id`). It is validated with Zod, and a category ID that doesn't exist is rejected.
- Tax categories and activities are only ever suggested, never auto-applied.
- Each suggestion records model, prompt version and outcome, which gives a real accuracy figure per model.
- Bank descriptions are untrusted text, so prompt injection is possible. The model has no tools that act on anything and can only return a schema-shaped suggestion, which caps the damage at a wrong guess.
- Default: a 7–14B instruct model on Ollama on the GPU machine. Any provider below can be swapped in and compared on the same review data.

## Providers

- **One `LlmProvider` interface, two adapters:**
  - **OpenAI-compatible** (`/v1/chat/completions`): Ollama, LM Studio, vLLM, llama.cpp server, OpenAI, OpenRouter. Structured output uses the JSON-schema response format; servers without it fall back to JSON mode + Zod validation.
  - **Anthropic-compatible** (`/v1/messages`, `x-api-key` and `anthropic-version` headers). Structured output comes from a single forced tool call.
- **Configuration and keys:**
  - Each provider has a base URL, model, and optional API key.
  - Keys are encrypted at rest, never logged, and never sent to the browser.
- **Per-purpose assignment:** each purpose (categorisation, PDF extraction) is assigned to a provider. For example, categorisation can use a cloud model while PDFs stay local.
- **Cloud providers get the minimum data:**
  - Only description, amount, date and the category list are sent.
  - Account names, people and private transactions never are.
  - Settings shows exactly what a request contains.
- **Tests:**
  - Contract tests run both adapters against a local mock server replaying recorded OpenAI- and Anthropic-format responses, including malformed JSON, timeouts, 429 rate limits and refusals.
  - An evaluation harness scores any configured provider on a labelled synthetic transaction set: accuracy, confidence calibration, latency.
  - Live tests against real endpoints run only when a key is present in CI secrets; they're off by default.

## Merchants, logos and links

- The LLM proposes a clean name and a likely website domain. Confirmed once per payee, and the domain becomes the payee's link.
- The job runner fetches that site's icon once, stores it as an attachment, and serves it locally.
  - The browser never loads logos from third parties, because a logo request from the browser would reveal what we buy.
  - Only the bare domain leaves the server, once.
- Logo fetching can be switched off entirely.

## Default categories

A sensible Australian starting set. Every category can be renamed, merged or hidden, and rules and the LLM work from whatever the tree is. Tax labels are suggestions only; applying one still needs confirmation.

| Group | Categories | Suggested ATO label |
| --- | --- | --- |
| Income | Salary, Rental income, Interest, Distributions and dividends, Refunds, Other income | Reported as income, not deductions |
| Housing | Rent, Mortgage repayments, Rates and strata, Home maintenance, Home and contents insurance | — |
| Utilities | Electricity, Gas, Water, Internet, Mobile | — |
| Food | Groceries, Dining out, Takeaway and delivery, Coffee, Alcohol | — |
| Transport | Fuel, Public transport, Tolls, Parking, Rideshare, Registration and CTP, Car insurance, Servicing | D1 for work car use (needs a logbook or trip record) |
| Health | GP and specialists, Pharmacy, Dental, Optical, Private health insurance, Fitness | — |
| Personal | Clothing, Hair and beauty, Gifts, Donations | D9 for donations to registered charities |
| Lifestyle | Entertainment, Subscriptions, Hobbies, Books and media | — |
| Travel | Flights, Accommodation, Activities, Travel insurance | D2 when it's work travel |
| Work and study | Professional registration and memberships, Indemnity insurance, Courses and conferences, Books and equipment | D5; courses D4 |
| Financial | Bank fees, Interest charges, Tax agent fees, Life and income protection insurance | D10 tax agent; D15 income protection outside super |
| Investment property | Loan repayments, Agent fees, Council rates, Repairs, Insurance, Other property costs | Rental schedule on the owner's return |
| Transfers (not spending) | Between our accounts, Credit card payment, To savings, To investments | Excluded from spending and income |
