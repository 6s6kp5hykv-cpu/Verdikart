Kistefunn Test 7.7 – market pipeline stage diagnostics
Backend: v15.5.41-test7.7-market-pipeline-stage-diagnostics
Based on: Test 7.6 / v15.5.40-test7.6-market-filter-diagnostics

Purpose
- Identify where eBay raw results disappear before becoming valuation candidates.
- Add per marketplace/query counts for title, itemId, URL, numeric price, currency, both price+currency, score accepted, near-match, score rejected, prepareListing accepted/rejected.
- Include up to three bounded prepared listing examples per query (title truncated to 100 chars; price/currency/NOK/match tier only).
- Keep the existing market acceptance and valuation rules unchanged.
- Update diagnostic version to diag-v4.

Important
- This is a candidate for the Testrunner branch only.
- Not deployed by this ZIP creation; deploy separately as Preview and confirm backend_version.
- Do not merge to main or deploy production.
- After Preview confirms v15.5.41, run Nintendo Switch OLED once and inspect diagnostic_detail.ebay_market_pipeline.stage_trace.
- Then run Squier regression once to ensure existing variant filtering remains intact.
- Local syntax checks do not substitute for live Preview verification.
