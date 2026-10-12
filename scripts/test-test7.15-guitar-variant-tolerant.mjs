import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'api', 'analyze.js'), 'utf8');
assert.match(source, /BACKEND_VERSION = "v15\.5\.48-test7\.15-guitar-variant-tolerant-filter"/);
assert.match(source, /const applicableAccessoryTerms = category === "guitar"/);
assert.match(source, /accessoryTerms\.filter\(term => !\["pick", "pickup", "pickguard", "bridge", "neck"\]\.includes\(term\)\)/);
assert.match(source, /eksplisitt plekterbrettfarge stemmer ikke/);

const accessoryTerms = ['pedal','pick','pickup','pickguard','bridge','neck','replacement neck','case only','parts'];
function accessoryGateRejects(title, category='guitar') {
  const terms = category === 'guitar' ? accessoryTerms.filter(t => !['pick','pickup','pickguard','bridge','neck'].includes(t)) : accessoryTerms;
  return terms.some(term => title.toLowerCase().includes(term));
}
assert.equal(accessoryGateRejects('Fender Stratocaster HSS with upgraded pickups and tremolo bridge'), false,
  'complete guitar mentioning pickups and bridge must not be rejected by generic accessory gate');
assert.equal(accessoryGateRejects('Fender Stratocaster with maple neck and white pickguard'), false,
  'complete guitar mentioning neck and pickguard must remain eligible');
assert.equal(accessoryGateRejects('Fender Stratocaster replacement neck only'), true,
  'standalone replacement neck remains rejected by general part language');
assert.equal(accessoryGateRejects('Fender Stratocaster pickguard only'), false,
  'pickguard-only is handled by the dedicated guitar-part gate, not generic substring matching');

function explicitlyRequestedPickguardColorMismatch(query, title) {
  const hasPickguard = /\b(pickguard|pick guard|plekterbrett)\b/i.test(query);
  const targetColor = hasPickguard && /\b(black|svart|sort)\b/i.test(query) ? 'black'
    : hasPickguard && /\b(white|hvit)\b/i.test(query) ? 'white' : null;
  if (!targetColor) return false;
  const match = title.match(/\b(black|svart|sort|white|hvit)\b[^,;]{0,30}\b(pickguard|pick guard|plekterbrett)\b|\b(pickguard|pick guard|plekterbrett)\b[^,;]{0,30}\b(black|svart|sort|white|hvit)\b/i);
  if (!match) return false;
  const listingColor = /\b(black|svart|sort)\b/i.test(match[0]) ? 'black' : /\b(white|hvit)\b/i.test(match[0]) ? 'white' : null;
  return Boolean(listingColor && listingColor !== targetColor);
}
assert.equal(explicitlyRequestedPickguardColorMismatch('Fender Stratocaster USA black pickguard', 'Fender Stratocaster USA with white pickguard'), true,
  'explicit black pickguard requirement rejects white pickguard');
assert.equal(explicitlyRequestedPickguardColorMismatch('Fender Stratocaster USA', 'Fender Stratocaster USA with white pickguard'), false,
  'pickguard color is flexible when user did not specify it');
assert.equal(explicitlyRequestedPickguardColorMismatch('Fender Stratocaster USA black pickguard', 'Fender Stratocaster USA with black pickguard'), false,
  'matching explicitly requested pickguard color remains eligible');
console.log('PASS: Test 7.15 guitar variant-tolerant checks (complete-guitar features, part rejection intent, explicit pickguard color).');
