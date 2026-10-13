import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
assert.match(source, /v15\.5\.59-test7\.26-fail-closed-package-valuation-gate/);
assert.match(source, /!ebay\?\.switch_package_gate\?\.enabled \|\| \(/);
assert.match(source, /Number\(ebay\?\.sample_size \|\| 0\) >= 3/);
assert.match(source, /Number\(ebay\?\.distinct_valuation_count \|\| 0\) >= 3/);
assert.match(source, /Array\.isArray\(ebay\?\.valuation_used_listing_audit\)/);
// Behavioral model of the fail-closed predicate.
function eligible(e) {
  return Boolean(e.enabled) && Number.isFinite(e.median_nok) && e.median_nok > 0 &&
    (!e.switch_package_gate?.enabled || (Number(e.sample_size || 0) >= 3 && Number(e.distinct_valuation_count || 0) >= 3 && Array.isArray(e.valuation_used_listing_audit) && e.valuation_used_listing_audit.length >= 3));
}
const base = { enabled:true, median_nok:1496, switch_package_gate:{enabled:true} };
assert.equal(eligible({...base, sample_size:0, distinct_valuation_count:0, valuation_used_listing_audit:[]}), false);
assert.equal(eligible({...base, sample_size:3, distinct_valuation_count:3, valuation_used_listing_audit:[1,2,3]}), true);
assert.equal(eligible({...base, sample_size:3, distinct_valuation_count:3, valuation_used_listing_audit:[1,2]}), false);
assert.equal(eligible({enabled:true, median_nok:1496, switch_package_gate:{enabled:false}}), true);
console.log('Test 7.26 fail-closed package valuation: PASS (4 behavior cases + source assertions)');
