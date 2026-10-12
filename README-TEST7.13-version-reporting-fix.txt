KISTEFUNN — VERSION REPORTING FIX (TEST 7.13 CANDIDATE)
Date: 2026-10-12

Base:
- Uploaded archive: Verdikart-Testrunner 5.zip
- Existing code header: v15.5.45-test7.12-console-accessory-gate-candidate
- Bug found: runtime response/diagnostic version fields still hard-coded as
  v15.5.44-test7.10-details-cache-price-diagnostics (7 occurrences).

Change:
- api/analyze.js now defines BACKEND_VERSION once as
  v15.5.45-test7.12-console-accessory-gate-candidate.
- All seven runtime version fields now use BACKEND_VERSION, including:
  * successful API response `version`
  * OpenAI error response `version`
  * persisted backend diagnostic `backend_version` for error/success.
- No market filters, valuation logic, frontend behavior, or credentials changed.

Why:
- The uploaded report can show v15.5.44 even while the file header says v15.5.45,
  because the runtime version was hard-coded separately. This candidate corrects
  that mismatch. A version string is useful evidence, but alone does not prove
  the deployment is from the intended commit; verify the Vercel Preview commit too.

Validation status:
- Pending local syntax checks after packaging.
- Not deployed by this assistant.
- No live API / eBay / OpenAI integration test run.
- Not approved for production.
- Keep Test 7 and production unchanged until Preview validation passes.

Next:
1. Upload/commit the updated files to the Testrunner branch only.
2. Confirm the Preview deployment commit matches the new commit.
3. Run one test and confirm the JSON `backend_version` is v15.5.45-test7.12-console-accessory-gate-candidate.
4. Then rerun the three market tests; inspect Fender zero-reference and Switch accessory leakage separately.
