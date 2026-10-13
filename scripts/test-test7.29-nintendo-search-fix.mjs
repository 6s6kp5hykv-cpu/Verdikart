import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyNintendoSwitchOledListing,
  filterNintendoSwitchOledListings,
  hasSufficientNintendoMarketPool,
  isNintendoSwitchOledTarget
} from "../api/analyze.js";

const backend = fs.readFileSync(new URL("../api/analyze.js", import.meta.url), "utf8");
assert.match(backend, /v15\.5\.63-test7\.32-ebay-detail-diagnostics/);

const switchTarget = { brand: "Nintendo", model: "Switch OLED", type: "game console" };
assert.equal(isNintendoSwitchOledTarget(switchTarget), true);
assert.equal(isNintendoSwitchOledTarget({ brand: "Nintendo", model: "Switch OLED Joy-Con controller", type: "accessory" }), false);
// Discovery query text is not accepted as target input; accessory words in a fallback query cannot disable this gate.
const accessoryMentioningQueries = ["Nintendo Switch OLED with dock, Joy-Con, charger and controller"];
assert.equal(isNintendoSwitchOledTarget(switchTarget), true);
assert.match(backend, /isNintendoSwitchOledTarget\(\{[\s\S]{0,180}?brand: built\.brand,[\s\S]{0,120}?model: built\.model/);
assert.doesNotMatch(backend.slice(backend.indexOf("const switchPackageTarget"), backend.indexOf("const finalExactPool")), /builtQueryText/);

const titles = [
  ["Complete Nintendo Switch OLED console bundle with dock, Joy-Con controllers and AC adapter — complete set", true],
  ["Nintendo Switch OLED console only", false],
  ["Nintendo Switch OLED tablet only HEG-001", false],
  ["Nintendo Switch OLED console with dock, Joy-Con and charger", false],
  ["Nintendo Switch OLED Konsole komplett mit Dock, Joy-Cons und Netzteil", true],
  ["Nintendo Switch OLED Komplettpaket mit Dock, Joy-Con-Controllern und Netzteil", true],
  ["Nintendo Switch OLED Konsole mit Dock, Joy-Con und Netzteil, komplettes Set", true],
  ["Nintendo Switch OLED complete package including docking station, controllers and power supply", true],
  ["Nintendo Switch OLED tablet without dock and charger", false],
  ["Docking station for Nintendo Switch OLED", false],
  ["Nintendo Switch OLED Joy-Con controller pair only", false],
  ["Nintendo Switch OLED AC adapter / charger only", false],
  ["Nintendo Switch OLED screen protector and carrying case", false],
  ["Nintendo Switch OLED broken, for parts, not working", false],
  ["Nintendo Switch OLED Ersatzteilspender, defekt", false],
  ["Nintendo Switch Lite OLED complete set with dock, Joy-Con and charger", false],
  ["Samsung Galaxy tablet, complete with charger", false],
  // Naming the components alone is deliberately insufficient evidence of completeness.
  ["Nintendo Switch OLED console, dock, Joy-Con controllers and charger", false],
  ["Nintendo Switch OLED Komplettset mit Dock, Joy-Con und Netzteil, Dock nicht enthalten", false],
  ["Nintendo Switch OLED complete set with dock, Joy-Con and charger, Joy-Con not included", false],
  ["Nintendo Switch OLED komplett sett med dokkingstasjon, kontroller og lader, lader følger ikke med", false]
];
for (const [title, expected] of titles) {
  assert.equal(classifyNintendoSwitchOledListing({ title }).eligible, expected, title);
}

const mixedListings = titles.map(([title], i) => ({ title, nok: 1000 + i }));
const filtered = filterNintendoSwitchOledListings(mixedListings);
assert.equal(filtered.included.length, titles.filter(([, eligible]) => eligible).length);
assert.equal(filtered.excluded.length, mixedListings.length - filtered.included.length);
assert.ok(filtered.excluded.some(row => row.reason === "parts_or_repair"));
assert.ok(filtered.excluded.some(row => row.reason === "console_only_explicit"));
assert.ok(filtered.excluded.some(row => row.reason === "accessory_or_non_console"));
assert.ok(filtered.excluded.some(row => row.reason === "package_contents_unconfirmed"));

assert.equal(hasSufficientNintendoMarketPool({ sample_size: 0, distinct_valuation_count: 0, valuation_used_listing_audit: [] }), false);
assert.equal(hasSufficientNintendoMarketPool({ sample_size: 2, distinct_valuation_count: 2, valuation_used_listing_audit: [{}, {}] }), false);
assert.equal(hasSufficientNintendoMarketPool({ sample_size: 3, distinct_valuation_count: 3, valuation_used_listing_audit: [{}, {}, {}] }), true);

// Confirm production computes each value-bearing aggregate/audit from finalPool,
// after the actual exported package filter has populated valuationPool.
assert.match(backend, /const packageResult = filterNintendoSwitchOledListings\(valuationPool\);[\s\S]*?valuationPool = packageResult\.included;/);
assert.match(backend, /const finalPool =\s*valuationFilterApplied\s*\?\s*filteredPool\s*:\s*valuationPool/);
assert.match(backend, /const prices =\s*finalPool[\s\S]*?const medianNok =\s*median\(prices\)/);
assert.match(backend, /const valuationExactPool = switchPackageTarget\s*\?\s*finalPool\.filter\(item => item\.match_tier === "exact"\)/);
assert.match(backend, /sample_size:\s*finalPool\.length/);
assert.match(backend, /valuation_used_listing_audit:\s*finalPool\.slice/);
assert.match(backend, /hasSufficientNintendoMarketPool\(ebay\)/);
assert.match(backend, /valuation_reference_count:\s*Number\(ebay\?\.sample_size\s*\|\|\s*0\)/);
assert.match(backend, /market_reference_count:\s*countMarketReferences\(marketCandidates\)/);

// A set with valid bundles only keeps its median/count aligned with the approved set.
const validBundles = filtered.included;
const approvedPrices = validBundles.map(item => item.nok).sort((a, b) => a - b);
assert.equal(validBundles.length, 5);
assert.equal(approvedPrices[Math.floor(approvedPrices.length / 2)], 1005);

console.log(`Test 7.29 Nintendo search fix: PASS (${titles.length} classifier cases, target detection, filtering, minimum pool, valuation wiring)`);
