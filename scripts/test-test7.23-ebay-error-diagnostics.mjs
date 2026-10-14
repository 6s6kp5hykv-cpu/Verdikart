import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../api/', import.meta.url);
const src = fs.readFileSync(new URL('analyze.js', root), 'utf8');
// Keep the historical error-diagnostics invariants active against the current backend.
assert.match(src, /v15\.5\.66-test7\.35-negation-scope/);
assert.match(src, /const EBAY_SEARCH_MAX_CONCURRENCY = 2/);
assert.match(src, /const EBAY_DETAIL_MAX_CONCURRENCY = 3/);
assert.match(src, /const EBAY_SEARCH_MAX_429_RETRIES = 1/);
assert.match(src, /retry-after/);
assert.match(src, /response_headers: ebayDiagnosticError\.response_headers/);
assert.match(src, /api_errors: ebayDiagnosticError\.api_errors/);
assert.match(src, /x-ebay-c-request-id/);
assert.match(src, /x-ratelimit-remaining/);
assert.match(src, /longMessage:/);
assert.doesNotMatch(src, /console\.log\([^)]*token/i);
console.log('Test 7.23 eBay error-diagnostics static checks passed');
