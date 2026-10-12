Kistefunn Testrunner — Test 7.20: Norwegian market-source audit
Backend: v15.5.53-test7.20-norway-market-audit
Base stated by candidate: Test 7.19 / v15.5.52-test7.19-package-completeness-audit
Status: Preview-only candidate; not production-approved.

PURPOSE
Add bounded diagnostics intended to show whether Norwegian FINN references are available, how many distinct references they provide, and which eBay marketplaces contributed.

SCOPE AND LIMITATIONS
This is diagnostic-only. It does not intentionally change source weights, search order, filtering, or the valuation formula. The Norwegian-first policy is a target, not an enforced behavior. The live report must be inspected to verify which fields are actually emitted and populated.

NEXT TEST
Deploy only to Testrunner Preview. Run the same Nintendo Switch OLED complete-set text test. Inspect market_source_priority_audit.finn, web_reference, and ebay if those fields are present in the report. Compare Norwegian source coverage and reference relevance before designing a Norwegian-first ranking change.

SAFETY
Do not deploy to main/production. Keep Test 7.18, 7.19 and 7.20 as separate baselines.
