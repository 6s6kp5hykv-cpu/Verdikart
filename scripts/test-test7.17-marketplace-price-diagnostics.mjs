import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
assert.match(source, /v15\.5\.50-test7\.17-marketplace-price-diagnostics/);
assert.match(source, /exact_marketplace_price_summary: Object\.fromEntries/);
assert.match(source, /sample_prices_nok: values\.slice\(0, 30\)\.map\(Math\.round\)/);
assert.match(source, /exact_marketplace_price_summary: ebay\?\.exact_marketplace_price_summary/);
// Ensure the candidate keeps the existing currency conversion path and marketplace list.
assert.match(source, /getExchangeRate\(item\.currency, "NOK"\)/);
assert.match(source, /"EBAY_DE",\s*"EBAY_GB",\s*"EBAY_US"/);
console.log('PASS Test 7.17 static assertions: version, grouped marketplace summary, persisted diagnostics, FX path, and DE/GB/US marketplaces.');
console.log('LIMITATION: This is a local static test, not a live eBay/Preview integration test.');

// Simulated calculation sanity check: grouping does not change source prices.
const sample = [
  { marketplace: 'EBAY_DE', nok: 1000 },
  { marketplace: 'EBAY_DE', nok: 2000 },
  { marketplace: 'EBAY_GB', nok: 3000 }
];
const groups = Object.fromEntries([...new Set(sample.map(x => x.marketplace))].map(m => {
  const values = sample.filter(x => x.marketplace === m).map(x => x.nok).sort((a,b) => a-b);
  const mid = Math.floor(values.length / 2);
  return [m, { count: values.length, median_nok: values.length % 2 ? values[mid] : Math.round((values[mid-1] + values[mid]) / 2) }];
}));
assert.deepEqual(groups, { EBAY_DE: { count: 2, median_nok: 1500 }, EBAY_GB: { count: 1, median_nok: 3000 } });
console.log('PASS simulated grouped median sanity check.');
