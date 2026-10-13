import assert from "node:assert/strict";
import fs from "node:fs";
const source = fs.readFileSync(new URL("../api/analyze.js", import.meta.url), "utf8");
assert.match(source, /v15\.5\.57-test7\.24-ebay-trace-propagation/);
const start = source.indexOf("search_trace: results.slice(0, 12).map(result => {");
assert.notEqual(start, -1, "search_trace mapper exists");
const end = source.indexOf("successful_queries:", start);
assert.notEqual(end, -1, "search_trace mapper ends before successful_queries");
const trace = source.slice(start, end);
for (const field of ["error_message:", "retry_count:", "retry_after:", "response_headers:", "api_errors:"]) {
  assert.ok(trace.includes(field), `trace propagates ${field}`);
}
for (const header of ["content-type", "retry-after", "x-ebay-c-request-id", "x-ebay-correlation-id", "x-ratelimit-remaining"]) {
  assert.ok(trace.includes(`"${header}"`), `safe header allowlist contains ${header}`);
}
assert.ok(!trace.includes('"authorization"'), "Authorization header is not copied into trace");
assert.ok(!trace.includes('"client-secret"'), "client secret header is not copied into trace");
console.log("Test 7.24 trace-propagation assertions: PASS");
