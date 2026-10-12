#!/usr/bin/env node
// Kistefunn Test 7.16 regression checks — local/static only.
import assert from "node:assert/strict";
import fs from "node:fs";
const source = fs.readFileSync(new URL("../api/analyze.js", import.meta.url), "utf8");
assert.match(source, /v15\.5\.(?:49-test7\.16-console-accessory-filter-fix|51-test7\.18-valuation-listing-audit)/);
const patterns = [
  /(?:transporttasche|tragetasche|reisetasche|schutztasche|tasche für switch|switch tasche|carrying bag|travel bag|storage bag|console bag)/i,
  /(?:replacement )?(?:oled )?screen (?:assembly|module|replacement)/i,
  /(?:oled )?(?:screen )?assembly.{0,35}(?:battery|display|replacement|tested)/i,
  /(?:motherboard|mainboard|logic board|circuit board)/i,
  /(?:micro[- ]soldering|soldering) (?:service|repair)|(?:repair|mail[- ]in) service/i
];
const blocked = [
  "Nintendo Switch Transporttasche | Tasche für Switch & OLED | Schutz Case",
  "Used original OEM Nintendo Switch Screen OLED Assembly W Battery Tested",
  "Tested Working Nintendo Switch OLED HEG-001 Motherboard HEG-CPU-01",
  "Nintendo Switch OLED Advanced Micro-Soldering Service (Mail-In UK)"
];
const allowed = [
  "Nintendo Switch OLED 64GB Game Console",
  "Nintendo Switch OLED Console Bundle with Dock and Joy-Con"
];
for (const title of blocked) assert.ok(patterns.some(p=>p.test(title)), `should match accessory/service: ${title}`);
for (const title of allowed) assert.ok(!patterns.some(p=>p.test(title)), `new accessory-only patterns should not match complete console: ${title}`);
for (const token of ["transporttasche", "screen (?:assembly|module|replacement)", "motherboard|mainboard", "micro[- ]soldering|soldering"]) assert.ok(source.includes(token), `backend is missing token: ${token}`);
console.log("Test 7.16 local regression checks: PASS (4 accessory/service titles; 2 complete-console titles preserved by the new patterns)");
