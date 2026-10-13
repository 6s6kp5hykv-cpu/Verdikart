KISTEFUNN TEST 7.24 — EBAY ERROR TRACE PROPAGATION
Backend: v15.5.57-test7.24-ebay-trace-propagation
Base: uploaded Test 7.23 ZIP (v15.5.56-test7.23-ebay-error-diagnostics)
Status: Preview-only candidate. NOT deployed and NOT production-approved.

Root cause found in source:
Test 7.23 collected Retry-After, selected response headers and structured eBay API errors in result.diagnostic, but the later search_trace mapping copied only stage/status/code. Those details were therefore discarded before diagnostic_detail.ebay_search.trace reached the response/report.

Change:
- Only api/analyze.js changed.
- Propagates bounded error message, retry count, Retry-After, selected safe response headers and up to three structured API errors from diagnostic into each trace entry.
- Explicit allowlist for headers; no Authorization header, access token, client secret or raw headers are included.
- No changes to search queries, throttling, matching, filtering, valuation formulas or frontend.

Files:
- Replace Verdikart-Testrunner/api/analyze.js in the Testrunner Preview branch only.
- Keep this README and scripts/test-test7.24-ebay-trace-propagation.mjs as candidate documentation/checks.

Local validation scope:
- Node syntax check for api/analyze.js.
- Static regression assertions verify all required fields flow from result.diagnostic into search_trace and secret headers are not copied.
- ZIP integrity test.

Not yet done:
- No live eBay API test or Vercel Preview deployment in this build step.
- One Preview test with Nintendo Switch OLED is required after confirming deployed backend version v15.5.57-test7.24-ebay-trace-propagation.
- If 429 persists, use reported error message, request/correlation IDs, Retry-After and rate-limit headers to investigate. Do not interpret AI-only estimate as market-verified value.

Safety:
Test 7 baseline and Main/production remain untouched. Do not deploy to production without explicit approval.
