#!/usr/bin/env node
// Kistefunn Test 7.20 — source-level checks only; does not call Preview APIs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const p = new URL('../api/analyze.js', import.meta.url);
const source = fs.readFileSync(p, 'utf8');
assert.match(source, /v15\.5\.53-test7\.20-norway-market-audit/, 'backend version header');
assert.match(source, /market_source_priority_audit/, 'market source audit identifier');
console.log('PASS: Test 7.20 backend version header found');
console.log('PASS: market_source_priority_audit identifier found');
console.log('NOTE: source-level only; live Preview fields and valuation behavior are not verified');
