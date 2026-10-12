KISTEFUNN TEST 7.17 — MARKETPLACE PRICE DIAGNOSTICS
Backend candidate: v15.5.50-test7.17-marketplace-price-diagnostics
Base: current Testrunner working tree with Test 7.16 backend v15.5.49.

Purpose
Add diagnostic breakdowns for accepted exact eBay references grouped by marketplace (EBAY_DE, EBAY_GB, EBAY_US, or EBAY_UNKNOWN). Each group reports count, median NOK, 15th/85th percentile NOK, and up to 30 sample NOK prices.

Scope
- Diagnostic-only change.
- Existing FX conversion path remains unchanged.
- No change to queries, scoring, filters, accepted listings, or valuation formula.
- Summary is included in backend eBay result and diagnostic_detail so a Preview report can expose it.
- This does not add FINN integration or calculate import/shipping costs.

Local validation
- node --check api/analyze.js: PASS.
- Static assertions for version marker and both summary output paths: PASS.
- ZIP integrity: to be verified after packaging.

Not verified
- No live eBay/OpenAI API call made during local build.
- No Vercel deploy performed by this build step.
- Live Preview must be tested before treating marketplace medians as evidence.

Next steps
1. Upload/commit only api/analyze.js and this README to Testrunner branch, or use the complete ZIP only if that is the established workflow.
2. Confirm Preview deployment uses v15.5.50-test7.17-marketplace-price-diagnostics.
3. Run the same Nintendo Switch OLED test.
4. Inspect exact_marketplace_price_summary and compare per-market medians and sample prices.
5. Re-run the Squier/Fender regression test.
6. Do not deploy to main/production without explicit approval.
