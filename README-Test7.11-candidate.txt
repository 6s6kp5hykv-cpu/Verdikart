KISTEFUNN TEST 7.11 CANDIDATE — based on Test 7.10 / backend v15.5.44

Candidate only. Not deployed and not approved for production.
Original supplied ZIP is preserved unchanged.

Changes in this candidate:
1. api/analyze.js returns explicit valuation_basis, market_reference_count, and market_data_status fields. This distinguishes an AI-only estimate from a value supported by accepted market references.
2. api/analyze.js diagnostics now distinguish HTTP-200 search calls from the successful_queries list, which represents usable search queries. This helps explain cases where eBay requests succeeded but zero listings passed valuation filters.
3. test-runner.html includes these new fields in each result report.

Checks completed locally:
- node --check api/analyze.js: PASS
- node --check api/lib/openai.js: PASS
- node --check lib/variants.js: PASS
- bash -n scripts/preview-access-check.sh: PASS
- node --check for extracted inline scripts in test-runner.html: PASS
- source assertions for new diagnostics/valuation fields: PASS

Not tested here:
- Live OpenAI/eBay API calls
- Real Preview deployment and integration behavior
- Browser test-runner run against this candidate
- Market filter quality against a reviewed sample of actual ads

Safety:
- No deployment performed.
- No main/production files changed.
- No API requests made by these local checks.
