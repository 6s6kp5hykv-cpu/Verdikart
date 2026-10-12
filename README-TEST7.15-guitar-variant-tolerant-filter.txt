KISTEFUNN — TEST 7.15 CANDIDATE
Backend: v15.5.48-test7.15-guitar-variant-tolerant-filter
Base: Kistefunn-Test7.14-target-aware-filter.zip (backend v15.5.47-test7.14-shared-target-aware-filter)
Status: local candidate only. NOT deployed, NOT Preview-verified, NOT approved for Main/production.

PURPOSE
Reduce false rejection of relevant complete guitar listings without loosening Fender/Squier identity separation or admitting standalone parts.

CHANGES
- For guitar targets, generic accessory rejection no longer treats the words "pick", "pickup", "pickguard", "bridge" or "neck" by themselves as proof that the listing is a part. Complete guitar titles often mention these as normal features.
- Existing dedicated guitar completeness/part patterns remain in place, including patterns such as "pickguard only", "pickup(s) only", "bridge only", "neck only", "replacement neck/body", and "guitar body".
- If the user's explicit target text names a pickguard/plekterbrett and a color, a detected different pickguard color is rejected. When no pickguard color is explicitly requested, pickguard color remains flexible.
- Fender/Squier brand separation and target-driven model-variant logic are otherwise unchanged in this candidate.

LOCAL CHECKS COMPLETED
- node --check api/analyze.js: PASS
- scripts/test-test7.13-regressions.mjs: PASS
- scripts/test-test7.14-target-aware-filter.mjs: PASS
- scripts/test-test7.15-guitar-variant-tolerant.mjs: PASS
These are local syntax/static/mock regression checks only. No live API/eBay/Preview test was run during this build.

PREVIEW TEST PLAN (about 70% guitar, 30% general regression)
Guitar tests:
1. "Fender Stratocaster USA" — retain complete USA Stratocasters with different pickups, bridge configurations, body colors and pickguard colors; inspect each title and metadata.
2. "Fender Stratocaster USA black pickguard" — retain matching black pickguards and reject listings explicitly identifying white/other pickguards.
3. "Fender Stratocaster USA" — do not automatically mix MIM/Mexico models into exact valuation pool; inspect variant classification.
4. Fender target vs Squier/Squire listings — reject brand crossover.
5. Complete guitars mentioning pickups, bridge, neck, pickguard — retain when otherwise relevant.
6. Pickguard-only, pickup-only, replacement neck/body and other standalone parts — reject for complete-guitar targets.
7. Squier Classic Vibe '50s Stratocaster — ensure existing relevant results remain and inspect the tightly clustered prices/outliers from the prior report.

GENERAL REGRESSION TESTS:
8. Nintendo Switch OLED complete console — retain complete consoles, reject cases/fans/parts.
9. Nintendo Switch OLED acrylic case — find cases, do not value complete consoles as cases.
10. One non-guitar complete product/accessory pair if available in Test Runner, to ensure category-specific logic has not changed unexpectedly.

SAFETY
- Preserve uploaded Test 7 baseline unchanged.
- Do not deploy to Main/production.
- Upload this candidate only to the Testrunner/Preview branch, verify the exact backend version in the report, then run live Preview tests.
- Review actual listing titles and IDs, not just the number of hits. Do not approve valuation from count alone.
