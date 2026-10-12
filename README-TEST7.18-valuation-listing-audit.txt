KISTEFUNN — TEST 7.18 CANDIDATE
Backend: v15.5.51-test7.18-valuation-listing-audit
Base: uploaded/deployed Test 7.17 ZIP, backend v15.5.50-test7.17-marketplace-price-diagnostics
Status: CANDIDATE ONLY — not production-approved

PURPOSE
Expose the exact eBay listings behind the valuation so the next JSON report can connect each price to the title, direct listing URL, item ID, marketplace, search query, original price, currency, converted NOK price, match tier and whether the listing was used in the final valuation.

CHANGES
- Only api/analyze.js was modified in runtime logic.
- Added diagnostic-only valuation_listing_audit (up to 100 exact references, each marked used/excluded).
- Added diagnostic-only valuation_used_listing_audit (up to 100 references actually used in finalPool).
- Exposed both arrays in ebay_market_pipeline in diagnostic_detail.
- Added scripts/test-test7.18-valuation-listing-audit.mjs.
- No matching, filtering, price conversion or valuation-selection rules were intentionally changed.

FILES TO UPDATE IN THE Testrunner BRANCH
1. Replace api/analyze.js with this candidate's file.
2. Add scripts/test-test7.18-valuation-listing-audit.mjs (optional local static check).
3. Keep this README for version tracking.

LOCAL CHECKS
Run: node --check api/analyze.js
Run: node scripts/test-test7.18-valuation-listing-audit.mjs

PREVIEW TEST AFTER DEPLOY
1. Run the same text-only/custom test: Nintendo Switch OLED komplett konsoll, hvit Joy-Con, dock og strømforsyning.
2. Download the new JSON batch report.
3. Inspect ebay_market_pipeline.valuation_used_listing_audit. Each used row should have title, direct URL, original price, currency and NOK price.
4. Compare its count and price_nok values with the returned median/low/high and exact_prices_nok.
5. Review valuation_listing_audit rows marked excluded_after_exact_pool to see which otherwise-exact references did not influence the final value.
6. If any used row has missing title/URL/price/currency, treat as an unresolved diagnostic defect; do not change price filters yet.

SAFETY / SCOPE
- Preview/Testrunner only. Do not merge to Main or deploy Production without explicit user approval.
- Preserve Test 7.17 ZIP as baseline.
- This ZIP does not prove live eBay/Preview behavior; only the next real Preview report can verify the listing audit.
- URLs and titles are sourced from eBay listing records and are included only in the diagnostic report.
