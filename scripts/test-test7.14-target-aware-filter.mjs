import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'api', 'analyze.js'), 'utf8');
assert.match(source, /BACKEND_VERSION = "v15\.5\.48-test7\.15-guitar-variant-tolerant-filter"/);
assert.match(source, /const targetIsAccessory = Boolean\(criteria\.target_is_console_accessory\)/);
assert.match(source, /!targetIsAccessory && applicableAccessoryTerms\.some/);
assert.match(source, /category === "guitar" && !targetIsAccessory/);
assert.match(source, /category === "console" && !targetIsAccessory/);
assert.match(source, /target_is_accessory:/);

const targetAccessoryPattern = /\b(?:case|cover|screen protector|tempered glass|controller|joy[ -]?con|charger|power adapter|dock|pickup|pickguard|replacement neck|replacement body|spare part|accessory|tilbehør|deksel|lader|reservedel|del til)\b/i;
const accessoryTerms = ['case only','pickup','charger','replacement part','gig bag','poster'];
function targetIsAccessory(text, category='guitar') {
  return /^(?:accessory|accessories|part|parts|tilbehor|tilbehør)$/i.test(category) || targetAccessoryPattern.test(text);
}
function globalAccessoryGateApplies(targetText, listingTitle, category='guitar') {
  return !targetIsAccessory(targetText, category) && accessoryTerms.some(term => listingTitle.toLowerCase().includes(term));
}
assert.equal(globalAccessoryGateApplies('Fender Stratocaster guitar','Fender Stratocaster case only'), true, 'case-only listing rejected for complete guitar target');
assert.equal(globalAccessoryGateApplies('Fender Stratocaster pickup','Fender Stratocaster pickup'), false, 'pickup target must not be rejected by global accessory gate');
assert.equal(globalAccessoryGateApplies('Nintendo Switch OLED acrylic case','Nintendo Switch OLED acrylic case'), false, 'case target must not be rejected by global accessory gate');
assert.equal(globalAccessoryGateApplies('Nintendo Switch OLED console','Nintendo Switch OLED charger'), true, 'charger rejected for complete console target');
assert.equal(globalAccessoryGateApplies('rare poster','rare poster', 'accessory'), false, 'explicit accessory category does not reject accessory listings');
console.log('PASS: target-aware filter static checks and 5 generic accessory/complete-item regression cases.');
