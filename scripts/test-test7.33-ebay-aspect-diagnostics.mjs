import assert from "node:assert/strict";
import { buildAnalysisDiagnosticReport, sanitizeDiagnosticMetadata } from "../api/_diagnostics.js";
import { buildNintendoPackageCandidateDiagnostics, classifyNintendoSwitchOledListing } from "../api/analyze.js";

const version = "v15.5.66-test7.35-negation-scope";
const candidates = buildNintendoPackageCandidateDiagnostics([
  { title: "Nintendo Switch OLED console", _ebay_aspects: { "Items Included": ["Dock included", "Joy-Con controllers included", "AC adapter included"] } },
  { title: "Nintendo Switch OLED console", _ebay_aspects: { "Items Included": ["Dock not included", "Joy-Con not included", "Charger not included"] } },
  { title: "Nintendo Switch OLED console", _ebay_aspects: {} },
  { title: "Nintendo Switch OLED console", _ebay_aspects: { Brand: "Nintendo", Model: "OLED" } },
  { title: "Nintendo Switch OLED console", _ebay_aspects: { "Items Included": ["Protective case", "Console"] } },
  { title: "Nintendo Switch OLED console" },
  { title: "Nintendo Switch OLED console", _ebay_aspects: { "Medfølger": ["Dock inkludert"] } }
]);

assert.equal(candidates[0].aspect_map_state, "recognized_fields");
assert.deepEqual(candidates[0].aspect_signals, { dock: true, joycon_or_controller: true, power_supply: true });
assert.deepEqual(candidates[0].aspect_evidence, { dock: "matched", joycon_or_controller: "matched", power_supply: "matched" });
assert.deepEqual(candidates[1].aspect_signals, { dock: false, joycon_or_controller: false, power_supply: false });
assert.deepEqual(candidates[1].aspect_evidence, { dock: "negative_match", joycon_or_controller: "negative_match", power_supply: "negative_match" });
assert.equal(candidates[2].aspect_map_state, "empty_map");
assert.equal(candidates[3].aspect_map_state, "unknown_fields_only");
assert.equal(candidates[3].unknown_aspect_field_count, 2);
assert.deepEqual(candidates[3].aspect_evidence, { dock: "no_recognized_field", joycon_or_controller: "no_recognized_field", power_supply: "no_recognized_field" });
assert.equal(candidates[4].aspect_map_state, "recognized_fields");
assert.deepEqual(candidates[4].aspect_evidence, { dock: "no_value_match", joycon_or_controller: "no_value_match", power_supply: "no_value_match" });
assert.equal(candidates[5].aspect_map_state, "missing_map");
assert.deepEqual(candidates[5].aspect_signals, { dock: null, joycon_or_controller: null, power_supply: null });
assert.equal(candidates[6].aspect_map_state, "recognized_fields", "accented Norwegian field names normalize consistently");
assert.equal(candidates[6].aspect_signals.dock, true);
assert.equal(classifyNintendoSwitchOledListing({ title: "Nintendo Switch OLED console", _ebay_aspects: candidates[0] }).eligible, false,
  "aspect diagnostics must not make incomplete title evidence eligible");

const hostile = buildAnalysisDiagnosticReport({
  backend_version: version,
  diagnostic_detail: { switch_package_gate: { enabled: true, before_count: 1, after_count: 0, excluded_count: 1, excluded_reasons: {}, candidate_diagnostics: [{
    candidate_number: 1,
    filter_reason: "package_contents_unconfirmed",
    title_signals: { console: true, dock: false, joycon_or_controller: false, power_supply: false, explicit_complete: false },
    detail_aspects_present: true,
    aspect_map_state: "recognized_fields",
    recognized_content_field_count: 1,
    unknown_aspect_field_count: 3,
    aspect_signals: { dock: null, joycon_or_controller: null, power_supply: null },
    aspect_evidence: { dock: "no_value_match", joycon_or_controller: "no_value_match", power_supply: "no_value_match" },
    raw_field_name: "EMAIL jan.person@example.test",
    raw_value: "SECRET_TOKEN plus seller phone +47 900 00 000",
    title: "PRIVATE_TITLE",
    url: "https://seller.example.test/item?token=SECRET_TOKEN",
    item_id: "PRIVATE_ITEM_ID",
    vendor_object: { authorization: "Bearer SECRET_TOKEN", email: "jan.person@example.test" }
  }] } }
});
const safe = sanitizeDiagnosticMetadata(hostile);
const serialized = JSON.stringify(safe);
assert.deepEqual(safe.diagnostic_detail.switch_package_gate.candidate_diagnostics[0].aspect_evidence,
  { dock: "no_value_match", joycon_or_controller: "no_value_match", power_supply: "no_value_match" });
assert.doesNotMatch(serialized, /EMAIL|jan\.person@example\.test|SECRET_TOKEN|\+47 900|PRIVATE_TITLE|seller\.example\.test|PRIVATE_ITEM_ID|authorization|vendor_object/i);
assert.equal(safe.diagnostic_detail.switch_package_gate.candidate_diagnostics[0].raw_field_name, undefined);
assert.equal(safe.diagnostic_detail.switch_package_gate.candidate_diagnostics[0].raw_value, undefined);

console.log("Test 7.33 eBay aspect diagnostics: PASS (aspect map states, positive/negative evidence, unchanged eligibility, strict sanitization)");
