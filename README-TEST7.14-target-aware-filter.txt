KISTEFUNN — TEST 7.14 CANDIDATE
Backend: v15.5.47-test7.14-shared-target-aware-filter
Base: uploaded Verdikart-Testrunner.zip, backend v15.5.46-test7.13-console-accessory-fender-diagnostics
Status: local candidate only. NOT deployed, NOT Preview-verified, NOT approved for Main/production.

PURPOSE
Reduce false rejection while keeping clear wrong-item protections. Filter behavior is now target-aware: an accessory keyword is not automatically a rejection if the user is searching for that accessory.

CHANGES
- Added shared target accessory intent detection from target category/model/type, including the existing explicit console accessory intent.
- The global accessory/part rejection gate now applies only when the target is not itself an accessory.
- Complete-guitar/variant and complete-console gates are skipped for explicit accessory targets so the parent item's completeness rules do not reject the accessory being sought.
- Fender family gate no longer hard-rejects every named sub-series when the target is generic. It still rejects a listing when the target explicitly specifies a variant and the listing does not match that target family. This is intentionally a candidate behavior change and needs validation for Fender/Squier separation.
- Added a dedicated target-aware filter regression test.

LOCAL CHECKS
- node --check api/analyze.js: PASS
- node scripts/test-test7.13-regressions.mjs: PASS
- node scripts/test-test7.14-target-aware-filter.mjs: PASS
- Tests are static/regression checks only; no live API/eBay requests were run here.

NEXT PREVIEW TESTS
1. Nintendo Switch OLED complete console: reject case/fan/parts but retain complete console listings.
2. Nintendo Switch OLED acrylic case: find case listings and exclude complete consoles.
3. Fender Stratocaster standard: confirm useful guitar listings return; inspect model variants before using prices.
4. Squier Classic Vibe '50s: confirm Squier stays separate from Fender and inspect the high-price outliers.

SAFETY
Keep Test 7 baseline and Main/production unchanged. Upload/commit this candidate only to the Testrunner branch, verify the Preview commit and backend version, then run the four live tests. Roll back by restoring the prior Test 7.13 candidate if Preview results regress.
