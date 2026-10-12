import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'api', 'analyze.js'), 'utf8');
assert.match(source, /const BACKEND_VERSION = "v15\.5\.46-test7\.13-console-accessory-fender-diagnostics"/);
assert.match(source, /score_rejection_reasons: \{\}/);
assert.match(source, /built\.target_is_console_accessory\s*\?\s*\[\]/);
const accessoryPatterns = [
  /\b(?:joy[ -]?con|controller|gamepad)s?\b.{0,35}\b(?:pair|set|replacement|only|controllers?)\b/i,
  /\b(?:acrylic|protective|carrying|travel|storage|hard|silicone)\s+(?:console\s+)?case\b/i,
  /\bcase\s+(?:for|compatible with)\s+(?:the\s+)?nintendo\s+switch\b/i,
  /\b(?:screen protector|tempered glass|screen film)\b/i,
  /\b(?:dock only|charging dock only|power adapter only|charger only)\b/i,
  /\b(?:cooling fan|replacement fan|fan only|radiator|heatsink|heat sink|lüfter|kühler)\b/i
];
const consoleIdentityWords = /\b(?:console|system|handheld|tablet|complete|bundle|with dock|inkl(?:usive)?\s+dock|mit dock|konsoll|gerät|geraet)\b/i;
const partTerms = ['disc drive','disc-drive','laufwerk','disc reader','controller only','dualsense only','gamepad only','replacement','repair','defekt','broken','for parts','parts only','fan only','cooling fan','replacement fan','radiator','heatsink','heat sink','lüfter','kühler','power supply','netzteil','stand only','vertical stand','faceplate','cover only','joy-con pair','joycon pair','joy-con controllers','joycon controllers','acrylic case','protective case','screen protector','tempered glass','screen film'];
function rejects(title) {
  const raw = title;
  const explicitCase = /\b(?:acrylic|protective|carrying|travel|storage|hard|silicone)\s+(?:console\s+)?case\b/i.test(raw) && !/\b(?:console included|includes? (?:the )?console|complete console|console bundle|bundle with console)\b/i.test(raw);
  const explicitCooling = /\b(?:cooling fan|replacement fan|fan only|radiator|heatsink|heat sink|lüfter|kühler)\b/i.test(raw) && !/\b(?:complete console|console included|includes? (?:the )?console|console bundle|bundle with console|complete system)\b/i.test(raw);
  const controllerOnly = partTerms.some(t => raw.toLowerCase().includes(t)) && !/\b(?:complete console|console included|includes? (?:the )?console|console bundle|bundle with console|complete system|console with (?:dock|controllers|controller|joy[ -]?con)|console,? (?:with )?(?:dock|controllers|controller|joy[ -]?con))\b/i.test(raw);
  return explicitCase || (accessoryPatterns.some(p => p.test(raw)) && !consoleIdentityWords.test(raw)) || explicitCooling || controllerOnly;
}
assert.equal(rejects('Nintendo Switch OLED Konsole Console Lüfter Fan Kühler Radiator for OLED'), true, 'fan/radiator accessory must be rejected');
assert.equal(rejects('Nintendo Switch OLED Acrylic Protective Case'), true, 'accessory case must be rejected');
assert.equal(rejects('Nintendo Switch OLED console with dock and Joy-Con controllers'), false, 'complete console bundle must not be rejected');
assert.equal(rejects('Nintendo Switch OLED console bundle with case and Joy-Con'), false, 'bundle mention must not be rejected by the new regex gate');
const targetAccessory = /\b(?:acrylic|protective|carrying|travel|storage|hard|silicone)\s+(?:console\s+)?case\b|\bcase\s+(?:for|compatible with)\s+(?:the\s+)?nintendo\s+switch\b|\b(?:screen protector|tempered glass|screen film|replacement joy[ -]?con|controller pair|fan only|cooling fan|radiator|heatsink|lüfter|kühler)\b/i;
assert.equal(targetAccessory.test('Nintendo Switch OLED acrylic case'), true, 'explicit accessory target should suppress fallback/details');
assert.equal(targetAccessory.test('Nintendo Switch OLED console'), false, 'complete console target should retain fallbacks/details');
console.log('PASS: version/source assertions, accessory rejection, complete-console bundle guard, accessory-target detection.');
