KISTEFUNN — TEST 7 CANDIDATE
Date: 2026-10-10

Versions
- Frontend: v15.5.25-test7
- Backend: v15.5.34 TEST 7 CANDIDATE
- Parent/reference: uploaded Verdikart-Test 6.zip
- This is a separate candidate. It has NOT been deployed.

Changes in Test 7
1. Generalized the exact-reference web-search instruction so it no longer tells searches for every product category to avoid other Patek Philippe watch models.
2. Aligned frontend diagnostic version/capture labels with v15.5.25-test7.
3. Removed one duplicate "Mine funn" panel, which duplicated the findsPanel and findsList HTML IDs.
4. No changes to market valuation formulas, eBay query counts, model identification, or account deletion logic.

Validation scope
- Run JavaScript syntax checks on api/*.js, api/lib/*.js, lib/*.js, and inline scripts in index.html.
- Validate manifest.webmanifest JSON.
- Check duplicate HTML IDs.
- Check that the new web prompt is generic and version strings align.
- These are local/static checks only. Live eBay/OpenAI, Supabase account deletion, and Preview/production behavior have not been verified by this ZIP creation.

Safety
- Keep Test 6 original ZIP as the untouched reference.
- Do not deploy Test 7 to production until Preview tests pass.
