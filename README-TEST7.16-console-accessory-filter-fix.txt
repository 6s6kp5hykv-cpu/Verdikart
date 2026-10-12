KISTEFUNN — TEST 7.16 CANDIDATE
Backend: v15.5.49-test7.16-console-accessory-filter-fix
Base: user-uploaded Verdikart-Testrunner(2).zip, backend v15.5.48-test7.15-guitar-variant-tolerant-filter.

Problem observed in Preview report and screenshots:
- A Nintendo Switch transport bag/case was included as an exact console reference.
- An OLED screen assembly with battery was included as a console reference.
- A replacement motherboard was included as a console reference.
- A micro-soldering service listing was also visible in the same reference list.

Changes:
- Expanded console-only accessory rejection patterns to cover German/Norwegian bag/case terms, OLED screen assemblies/modules, motherboards/logic boards, and soldering/repair service listings.
- Kept the changes scoped to the console category.
- Added local regression checks for four observed accessory/service title patterns and two complete-console titles.
- Updated backend version marker to v15.5.49-test7.16-console-accessory-filter-fix.

Validation:
- Source ZIP integrity: PASS.
- Local checks PASS: `node --check api/analyze.js`; Test 7.13, 7.14, 7.15 regression scripts; Test 7.16 regression script; `manifest.webmanifest` JSON validation.
- This candidate has NOT been deployed to Vercel Preview and has NOT been live-tested against eBay.
- No production/Main changes were made.

Next Preview tests:
1. Nintendo Switch OLED complete console: bags, screen assemblies, motherboards and service listings must not enter valuation references; complete consoles/bundles remain eligible.
2. Nintendo Switch OLED transport case/accessory target: identify the accessory, not the complete console.
3. Squier Classic Vibe '50s Stratocaster regression: confirm guitar behavior from v15.5.48 remains intact.

Safety: Keep the original Test 7 baseline and uploaded ZIP as rollback. Upload only to Testrunner. Do not merge to main or deploy production without explicit approval.
