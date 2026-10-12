KISTEFUNN TEST 7.12 — CANDIDATE BACKEND v15.5.45
Based on uploaded Verdikart-Testrunner 3.zip (backend v15.5.44 / Test 7.10).

Changes in this candidate:
1. Adds an early console accessory-only gate for Joy-Con/controller-only listings, acrylic/protective cases, screen protectors, and dock/charger-only listings.
2. Keeps normal complete-console bundles eligible when the title explicitly indicates a console/system/handheld/bundle.
3. Adds explicit accessory terms to the existing console part rejection list.
4. Updates api/analyze.js version header to v15.5.45-test7.12-console-accessory-gate-candidate.

Local checks performed:
- node --check api/analyze.js: PASS
- node --check api/lib/openai.js: PASS
- node --check lib/variants.js: PASS
- bash -n scripts/preview-access-check.sh: PASS
- Static assertions for version, accessory patterns, rejection reason, and valuation fields: PASS

Not performed:
- No live OpenAI/eBay API calls.
- No real Preview deployment or integration test.
- No GitHub changes made by this assistant.
- No production deployment.

Important limitation:
This patch targets the proven Nintendo accessory leakage. It does not yet resolve the Fender zero-reference issue or verify the six Squier references. Those require separate diagnosis and regression tests.
