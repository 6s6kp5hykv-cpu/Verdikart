# Kistefunn Test 7.28 — market reference count fix

Backend version: `v15.5.61-test7.28-market-reference-count-fix`

## Changes

- `api/analyze.js`: counts references from the market candidates actually admitted by source combination, using eBay `sample_size` (the final valuation pool), web `valuation_reference_count`, and FINN `exact_match_count` when FINN is an active candidate. eBay is not valuation-eligible when its final pool is empty. The response's `market_data_status` follows whether any approved market references contribute.
- `index.html`: labels both bounds “AI-estimat” when the response says `ai_estimate_only`; numeric estimates are unchanged.
- `scripts/test-test7.28-market-reference-count.mjs`: exercises the backend's exported count, candidate eligibility, and eBay evidence helpers; checks their wiring into source combination; verifies disabled FINN is not counted despite a positive value and reference count; and executes the frontend label helper.

The local regression exercises the shared counting/eligibility helpers and verifies their wiring into `combineMarketSources()`. The full source combiner and request handler remain nested in the API handler and depend on request-local scoring state; invoking them in a local unit test would require a larger refactor. No API request was used.

## Local checks run

| Command | Result |
|---|---|
| `node --check api/analyze.js` | PASS |
| `node scripts/test-test7.28-market-reference-count.mjs` | PASS (backend helpers, source wiring, disabled FINN, frontend labels) |
| `node scripts/test-test7.27-valuation-consistency.mjs` | FAIL at the pinned Test 7.27 version assertion (`v15.5.60` expected); later assertions did not run. Historical file unchanged. |
| `node scripts/test-test7.25-package-gate.mjs` | FAIL at the pinned Test 7.25 version assertion (`v15.5.58` expected); later cases did not run. Historical file unchanged. |
| `node scripts/test-test7.26-fail-closed-package-valuation.mjs` | FAIL at the pinned Test 7.26 version assertion (`v15.5.59` expected); later cases did not run. Historical file unchanged. |

## Not yet verified

- No live Preview request was run. Validate `market_reference_count`, `market_data_status`, `valuation_basis`, eBay `sample_size`, and the used-listing audit against a Preview response.
- No external APIs were called. No packages were installed, and there was no push, branch change, or deployment.

Suggested Preview scenarios: AI-only with an empty final pool; eBay listings surviving into `finalPool`; robust web references contributing with eBay disabled; and exact-pool listings removed by the final valuation filters.
