KISTEFUNN TEST 7.6 – DIAGNOSTICS-ONLY CANDIDATE

Backend version: v15.5.40-test7.6-market-filter-diagnostics
Base: Verdikart-Testrunner.zip / Test 7.4 backend v15.5.39.

Change: api/analyze.js diagnostic_detail now reports already-computed eBay pipeline counts: raw exact, balanced exact, exact matches, price-filter removals, valuation exclusions, same-model matches, final sample size, distinct valuation count, near matches, dedupe/identity counts, successful query strings and marketplaces.

No intended change to eBay queries, filtering rules, valuation calculations, frontend, or Test Runner. This candidate is NOT deployed and is NOT production-approved. Keep Test 7 and main/production unchanged.

Validation required before Preview: ZIP integrity, JavaScript syntax, verify all active version strings and inspect diff. Then upload/deploy ONLY to separate Preview branch and run Nintendo Switch OLED once; inspect counts, then run Squier regression once. Do not repeat tests unless the report is incomplete.
