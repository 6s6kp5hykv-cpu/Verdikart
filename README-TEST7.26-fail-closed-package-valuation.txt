KISTEFUNN — TEST 7.26: FAIL-CLOSED SWITCH PACKAGE VALUATION GATE
Backend: v15.5.59-test7.26-fail-closed-package-valuation-gate
Base: uploaded Verdikart-Testrunner (2).zip, backend v15.5.58 Test 7.25
Status: local candidate only. NOT deployed; NOT Preview-verified; NOT production-approved.

Finding
The Test 7.25 report showed market_data_status=market_supported and a market-influenced estimate while ebay_market_pipeline reported zero final sample/distinct valuation references and an empty used-listing audit. The eBay source enabled predicate checked enabled + positive median, but did not require post-package-gate evidence.

Change
- api/analyze.js: eBay may be enabled as a valuation source for Switch OLED only if the package gate is not active, or the post-gate sample size and distinct valuation count are each at least 3 and valuation_used_listing_audit has at least 3 entries.
- This is a fail-closed source eligibility gate. It does not change eBay search queries or relax package/title filtering.
- Backend version advanced to v15.5.59-test7.26-fail-closed-package-valuation-gate.
- Added scripts/test-test7.26-fail-closed-package-valuation.mjs.

Files changed
1. api/analyze.js
2. scripts/test-test7.26-fail-closed-package-valuation.mjs (new)
3. README-TEST7.26-fail-closed-package-valuation.txt (new)

Local checks
- node --check api/analyze.js: PASS
- Test 7.26 fail-closed package valuation: PASS (4 behavioral cases + source assertions)
- Test 7.25 package gate regression: PASS (5 classification cases + source assertions)

Not yet done
- Full regression suite has legacy version-pinned tests that fail when run against a newer version; these need review/update rather than being treated as functional failures.
- No live Preview test performed by this local change.
- Need deploy to Testrunner Preview only, then run Nintendo Switch OLED text-only test and verify market_data_status, valuation_basis, sample_size, distinct_valuation_count, and valuation_used_listing_audit all agree.
- This patch does not yet guarantee low/high ranges are from the same pool in every path; verify that in Preview report.

Safety
Main and production unchanged. Do not deploy/merge to Main or production without explicit approval.
