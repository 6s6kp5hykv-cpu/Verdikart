import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAnalysisDiagnosticReport, sanitizeDiagnosticMetadata } from "../api/_diagnostics.js";
import { buildNintendoPackageCandidateDiagnostics } from "../api/analyze.js";

const version = "v15.5.66-test7.35-negation-scope";
assert.ok((await readFile(new URL("../api/analyze.js", import.meta.url), "utf8")).includes(version), "backend version marker");
const diagnose = value => buildNintendoPackageCandidateDiagnostics([{
  title: "Nintendo Switch OLED console",
  _ebay_aspects: value === null ? undefined : { "Items Included": value }
}])[0];
const expectedBase = { dock: true, joycon_or_controller: false, power_supply: true };

const base = diagnose(["Dock included", "Joy-Con not included", "AC adapter included"]);
assert.deepEqual(base.aspect_signals, expectedBase);
assert.deepEqual(diagnose(["AC adapter included", "Joy-Con not included", "Dock included"]).aspect_signals, expectedBase,
  "independent aspect-value order must not affect the result");
assert.deepEqual(diagnose(["Dock included", "JOY-CON NOT INCLUDED", "AC ADAPTER INCLUDED"]).aspect_signals, expectedBase,
  "case changes must not affect the result");
assert.deepEqual(diagnose(["Dock included; Joy-Con not included; AC adapter included"]).aspect_signals, expectedBase,
  "punctuation-separated clauses retain per-type evidence");

const sharedNegation = diagnose(["Dock and Joy-Con not included"]);
assert.deepEqual(sharedNegation.aspect_signals, { dock: false, joycon_or_controller: false, power_supply: null });
assert.deepEqual(diagnose(["Dock und Joy-Con nicht enthalten"]).aspect_signals,
  { dock: false, joycon_or_controller: false, power_supply: null });

const contrast = diagnose(["Dock included but Joy-Con not included"]);
assert.deepEqual(contrast.aspect_signals, { dock: true, joycon_or_controller: false, power_supply: null });
assert.deepEqual(diagnose(["Dock inkludert, Joy-Con følger ikke med"]).aspect_signals,
  { dock: true, joycon_or_controller: false, power_supply: null });
assert.deepEqual(diagnose(["Dock inklusive, Joy-Con nicht dabei"]).aspect_signals,
  { dock: true, joycon_or_controller: false, power_supply: null });

const relational = diagnose(["Dock with Joy-Con not included"]);
assert.deepEqual(relational.aspect_signals, { dock: null, joycon_or_controller: false, power_supply: null });
assert.equal(relational.aspect_evidence.dock, "ambiguous_evidence");
assert.deepEqual(diagnose(["Dock med Joy-Con følger ikke med"]).aspect_signals,
  { dock: null, joycon_or_controller: false, power_supply: null });
assert.deepEqual(diagnose(["Dock mit Joy-Con nicht dabei"]).aspect_signals,
  { dock: null, joycon_or_controller: false, power_supply: null });

const conflict = diagnose(["Dock included", "Dock not included", "Joy-Con"]);
assert.equal(conflict.aspect_signals.dock, null);
assert.equal(conflict.aspect_evidence.dock, "conflicting_evidence");
assert.equal(conflict.aspect_signals.joycon_or_controller, null, "bare Joy-Con mention is insufficient and dock conflict cannot alter it");
assert.equal(conflict.aspect_signals.power_supply, null);

assert.equal(diagnose(["Dock not supplied"]).aspect_signals.dock, false);
assert.equal(diagnose(["Joy-Con"]).aspect_signals.joycon_or_controller, null);
assert.equal(diagnose(["Joy-Con"]).aspect_evidence.joycon_or_controller, "no_value_match");
assert.equal(diagnose(["Joy-Con included"]).aspect_signals.joycon_or_controller, true);
assert.equal(diagnose(["Joy-Con included"]).aspect_evidence.joycon_or_controller, "matched");
assert.deepEqual(diagnose(["Joy-Con not included"]).aspect_signals,
  { dock: null, joycon_or_controller: false, power_supply: null });
assert.equal(diagnose(["Dock compatible"]).aspect_signals.dock, null);
assert.equal(diagnose(["Dock compatible"]).aspect_evidence.dock, "ambiguous_evidence");
assert.equal(diagnose(["controller"]).aspect_signals.joycon_or_controller, null);
assert.equal(diagnose(["controller"]).aspect_evidence.joycon_or_controller, "ambiguous_evidence");
assert.equal(diagnose(["controller included"]).aspect_signals.joycon_or_controller, null);
assert.equal(diagnose(["controller included"]).aspect_evidence.joycon_or_controller, "ambiguous_evidence");
assert.equal(diagnose(["adapter"]).aspect_signals.power_supply, null);
assert.equal(diagnose(["adapter"]).aspect_evidence.power_supply, "ambiguous_evidence");
assert.equal(diagnose(["adapter included"]).aspect_signals.power_supply, null);
assert.equal(diagnose(["adapter included"]).aspect_evidence.power_supply, "ambiguous_evidence");
assert.equal(buildNintendoPackageCandidateDiagnostics([{ title: "Nintendo Switch OLED console", _ebay_aspects: {} }])[0].aspect_map_state, "empty_map");
assert.equal(diagnose(null).aspect_map_state, "missing_map");
const unknown = buildNintendoPackageCandidateDiagnostics([{ title: "Nintendo Switch OLED console", _ebay_aspects: { UnknownField: "Dock not included SECRET_VALUE" } }])[0];
assert.equal(unknown.aspect_map_state, "unknown_fields_only");
assert.deepEqual(unknown.aspect_signals, { dock: null, joycon_or_controller: null, power_supply: null });

const hostileReport = buildAnalysisDiagnosticReport({
  backend_version: version,
  diagnostic_detail: { switch_package_gate: { enabled: true, before_count: 1, after_count: 0, excluded_count: 1, excluded_reasons: {}, candidate_diagnostics: [{
    candidate_number: 1, filter_reason: "package_contents_unconfirmed",
    title_signals: { console: true, dock: false, joycon_or_controller: false, power_supply: false, explicit_complete: false },
    aspect_map_state: "recognized_fields", recognized_content_field_count: 1, unknown_aspect_field_count: 0,
    detail_aspects_present: true, aspect_signals: { dock: null, joycon_or_controller: false, power_supply: null },
    aspect_evidence: { dock: "ambiguous_evidence", joycon_or_controller: "negative_match", power_supply: "no_value_match" },
    raw_name: "SECRET_ASPECT_NAME", raw_value: "SECRET_ASPECT_VALUE jane@example.test", title: "PRIVATE_TITLE",
    item_id: "PRIVATE_ITEM_ID", url: "https://seller.example.test/?token=SECRET_TOKEN",
    vendor: { api_key: "SECRET_KEY", authorization: "Bearer SECRET_TOKEN" }
  }] } }
});
const safe = sanitizeDiagnosticMetadata(hostileReport);
assert.doesNotMatch(JSON.stringify(safe), /SECRET_ASPECT_NAME|SECRET_ASPECT_VALUE|jane@example\.test|PRIVATE_TITLE|PRIVATE_ITEM_ID|seller\.example\.test|SECRET_TOKEN|SECRET_KEY|authorization/i);
assert.equal(safe.diagnostic_detail.switch_package_gate.candidate_diagnostics[0].aspect_evidence.dock, "ambiguous_evidence");

console.log("Test 7.35 negation scope: PASS (English/Norwegian/German scope, order, ambiguity, conflict, conservative matching, privacy)");
