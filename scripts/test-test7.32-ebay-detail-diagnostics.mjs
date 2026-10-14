import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAnalysisDiagnosticReport, sanitizeDiagnosticMetadata } from "../api/_diagnostics.js";
import {
  buildNintendoPackageCandidateDiagnostics,
  createEbayDetailDiagnostics,
  createEbayItemDetailEnricher,
  preserveEbayDetailData,
  selectEbayDetailIds
} from "../api/analyze.js";

const backend = await readFile(new URL("../api/analyze.js", import.meta.url), "utf8");
assert.match(backend, /v15\.5\.66-test7\.35-negation-scope/);
assert.match(backend, /return preserveEbayDetailData\(item,\s*\{/,
  "prepareListing must preserve the private, internal detail fields on its returned candidate");
assert.match(backend, /selectEbayDetailIds\(\s*ranked,\s*15,\s*ebayDetailDiagnostics/,
  "production must use the tested candidate selection and counters helper");
assert.match(backend, /diagnostic_detail:\s*\{[\s\S]*?ebay_item_details:\s*diagnosticDetail\.ebay_item_details\.outcome_counts/,
  "persisted report must include only the aggregate detail outcome projection");

const detailSource = {
  _ebay_detail_loaded: true,
  _ebay_aspects: { "items included": ["Dock included", "Joy-Con included", "AC adapter included"] },
  _ebay_aspect_text: "Items Included: Dock included, Joy-Con included, AC adapter included",
  _ebay_description: "private description"
};
const prepared = preserveEbayDetailData(detailSource, { title: "Synthetic title", price: { value: 1, currency: "NOK" } });
assert.equal(prepared._ebay_detail_loaded, true);
assert.deepEqual(prepared._ebay_aspects, detailSource._ebay_aspects);
assert.deepEqual(prepared._ebay_aspects, { "items included": ["Dock included", "Joy-Con included", "AC adapter included"] });

const candidate = buildNintendoPackageCandidateDiagnostics([prepared])[0];
assert.equal(candidate.detail_aspects_present, true, "diagnostic reads aspects from the prepared candidate object");
assert.deepEqual(candidate.aspect_signals, { dock: true, joycon_or_controller: true, power_supply: true });

const stats = createEbayDetailDiagnostics();
const ranked = [
  { score: 80, item: { itemId: "id-with-aspects" } },
  { score: 75, item: { itemId: "id-with-aspects" } }, // duplicate observation is served from cache
  { score: 70, item: { itemId: "id-empty" } },
  { score: 65, item: { itemId: "id-no-token" } },
  { score: 60, item: { itemId: "id-failed" } },
  { score: 55, item: { itemId: "id-not-selected" } },
  { score: 50, item: {} }
];
const selectedIds = selectEbayDetailIds(ranked, 5, stats);
assert.deepEqual([...selectedIds].sort(), ["id-empty", "id-failed", "id-no-token", "id-with-aspects"].sort());

const detailResponses = new Map([
  ["id-with-aspects", { ok: true, json: async () => ({ localizedAspects: [{ name: "Items Included", value: ["Dock", "Joy-Con", "AC adapter"] }] }) }],
  ["id-empty", { ok: true, json: async () => ({ localizedAspects: [], inferredLocalizedAspects: [] }) }],
  ["id-failed", { ok: false, status: 503 }]
]);
let externalDetailCalls = 0;
const enricher = createEbayItemDetailEnricher({
  diagnostics: stats,
  getToken: async () => "synthetic-token",
  fetchDetails: async itemId => { externalDetailCalls += 1; return detailResponses.get(itemId); }
});
const withAspects = await enricher(ranked[0].item, "EBAY_DE");
const reused = await enricher(ranked[1].item, "EBAY_DE");
const withoutAspects = await enricher(ranked[2].item, "EBAY_DE");
const noToken = await createEbayItemDetailEnricher({
  diagnostics: stats, getToken: async () => null,
  fetchDetails: async () => { throw new Error("must not fetch without token"); }
})(ranked[3].item, "EBAY_DE");
const failed = await enricher(ranked[4].item, "EBAY_DE");
assert.equal(withAspects._ebay_detail_loaded, true);
assert.equal(Object.keys(withAspects._ebay_aspects).length, 1);
assert.equal(reused._ebay_detail_loaded, true);
assert.equal(withoutAspects._ebay_detail_loaded, true, "HTTP success with no aspects is distinct from fetch failure");
assert.deepEqual(withoutAspects._ebay_aspects, {});
assert.equal(noToken._ebay_detail_loaded, false);
assert.equal(failed._ebay_detail_loaded, false);
assert.equal(externalDetailCalls, 3, "cache reuse and missing token do not make extra HTTP calls");

const defensiveStats = createEbayDetailDiagnostics();
let missingIdFetches = 0;
await createEbayItemDetailEnricher({
  diagnostics: defensiveStats,
  getToken: async () => "synthetic-token",
  fetchDetails: async () => { missingIdFetches += 1; return { ok: true, json: async () => ({}) }; }
})({ title: "missing ID" }, "EBAY_DE");
assert.equal(missingIdFetches, 0);
assert.equal(defensiveStats.snapshot().skipped_reasons.missing_item_id, 1);

const counts = stats.snapshot();
assert.deepEqual(counts, {
  eligible: 7,
  attempted: 3,
  succeeded: 2,
  failed: 1,
  skipped: 3,
  aspects_returned: 1,
  aspects_empty: 1,
  cache_reused: 1,
  skipped_reasons: { missing_item_id: 1, missing_token: 1, not_selected: 1 },
  failure_reasons: { http_error: 1, request_exception: 0, invalid_json: 0 }
});
assert.equal(counts.succeeded + counts.failed, counts.attempted);
assert.equal(counts.aspects_returned + counts.aspects_empty, counts.succeeded);
assert.equal(counts.attempted + counts.skipped + counts.cache_reused, counts.eligible);

const invalidJsonStats = createEbayDetailDiagnostics();
const invalidJsonResult = await createEbayItemDetailEnricher({
  diagnostics: invalidJsonStats,
  getToken: async () => "synthetic-token",
  fetchDetails: async () => ({ ok: true, status: 200, json: async () => { throw new Error("private provider detail"); } })
})({ itemId: "id-invalid-json" }, "EBAY_DE");
assert.equal(invalidJsonResult._ebay_detail_loaded, false);
assert.equal(invalidJsonStats.snapshot().failure_reasons.invalid_json, 1);

const exceptionStats = createEbayDetailDiagnostics();
const exceptionResult = await createEbayItemDetailEnricher({
  diagnostics: exceptionStats,
  getToken: async () => "synthetic-token",
  fetchDetails: async () => { throw new Error("private network response with SECRET_TOKEN and user@example.test"); }
})({ itemId: "id-request-exception" }, "EBAY_DE");
assert.equal(exceptionResult._ebay_detail_loaded, false);
assert.equal(exceptionStats.snapshot().failure_reasons.request_exception, 1);
assert.equal(exceptionStats.snapshot().attempted, 1);
assert.equal(exceptionStats.snapshot().failed, 1);

const hostileReport = buildAnalysisDiagnosticReport({
  analysis_request_id: "7f0b4c8a-6df1-4c7b-9a51-f9df7ce12a10",
  diagnostic_detail: {
    _ebay_detail_loaded: true,
    _ebay_aspects: { "items included": ["SECRET_ASPECT_VALUE"] },
    ebay_item_details: {
      ...counts,
      raw_aspect: "SECRET_ASPECT_VALUE", title: "PERSON_TITLE", url: "https://seller.example.test/private",
      seller: "seller@example.test", item_id: "private-item-id", error: "SECRET_ERROR", token: "SECRET_TOKEN",
      skipped_reasons: { ...counts.skipped_reasons, arbitrary_vendor_field: "PRIVATE_VALUE" }
    }
  }
});
const safe = sanitizeDiagnosticMetadata(hostileReport);
assert.deepEqual(safe.diagnostic_detail.ebay_item_details, counts, "only fixed aggregate fields and reason categories survive sanitizer");
assert.doesNotMatch(JSON.stringify(safe), /SECRET_ASPECT_VALUE|PERSON_TITLE|seller\.example\.test|seller@example\.test|private-item-id|SECRET_ERROR|SECRET_TOKEN|PRIVATE_VALUE|arbitrary_vendor_field/);
assert.equal(safe.diagnostic_detail._ebay_aspects, undefined);
assert.equal(safe.diagnostic_detail._ebay_detail_loaded, undefined);

console.log("Test 7.32 eBay detail diagnostics: PASS (selection, ID/token skips, HTTP success/failure, cache reuse, aspect retention, aggregate privacy)");
