KISTEFUNN — TEST 7.1 CANDIDATE
Date: 2026-10-11

Versions
- Frontend: v15.5.25-test7
- Backend: v15.5.36-test7.1
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


Test 7.2 candidate change (2026-10-11)
6. Backend v15.5.36-test7.1 adds color-aware comparable selection for guitar listings. If the target explicitly names a color, exact-color references become the primary exact pool when at least two are available. If fewer than two are available, other colors remain as fallback evidence. If no target color is specified, color does not filter otherwise-valid comparisons. The target parser distinguishes White Blonde and Olympic White before generic white. Sunburst recognizes 2-/3-tone and 2-/3-color wording.
7. This is a local candidate only. Preview/live eBay validation is still required; do not deploy to production yet.


TEST 7.3 — TEKSTSØK UTEN BILDE
Backend: v15.5.38-text-search
Frontend: v15.5.27-test7.2-text-search

Nytt: Brukeren kan identifisere/søke etter en gjenstand ved å skrive merke/modell i beskrivelsesfeltet uten å laste opp bilde. Knappen aktiveres når bilde eller tekst er til stede. Backend godtar tekst alene, og OpenAI får ikke et input_image-felt når bilde mangler. Prompten instruerer modellen til ikke å påstå visuelle observasjoner i tekstmodus.

Teststatus: lokale syntaks- og pakkekontroller bestått. Ikke deployet. Må verifiseres i Preview med (1) tekst alene, (2) bilde alene, (3) bilde + tekst. Kontroller også at tekst uten oppgitt farge ikke snevrer inn fargesøket.
