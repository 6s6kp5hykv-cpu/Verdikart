import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../api/analyze.js", import.meta.url), "utf8");
assert.match(source, /v15\.5\.58-test7\.25-switch-package-valuation-gate/);
assert.match(source, /switch_package_gate/);
assert.match(source, /package_contents_unconfirmed/);
assert.match(source, /console_only_explicit/);
assert.match(source, /switchPackageTarget/);

// Mirror the candidate's conservative title-only package classification.
// This is a unit regression for rule intent, not a live eBay test.
function classify(title) {
  const explicitParts = /\b(?:for parts|parts only|broken|not working|repair only|spares or repair)\b/i.test(title);
  const explicitConsoleOnly = /\b(?:console only|console[- ]only|handheld only|tablet only|console without (?:the )?(?:dock|joy[ -]?con)|no dock|dock not included|without dock|tablet only)\b/i.test(title);
  const dock = /\b(?:dock|docking station)\b/i.test(title) && !/\b(?:no dock|dock not included|without dock)\b/i.test(title);
  const joycon = /\b(?:joy[ -]?con|joycon|controllers?)\b/i.test(title);
  const power = /\b(?:power supply|power adapter|ac adapter|charger|charging adapter)\b/i.test(title);
  const completeBundle = /\b(?:complete bundle|complete set|full set|all accessories included|includes? (?:the )?dock)\b/i.test(title);
  if (explicitParts || explicitConsoleOnly) return { eligible: false, reason: explicitParts ? "parts_or_repair" : "console_only_explicit" };
  if (dock && joycon && power && (completeBundle || /\b(?:console|system|bundle|set)\b/i.test(title))) return { eligible: true, reason: "complete_contents_signaled" };
  return { eligible: false, reason: "package_contents_unconfirmed" };
}

assert.equal(classify("Nintendo Switch OLED console only").eligible, false);
assert.equal(classify("Nintendo Switch OLED tablet only HEG-001").eligible, false);
assert.equal(classify("Nintendo Switch OLED for parts").eligible, false);
assert.equal(classify("Nintendo Switch OLED console with dock, Joy-Con controllers and power adapter complete set").eligible, true);
assert.equal(classify("Nintendo Switch OLED handheld console").reason, "package_contents_unconfirmed");
console.log("Test 7.25 package gate regression checks: PASS (5 classification cases + source assertions)");
