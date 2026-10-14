import assert from "node:assert/strict";
import { buildAnalysisDiagnosticReport, sanitizeDiagnosticMetadata } from "../api/_diagnostics.js";
import { buildNintendoPackageCandidateDiagnostics } from "../api/analyze.js";

const version = "v15.5.65-test7.34-isolated-aspect-signals";
const candidate = values => buildNintendoPackageCandidateDiagnostics([
  { title: "Nintendo Switch OLED console", _ebay_aspects: { "Items Included": values } }
])[0];
const expectedMixed = {
  signals: { dock: true, joycon_or_controller: false, power_supply: true },
  evidence: { dock: "matched", joycon_or_controller: "negative_match", power_supply: "matched" }
};

const orderA = candidate(["Dock included", "Joy-Con not included", "AC adapter included"]);
assert.deepEqual({ signals: orderA.aspect_signals, evidence: orderA.aspect_evidence }, expectedMixed);
const orderB = candidate(["AC adapter included", "Joy-Con not included", "Dock included"]);
assert.deepEqual({ signals: orderB.aspect_signals, evidence: orderB.aspect_evidence }, expectedMixed,
  "value order cannot let another equipment type's negative evidence bleed across");

const oneNegative = candidate(["Joy-Con not included"]);
assert.deepEqual(oneNegative.aspect_signals, { dock: null, joycon_or_controller: false, power_supply: null });
assert.deepEqual(oneNegative.aspect_evidence, {
  dock: "no_value_match", joycon_or_controller: "negative_match", power_supply: "no_value_match"
});

const oneValueSeveralTypes = candidate(["Dock included, Joy-Con not included, AC adapter included"]);
assert.deepEqual(oneValueSeveralTypes.aspect_signals, { dock: true, joycon_or_controller: false, power_supply: true });
const oneValueConjunctions = candidate(["Dock included but Joy-Con not included and AC adapter included"]);
assert.deepEqual(oneValueConjunctions.aspect_signals, { dock: true, joycon_or_controller: false, power_supply: true });

const conflict = candidate(["Dock included", "Dock not included"]);
assert.equal(conflict.aspect_signals.dock, null, "conflicting explicit evidence stays unknown");
assert.equal(conflict.aspect_evidence.dock, "conflicting_evidence");
assert.equal(conflict.aspect_signals.joycon_or_controller, null);
assert.equal(conflict.aspect_signals.power_supply, null);

assert.equal(buildNintendoPackageCandidateDiagnostics([{ title: "Nintendo Switch OLED console", _ebay_aspects: {} }])[0].aspect_map_state, "empty_map");
assert.equal(buildNintendoPackageCandidateDiagnostics([{ title: "Nintendo Switch OLED console" }])[0].aspect_map_state, "missing_map");
const unknown = buildNintendoPackageCandidateDiagnostics([{ title: "Nintendo Switch OLED console", _ebay_aspects: { SecretField: "SECRET_RAW_VALUE" } }])[0];
assert.equal(unknown.aspect_map_state, "unknown_fields_only");
assert.equal(unknown.aspect_signals.dock, null);

const hostile = buildAnalysisDiagnosticReport({
  backend_version: version,
  diagnostic_detail: { switch_package_gate: { enabled: true, before_count: 1, after_count: 0, excluded_count: 1, excluded_reasons: {}, candidate_diagnostics: [{
    candidate_number: 1, filter_reason: "package_contents_unconfirmed",
    title_signals: { console: true, dock: false, joycon_or_controller: false, power_supply: false, explicit_complete: false },
    detail_aspects_present: true, aspect_map_state: "recognized_fields", recognized_content_field_count: 1, unknown_aspect_field_count: 1,
    aspect_signals: { dock: null, joycon_or_controller: false, power_supply: null },
    aspect_evidence: { dock: "no_value_match", joycon_or_controller: "negative_match", power_supply: "no_value_match" },
    raw_aspect_name: "EMAIL jane@example.test", raw_aspect_value: "SECRET_TOKEN +47 900 00 000",
    title: "PRIVATE_TITLE", item_id: "PRIVATE_ITEM_ID", url: "https://seller.example.test/?token=SECRET_TOKEN",
    vendor_field: { authorization: "Bearer SECRET_TOKEN", email: "jane@example.test" }
  }] } }
});
const safe = sanitizeDiagnosticMetadata(hostile);
const serialized = JSON.stringify(safe);
assert.doesNotMatch(serialized, /jane@example\.test|SECRET_TOKEN|\+47 900|PRIVATE_TITLE|PRIVATE_ITEM_ID|seller\.example\.test|authorization|vendor_field|PRIVATE_RAW/i);
assert.equal(safe.diagnostic_detail.switch_package_gate.candidate_diagnostics[0].aspect_evidence.joycon_or_controller, "negative_match");

console.log("Test 7.34 isolated aspect signals: PASS (value isolation, order invariance, conflicts, unknowns, privacy)");
