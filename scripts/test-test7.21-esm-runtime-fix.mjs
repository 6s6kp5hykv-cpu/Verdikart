import fs from "node:fs";
import assert from "node:assert/strict";
const root = new URL("../api/", import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8"));
assert.equal(pkg.type, "module");
const analyze = fs.readFileSync(new URL("analyze.js", root), "utf8");
assert.match(analyze, /^import \{ identifyWithOpenAI \}/m);
assert.match(analyze, /v15\.5\.54-test7\.21-esm-runtime-fix/);
const diag = fs.readFileSync(new URL("_diagnostics.js", root), "utf8");
assert.match(diag, /export \{ DIAG_VERSION, makeEventId, normalizeError, logDiagnostic \}/);
for (const file of ["diagnostics.js", "testlab-report.js"]) {
  const src = fs.readFileSync(new URL(file, root), "utf8");
  assert.match(src, /export default async function handler/);
  assert.doesNotMatch(src, /module\.exports|require\(/);
}
console.log("Test 7.21 ESM runtime static checks passed");
