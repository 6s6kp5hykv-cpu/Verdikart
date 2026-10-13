# Kistefunn Test 7.29 — Nintendo Switch OLED search and valuation

Backend version: `v15.5.62-test7.29-nintendo-search-fix`

## Root cause found

- The Switch OLED package gate was enabled from `builtQueryText` and explicitly disabled when the generated search string mentioned `dock`, `Joy-Con`, `charger`, `controller`, and other accessories. Search wording describes queries and included components; it is not the identity of the item being valued.
- The package filter ran on `valuationPool`, but eBay's `median_nok`, exact median and some exact-price diagnostics were still derived from the earlier `exactPool`. The interval came from `finalPool`, so the displayed market value and interval could be based on different sets. `exactPool` also retained console-only, defective and incomplete listings for display/audit.
- Search fallback variants all feed the same candidate pipeline. The package filter is now applied after exact/same-model pool construction and before outlier filtering and `finalPool`; no search fallback has a separate valuation route.

## Changes

- `api/analyze.js`
  - Bumped backend version to `v15.5.62-test7.29-nintendo-search-fix`.
  - Added exported production helpers for structured Nintendo Switch OLED target detection, conservative listing classification, package filtering and the minimum market-pool check.
  - Target detection uses structured brand/model/type/manufacturer fields, so accessory words in search queries no longer disable the package gate. Explicit accessory targets do not activate the console gate.
  - Classification rejects console-only/tablet-only, accessory-only, defective/parts, other Switch variants and uncertain equipment. It recognizes Norwegian, English and German terms. Dock, Joy-Con and charger mentions by themselves do not prove a complete set; explicit completeness plus those components is required.
  - The audit uses the same classifier as the production valuation gate.
  - For Switch OLED, market median, low/high, exact valuation counts/prices and bargain references now use the filtered final valuation pool. `market_reference_count` continues to count only an enabled source; eBay requires at least three final, distinct, audited references. With fewer, eBay has no market weight and status falls back to AI-only.
- `scripts/test-test7.29-nintendo-search-fix.mjs`
  - Exercises the exported production classifier, target detector, filter and minimum-pool helper. It covers full bundles, unconfirmed packages, console/tablet-only, accessories, defects/parts, irrelevant products, language variants, query accessory mentions and alternative console variants. Source wiring assertions check that filtering precedes `finalPool` and that value/range/audit use it.
- `README-TEST7.29.txt` (this file)

## Local checks run

| Command | Result |
|---|---|
| `node --check api/analyze.js` | PASS |
| `node --check scripts/test-test7.29-nintendo-search-fix.mjs` | PASS |
| `node scripts/test-test7.29-nintendo-search-fix.mjs` | PASS — 21 classifier cases plus target, filter, minimum-pool and valuation-wiring checks |
| `node scripts/test-test7.28-market-reference-count.mjs` | FAIL — historical version assertion expects Test 7.28; file unchanged |
| `node scripts/test-test7.27-valuation-consistency.mjs` | FAIL — historical version assertion expects Test 7.27; file unchanged |
| `node scripts/test-test7.26-fail-closed-package-valuation.mjs` | FAIL — historical version assertion expects Test 7.26; file unchanged |
| `node scripts/test-test7.25-package-gate.mjs` | FAIL — historical version assertion expects Test 7.25; file unchanged |

The legacy scripts stop at their version assertions, so their later assertions were not run against Test 7.29. No historical test file was edited. No package was installed and no external API/Preview request was made.

## Known limitations

- Completeness is inferred conservatively from listing text, not verified from seller photos or the full listing description. Valid bundles whose titles omit an explicit completeness signal may be excluded, resulting in AI-only valuation.
- Local regression tests exercise the exact production classification/filter helpers and check how the request handler wires their result into market valuation. The complete request handler and source combiner remain request-scoped and were not invoked end-to-end in a local test.
- No claim is made that live eBay search or Preview behavior has been verified.

## Next Preview verification

After a Preview deployment is separately authorized, submit a Nintendo Switch OLED valuation where generated search queries mention dock/Joy-Con/charger. Inspect the response's `backend_release_version`, `ebay.switch_package_gate`, `ebay.valuation_listing_audit`, `ebay.valuation_used_listing_audit`, `ebay.sample_size`, `ebay.median_nok`, `ebay.low_nok`, `ebay.high_nok`, `market_reference_count`, and `market_data_status`. Confirm that only explicitly complete bundles appear in the used audit; when fewer than three distinct complete listings survive, confirm zero eBay market references and `ai_estimate_only`. Repeat with a clear complete set in Norwegian, English or German, and manually inspect each used listing's title/details before treating the market result as validated.

No commit, push, branch change or deployment was performed.
