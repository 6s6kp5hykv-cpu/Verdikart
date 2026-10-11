Kistefunn – Test 7.9 rejection diagnostics candidate

Backend version: v15.5.43-test7.9-rejection-diagnostics
Base: uploaded Testrunner ZIP containing v15.5.42-test7.8-market-pipeline-scope-fix.

Change: the market-pipeline diagnostic trace now records score_rejection_reasons (counts grouped by scoreListing reason) and up to five score_rejected_sample entries for each marketplace/query trace. Samples contain title, score, reason, year_match, and variant_match only.

Intent: diagnostic-only change. It does not intentionally alter search queries, acceptance thresholds, scoring, filtering, or valuation.

Validation still required: run local JavaScript syntax checks and test on a Preview/Testrunner deployment. No live eBay/OpenAI test was performed while building this ZIP. Do not deploy to main/production without explicit approval.
