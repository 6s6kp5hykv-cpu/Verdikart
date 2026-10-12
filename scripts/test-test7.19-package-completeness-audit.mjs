import fs from 'node:fs';
import assert from 'node:assert/strict';
const s = fs.readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
assert.match(s, /v15\.5\.52-test7\.19-package-completeness-audit/);
assert.match(s, /console_only_explicit/);
assert.match(s, /contents_unconfirmed/);
assert.match(s, /complete_contents_signaled/);
assert.match(s, /valuation_listing_audit/);
assert.match(s, /valuation_used_listing_audit/);
// Test 7.19 must remain diagnostic-only; verify no package-status-based reject was added.
assert.doesNotMatch(s, /package_status.{0,120}(?:accepted:\s*false|score:\s*-100)/s);
console.log('PASS: Test 7.19 package-completeness diagnostics present; no package-status rejection rule found.');
