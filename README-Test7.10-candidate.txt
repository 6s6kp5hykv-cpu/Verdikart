KISTEFUNN TESTRUNNER CANDIDATE — Test 7.10 / backend v15.5.44

Based on the supplied Testrunner Test 7.10 candidate ZIP. This is a candidate only; not deployed and not approved for production.

Changes:
1. api/analyze.js: request-scoped cache for repeated eBay item-detail lookups, keyed by marketplace + itemId. Cached enrichment fields are merged into each listing without replacing its own query metadata. Adds cache-hit counter.
2. api/analyze.js: adds eBay median, low/high percentiles, exact NOK price list (capped at 100), and related diagnostics to help identify which source produced suspicious low estimates.
3. test-runner.html: report version v3 includes AI estimate/range, normal low, bargain low, and market source weights when returned by backend. Keeps the two-test runner.

Important: Existing live report cannot show the complete exact-price distribution because the older backend diagnostic omitted it. This candidate must be deployed to the Testrunner Preview before a new live report can verify the cache behavior and price-source diagnosis. Do not deploy to main/production without explicit approval.
