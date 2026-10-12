Kistefunn — Test 7.13 candidate
Backend version: v15.5.46-test7.13-console-accessory-fender-diagnostics
Status: local candidate only. NOT deployed, NOT Preview-verified, NOT approved for Main/production.
Base archive: Verdikart-Testrunner-5-version-reporting-fix.zip (Test 7.12 candidate + version-reporting fix).

WHY THIS CHANGE
The 2026-10-12 batch report showed three remaining quality issues:
1. A Nintendo Switch OLED console valuation included a cooling fan/radiator listing at accessory-level price. The Test 7.12 accessory regexes were double-escaped in JavaScript, so word boundaries did not work as intended.
2. An acrylic Switch OLED case target caused 115 eBay item-detail calls despite producing no accepted market references.
3. Fender Stratocaster returned zero approved market references, but existing diagnostics did not summarize scoreListing rejection reasons by search query/marketplace.

CHANGES IN THIS CANDIDATE
- api/analyze.js: backend version advanced to v15.5.46-test7.13-console-accessory-fender-diagnostics.
- Corrected the Test 7.12 console accessory regex escaping.
- Added cooling fan/radiator/heatsink/Lüfter/Kühler rejection terms, including the observed accessory title pattern.
- Detects explicit console-accessory targets and suppresses broad complete-console fallback queries for those targets.
- For those explicit accessory targets, skips eBay item-detail enrichment calls; normal search/valuation gates remain in place.
- Adds a bounded score_rejection_reasons histogram to per-query pipeline diagnostics to help diagnose Fender rejection without relaxing Fender/Squier gates.
- scripts/test-test7.13-regressions.mjs: local regression checks for the candidate's accessory patterns and complete-console bundle guard.

FILES TO REPLACE/ADD
1. Replace api/analyze.js in the Testrunner branch only.
2. Add scripts/test-test7.13-regressions.mjs.
3. Keep this README as a record of the candidate.
Do not replace the entire repository from this ZIP unless you explicitly intend to restore this archive snapshot. Do not merge/deploy to Main or production.

LOCAL CHECKS PERFORMED
- node --check api/analyze.js: PASS.
- node scripts/test-test7.13-regressions.mjs: PASS.
- ZIP integrity check: PASS.
- Version reporting: the candidate uses one BACKEND_VERSION constant and the existing response/diagnostic fields reference it.

NOT YET VERIFIED
- The candidate has not been deployed to Vercel Preview.
- No live API tests have been run against v15.5.46.
- This does not yet prove the Fender filter will accept correct Fender listings; the new rejection histogram is intended to reveal which gate is rejecting candidates.
- Re-run the same four tests on Preview after confirming the deployment commit/version. In particular:
  A. Nintendo Switch OLED complete console: fan/radiator/cooling parts must not enter the valuation pool; complete console/bundle listings should remain eligible.
  B. Nintendo Switch OLED acrylic case: correct accessory identification; no broad console fallback searches or item-detail enrichment calls for the accessory target.
  C. Fender Stratocaster standard: inspect score_rejection_reasons by query/marketplace; do not weaken the Fender/Squier variant gate.
  D. Squier Classic Vibe '50s Stratocaster: confirm Fender/Squier separation and inspect the two high references before changing valuation/outlier rules.

SAFETY / SCOPE
Test 7 baseline and Main/production are preserved. This is a candidate patch, not a claim of live success. Keep the previous ZIP as rollback and compare the actual deployed commit before interpreting another report.
