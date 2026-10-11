KISTEFUNN — TEST 7.1 CANDIDATE
Date: 2026-10-11

Versions
- Frontend: v15.5.25-test7
- Backend: v15.5.34-test7.1
- Parent/reference: uploaded Verdikart-Test 6.zip
- This is a separate candidate. It has NOT been deployed.

Changes in Test 7.1 (working candidate)
1. Generalized the exact-reference web-search instruction so it no longer tells searches for every product category to avoid other Patek Philippe watch models.
2. Aligned frontend diagnostic version/capture labels with v15.5.25-test7.
3. Removed one duplicate "Mine funn" panel, which duplicated the findsPanel and findsList HTML IDs.
4. No changes to eBay query strategy, model identification, or account deletion logic. Test 7.1 includes the targeted price-parser and positive-value validation corrections documented below.

Validation scope
- Run JavaScript syntax checks on api/*.js, api/lib/*.js, lib/*.js, and inline scripts in index.html.
- Validate manifest.webmanifest JSON.
- Check duplicate HTML IDs.
- Check that the new web prompt is generic and version strings align.
- These are local/static checks only. Live eBay/OpenAI, Supabase account deletion, and Preview/production behavior have not been verified by this ZIP creation.

Safety
- Keep Test 6 original ZIP as the untouched reference.
- Do not deploy Test 7 to production until Preview tests pass.


Test 7.1 candidate changes (not deployed)
1. Fixed NOK price parsing for grouped thousands in price ranges (e.g. 1 000–1 500 kr).
2. Empty, text-only, zero and negative valuation inputs now return null instead of being accepted as prices.
3. AI market-source fields now require positive values (defence in depth).
4. Aligned runtime backend version fields with v15.5.34-test7.1 for success and error responses/diagnostics.
5. These are targeted candidate changes only; live eBay/OpenAI/Supabase behavior remains unverified.
