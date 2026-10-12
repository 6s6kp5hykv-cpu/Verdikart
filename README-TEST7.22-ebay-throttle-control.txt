Kistefunn – Test 7.22: eBay throttle control
Backend: v15.5.55-test7.22-ebay-throttle-control
Base: uploaded Verdikart-Testrunner(3).zip / Test 7.21 backend v15.5.54
Status: local candidate only; not deployed and not production-approved.

Changes in api/analyze.js:
- Caps eBay Browse search concurrency at 2 requests.
- Caps candidate-detail enrichment concurrency at 3 per result-processing worker; result processing itself is limited to 2 workers.
- Retries an HTTP 429 once, waiting for Retry-After up to 2 seconds or 750 ms when missing/invalid.
- Adds retry_count and retry_after to failed-search diagnostics.
- Preserves existing query generation, listing filters, valuation logic, and AI fallback.

Important limitation:
This is a controlled test of request burst/concurrency behavior, not proof that eBay rate limits are the cause. If 429 persists, check the complete eBay response and application entitlement/rate limits. No live Preview test has been run by this local build.

Local checks to run:
- node --check api/analyze.js
- node scripts/test-test7.21-esm-runtime-fix.mjs
- node scripts/test-test7.22-ebay-throttle-control.mjs
- all existing Test 7 regression scripts

Do not deploy to Main/production without explicit user approval after Preview verification.
