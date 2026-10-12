import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
assert.match(source, /v15\.5\.51-test7\.18-valuation-listing-audit/);
assert.match(source, /valuation_listing_audit: exactPool\.slice\(0, 100\)\.map/);
assert.match(source, /valuation_used_listing_audit: finalPool\.slice\(0, 100\)\.map/);
assert.match(source, /used_for_valuation: used/);
assert.match(source, /filter_decision: used \? "used_in_final_valuation" : "excluded_after_exact_pool"/);
assert.match(source, /valuation_listing_audit: Array\.isArray\(ebay\?\.valuation_listing_audit\)/);
assert.match(source, /valuation_used_listing_audit: Array\.isArray\(ebay\?\.valuation_used_listing_audit\)/);
assert.match(source, /getExchangeRate\(item\.currency, "NOK"\)/);
console.log('PASS Test 7.18 static assertions: version, full bounded exact-listing audit, final valuation listing audit, filter decision, diagnostic response exposure, and existing FX path.');
console.log('LIMITATION: Static checks only; live eBay/Preview must confirm that every final listing has a title, URL, price and currency.');
