import assert from "node:assert/strict";
import fs from "node:fs";
import {
  countMarketReferences,
  hasApprovedEbayValuationReferences,
  isMarketCandidateEligible
} from "../api/analyze.js";

const backend = fs.readFileSync(new URL("../api/analyze.js", import.meta.url), "utf8");
const frontend = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(backend, /v15\.5\.61-test7\.28-market-reference-count-fix/);
assert.match(backend, /market_reference_count:\s*countMarketReferences\(marketCandidates\)/);
assert.match(backend, /sample_size:\s*finalPool\.length/);
assert.match(backend, /exact_match_count:\s*exactPool\.length/);
assert.match(backend, /valuation_reference_count:\s*Number\(ebay\?\.sample_size\s*\|\|\s*0\)/);
assert.match(backend, /if\s*\(!hasApprovedEbayValuationReferences\(source\)\)\s*return\s*0/);
assert.match(backend, /isMarketCandidateEligible\(sources\.ebay,\s*ebayQuality\)/);
assert.match(backend, /isMarketCandidateEligible\(sources\.web_reference,\s*webReferenceQuality\)/);
assert.match(backend, /isMarketCandidateEligible\(sources\.finn,\s*finnQuality\)/);
assert.match(backend, /reference_count:\s*sources\.web_reference\.valuation_reference_count/);
assert.match(backend, /reference_count:\s*sources\.finn\.exact_match_count/);
assert.match(backend, /market_data_status:\s*Number\(market\?\.market_reference_count\s*\|\|\s*0\)\s*>\s*0/);

// (a) No approved market candidates: AI-only results report zero references.
assert.equal(countMarketReferences([]), 0);
assert.equal(isMarketCandidateEligible({ enabled: true, value_nok: 100 }, 0), false);

// (b) eBay reports finalPool size; that is the approved pool used in valuation.
const ebaySource = {
  exact_match_count: 5,
  sample_size: 3,
  valuation_reference_count: 3,
  enabled: true,
  value_nok: 1200
};
assert.equal(hasApprovedEbayValuationReferences(ebaySource), true);
assert.equal(isMarketCandidateEligible(ebaySource, 0.70), true);
const ebayCandidates = isMarketCandidateEligible(ebaySource, 0.70)
  ? [{ source: "ebay", reference_count: ebaySource.valuation_reference_count }]
  : [];
assert.equal(countMarketReferences(ebayCandidates), 3);

// (c) Other active market sources retain their own count of references used.
const webSource = { enabled: true, value_nok: 1500, valuation_reference_count: 3 };
const finnSource = { enabled: true, value_nok: 1400, exact_match_count: 2 };
const otherMarketCandidates = [
  ...(isMarketCandidateEligible(webSource, 0.60)
    ? [{ source: "web_reference", reference_count: webSource.valuation_reference_count }]
    : []),
  ...(isMarketCandidateEligible(finnSource, 0.80) && finnSource.exact_match_count > 0
    ? [{ source: "finn", reference_count: finnSource.exact_match_count }]
    : [])
];
assert.equal(countMarketReferences(otherMarketCandidates), 5);

// FINN must not count unless the actual source candidate gate admits it.
const disabledFinnSource = { enabled: false, value_nok: 1400, exact_match_count: 4 };
assert.equal(isMarketCandidateEligible(disabledFinnSource, 0.80), false);
const disabledFinnCandidate = isMarketCandidateEligible(disabledFinnSource, 0.80) &&
  Number(disabledFinnSource.exact_match_count || 0) > 0
  ? [{ source: "finn", reference_count: disabledFinnSource.exact_match_count }]
  : [];
assert.equal(countMarketReferences(disabledFinnCandidate), 0);

// (d) Four exactPool matches with an empty finalPool cannot qualify eBay or count.
const noFinalPool = { ...ebaySource, sample_size: 0, valuation_reference_count: 0 };
assert.equal(hasApprovedEbayValuationReferences(noFinalPool), false);
const invalidPoolCandidate = hasApprovedEbayValuationReferences(noFinalPool) &&
  isMarketCandidateEligible(noFinalPool, 0.70)
  ? [{ source: "ebay", reference_count: noFinalPool.valuation_reference_count }]
  : [];
assert.equal(countMarketReferences(invalidPoolCandidate), 0);

// Execute the actual pure frontend label helper from index.html.
const labelStart = frontend.indexOf("function getPriceRangeLabels(");
const labelEnd = frontend.indexOf("async function loadAdminDiagnostics()", labelStart);
assert.notEqual(labelStart, -1, "price range label helper exists");
assert.notEqual(labelEnd, -1, "price range label helper has a clear end");
const labelFunctionSource = frontend.slice(labelStart, labelEnd);
const getPriceRangeLabels = new Function(`${labelFunctionSource}; return getPriceRangeLabels;`)();
assert.deepEqual(getPriceRangeLabels("ai_estimate_only"), [
  "Nedre estimat · AI-estimat",
  "Øvre estimat · AI-estimat"
]);
assert.deepEqual(getPriceRangeLabels("market_supported"), [
  "Nedre estimat",
  "Øvre estimat"
]);
assert.match(frontend, /getPriceRangeLabels\(data\.market_data_status\)/);

console.log("Test 7.28 market reference count: PASS (backend logic, source wiring, and frontend labels)");
