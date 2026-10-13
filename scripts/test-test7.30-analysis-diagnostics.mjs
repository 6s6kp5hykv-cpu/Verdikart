import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import adminDiagnostics from "../api/admin-diagnostics.js";
import { buildAnalysisDiagnosticReport, classifyEbaySearchStatus, logDiagnostic } from "../api/_diagnostics.js";

const UUID = "7f0b4c8a-6df1-4c7b-9a51-f9df7ce12a10";
const originalFetch = globalThis.fetch;
const originalEnv = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL: process.env.ADMIN_EMAIL };
let calls = [];
let dbRows = [];
let dbStatus = 200;
let throwDiagnostics = false;
let authUser = { email: "admin@example.test" };
const logSentinels = ["synthetic-service-role-secret", "synthetic-bearer-token", "private.person@example.test", "+47 900 00 000", "raw-supabase-detail"];
const capturedLogs = [];
const originalConsoleError = console.error;
console.error = (...args) => capturedLogs.push(args.map(value => String(value)).join(" "));

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
}
function mockFetch(url, options = {}) {
  calls.push({ url: String(url), options });
  if (String(url).includes("/auth/v1/user")) return Promise.resolve(response(200, authUser));
  if (String(url).includes("/rest/v1/kistefunn_diagnostics")) {
    if (throwDiagnostics) throw new Error("synthetic-service-role-secret synthetic-bearer-token private.person@example.test +47 900 00 000 raw-supabase-detail " + JSON.stringify(options.headers));
    return Promise.resolve(response(dbStatus, dbStatus >= 200 && dbStatus < 300 ? dbRows : { message: "schema lookup failed; do not return this detail" }));
  }
  throw new Error("Unexpected network destination");
}
async function invoke({ method = "GET", id = UUID, authorization = "Bearer user-session", extraHeaders = {} } = {}) {
  const req = { method, query: id === undefined ? {} : { analysis_request_id: id }, headers: { ...(authorization ? { authorization } : {}), ...extraHeaders } };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await adminDiagnostics(req, res);
  return res;
}

process.env.SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-role-secret";
process.env.ADMIN_EMAIL = "admin@example.test";
globalThis.fetch = mockFetch;
try {
  assert.equal(classifyEbaySearchStatus(undefined, []), "unknown");
  assert.equal(classifyEbaySearchStatus([], []), "not_run");
  assert.equal(classifyEbaySearchStatus([], ["query"]), "no_trace_recorded");
  assert.equal(classifyEbaySearchStatus([{ http_status: 503, raw_count: null }], ["query"]), "search_errors");
  assert.equal(classifyEbaySearchStatus([{ http_status: 200, raw_count: 0 }], ["query"]), "zero_raw_hits");
  assert.equal(classifyEbaySearchStatus([{ http_status: 200, raw_count: 5 }], ["query"]), "raw_hits_received");
  const missingCountTrace = buildAnalysisDiagnosticReport({ analysis_request_id: UUID, ebay: { search_trace: [{ marketplace: "ebay", http_status: 200 }] } });
  assert.deepEqual(missingCountTrace.ebay.search_trace, [{ source: "ebay", http_status: 200, raw_hit_count: null, error_code: "UNKNOWN", error_result: "unknown_result" }], "missing hit count must not be reported as a real zero");

  const attackValues = {
    query: "private search Nintendo Switch OLED",
    error_message: "access_token=secret-value; buyer jan.person@example.test +47 900 00 000",
    error_code: "SUPABASE_SERVICE_ROLE_KEY=secret-value",
    response_headers: { authorization: "Bearer secret-value" },
    api_errors: [{ message: "buyer jan.person@example.test", parameters: [{ value: "secret-value" }] }],
    title: "Nintendo OLED owned by jan.person@example.test",
    raw_response: { email: "jan.person@example.test", token: "secret-value" },
    arbitrary_vendor_field: "private-value"
  };
  const hostileTrace = [{ marketplace: "ebay", http_status: 503, raw_count: 7, ...attackValues }];
  const expectedSafeTrace = [{ source: "ebay", http_status: 503, raw_hit_count: 7, error_code: "HTTP_SERVER_ERROR", error_result: "upstream_failure" }];
  const missingReport = buildAnalysisDiagnosticReport({ analysis_request_id: UUID });
  assert.equal(missingReport.runtime.commit_sha, "unknown");
  assert.equal(missingReport.diagnostic_detail, null, "missing report fields remain missing");

  const report = buildAnalysisDiagnosticReport({
    analysis_request_id: UUID,
    backend_version: "v15.5.62-test7.29-nintendo-search-fix",
    commit_sha: "unknown", vercel_env: "preview", vercel_url: "preview.example.test", deployment_id: "dpl_test123",
    diagnostic_detail: { ebay_search: { search_status: "search_errors", raw_total: 7, trace_entries: 1, requested_query_strings: ["private request search"], successful_query_strings: ["private successful search"], trace: hostileTrace } },
    valuation: { market_value_nok: 3100, median_nok: 3050, low_nok: 2500, high_nok: 3700, market_reference_count: 4, market_data_status: "market_supported", valuation_basis: "Nintendo package", source_weights: [{ source: "ebay", percent: 100 }] },
    ebay: { switch_package_gate: { enabled: true, before_count: 8, after_count: 4, excluded_count: 4, excluded_reasons: { package_contents_unconfirmed: 4 } }, sample_size: 4, distinct_valuation_count: 4, search_trace: hostileTrace, valuation_used_listing_audit: [{ title: "Buyer jan.person@example.test secret-value Nintendo Switch OLED", item_id: "123", price_nok: 3100, used_for_valuation: true }], api_token: "must-not-persist", cookie: "must-not-persist" }
  });
  assert.equal(report.analysis_request_id, UUID);
  assert.equal(report.runtime.deployment_id, "dpl_test123");
  assert.equal(report.valuation.market_reference_count, 4);
  assert.equal(report.ebay.switch_package_gate.after_count, 4);
  assert.deepEqual(report.diagnostic_detail.ebay_search.trace, expectedSafeTrace);
  assert.deepEqual(report.ebay.search_trace, expectedSafeTrace);
  assert.equal(report.ebay.valuation_used_listing_audit[0].title, undefined, "listing titles are excluded from the stored report");
  assert.equal(report.ebay.valuation_used_listing_audit[0].item_id, "123");
  assert.equal(report.diagnostic_detail.ebay_search.requested_query_strings, undefined);
  assert.equal(report.diagnostic_detail.ebay_search.successful_query_strings, undefined);
  assert.ok(JSON.stringify(report).length <= 90000, "bounded report stays under 90 KB");
  const oversized = buildAnalysisDiagnosticReport({ analysis_request_id: UUID, ebay: { valuation_listing_audit: Array.from({ length: 500 }, (_, i) => ({ item_id: String(i), title: "x".repeat(5000) })) } });
  assert.ok(JSON.stringify(oversized).length <= 90000, "oversized audit remains capped at 90 KB");
  assert.ok(oversized.ebay.valuation_listing_audit.length <= 30, "large listing arrays are capped");
  assert.doesNotMatch(JSON.stringify(report), /private search|private request|private successful|secret-value|jan\.person@example\.test|\+47 900|private-value|raw_response/i, "trace values and unapproved fields never enter report");

  calls = [];
  const noId = await invoke({ id: null });
  assert.equal(noId.statusCode, 400);
  assert.equal(calls.length, 0, "missing ID must not query storage");

  const unauthenticated = await invoke({ authorization: "" });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(calls.length, 0, "missing auth must not query Supabase");

  calls = [];
  authUser = { email: "not-admin@example.test" };
  const forbidden = await invoke();
  assert.equal(forbidden.statusCode, 403);
  assert.equal(calls.length, 1, "non-admin is stopped before diagnostics table access");
  assert.ok(!calls[0].url.includes("kistefunn_diagnostics"));

  authUser = { email: "admin@example.test" };
  dbStatus = 200;
  calls = [];
  dbRows = [{ id: 9, created_at: "2026-10-13T10:00:00Z", event_id: "KF-TEST", stage: "analysis_completed", code: "analysis_completed", backend_version: "v15.5.62-test7.29-nintendo-search-fix", metadata: { analysis_request_id: UUID, analysis_report: { ...report, unrelated_secret: "must-not-return", access_token: "must-not-return-token" }, unrelated_secret: "must-not-return" }, user_email: "other-user@example.test" }];
  const found = await invoke();
  assert.equal(found.statusCode, 200);
  assert.equal(found.body.report.analysis_request_id, UUID);
  assert.equal(found.body.report.report.ebay.switch_package_gate.enabled, true);
  assert.equal(calls.length, 2);
  const dbUrl = new URL(calls[1].url);
  assert.equal(dbUrl.searchParams.get("metadata->>analysis_request_id"), "eq." + UUID, "query is exact ID filter");
  assert.equal(dbUrl.searchParams.get("stage"), "eq.analysis_completed");
  assert.equal(dbUrl.searchParams.get("limit"), "2");
  const returned = JSON.stringify(found.body);
  assert.doesNotMatch(returned, /unrelated_secret|other-user@example.test|test-service-role-secret|must-not-persist/, "response excludes unapproved fields and secrets");

  dbRows = [];
  const missing = await invoke();
  assert.equal(missing.statusCode, 404, "unknown ID is distinct from an unfiltered list");

  calls = [];
  dbStatus = 400;
  const schemaFailure = await invoke();
  assert.equal(schemaFailure.statusCode, 502, "missing schema or failed ID lookup returns a safe upstream error");
  assert.deepEqual(schemaFailure.body, { error: "Could not read the requested diagnostic report." });
  assert.equal(calls.length, 2, "failed schema lookup makes one authenticated ID lookup only");
  const failedQueryUrl = new URL(calls[1].url);
  assert.equal(failedQueryUrl.searchParams.get("metadata->>analysis_request_id"), "eq." + UUID, "schema failure does not trigger an unfiltered history query");
  assert.equal(failedQueryUrl.searchParams.get("limit"), "2");
  assert.doesNotMatch(JSON.stringify(schemaFailure.body), /schema lookup failed|secret/i);

  // Database responses and thrown transport errors may contain arbitrary provider text.
  // Keep both client responses and server logs to fixed, non-sensitive diagnostics.
  calls = [];
  capturedLogs.length = 0;
  dbStatus = 503;
  const databaseError = await invoke({ authorization: "Bearer synthetic-bearer-token" });
  assert.equal(databaseError.statusCode, 502);
  assert.deepEqual(databaseError.body, { error: "Could not read the requested diagnostic report." });
  assert.equal(calls.length, 2, "database failure performs only auth and one exact-ID lookup");
  assert.equal(new URL(calls[1].url).searchParams.get("metadata->>analysis_request_id"), "eq." + UUID);
  assert.doesNotMatch(JSON.stringify(databaseError.body), /synthetic|private\.person|raw-supabase/i);
  assert.doesNotMatch(capturedLogs.join("\n"), /synthetic-service-role-secret|synthetic-bearer-token|private\.person@example\.test|\+47 900 00 000|raw-supabase-detail/i);

  calls = [];
  capturedLogs.length = 0;
  throwDiagnostics = true;
  const transportError = await invoke({ authorization: "Bearer synthetic-bearer-token", extraHeaders: { "x-test-private-data": "private.person@example.test +47 900 00 000" } });
  throwDiagnostics = false;
  assert.equal(transportError.statusCode, 500);
  assert.deepEqual(transportError.body, { error: "Admin diagnostics lookup failed." });
  assert.equal(calls.length, 2, "transport failure does not issue a history fallback");
  assert.equal(new URL(calls[1].url).searchParams.get("metadata->>analysis_request_id"), "eq." + UUID);
  assert.doesNotMatch(JSON.stringify(transportError.body), /synthetic|private\.person|raw-supabase/i);
  assert.doesNotMatch(capturedLogs.join("\n"), /synthetic-service-role-secret|synthetic-bearer-token|private\.person@example\.test|\+47 900 00 000|raw-supabase-detail/i);
  assert.deepEqual(capturedLogs, ["ADMIN_DIAGNOSTICS_LOOKUP_FAILED"], "admin logs use a fixed code only");

  // The writer must not log a provider response body or exception message.
  capturedLogs.length = 0;
  const originalWriterFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    options.headers["X-Test-Private-Data"] = "private.person@example.test +47 900 00 000";
    assert.match(options.headers.Authorization, /synthetic-service-role-secret/);
    return { ok: false, status: 500, text: async () => JSON.stringify({ detail: logSentinels.join(" "), headers: options.headers }) };
  };
  const writeFailure = await logDiagnostic({ stage: "analysis_completed", message: logSentinels.join(" ") });
  assert.equal(writeFailure.ok, false);
  assert.doesNotMatch(capturedLogs.join("\n"), /synthetic-service-role-secret|synthetic-bearer-token|private\.person@example\.test|\+47 900 00 000|raw-supabase-detail/i);

  capturedLogs.length = 0;
  globalThis.fetch = async () => { throw new Error(logSentinels.join(" ")); };
  const writeTransportFailure = await logDiagnostic({ stage: "analysis_completed" });
  globalThis.fetch = originalWriterFetch;
  assert.equal(writeTransportFailure.ok, false);
  assert.doesNotMatch(capturedLogs.join("\n"), /synthetic-service-role-secret|synthetic-bearer-token|private\.person@example\.test|\+47 900 00 000|raw-supabase-detail/i);
  console.error = originalConsoleError;

  dbStatus = 200;
  dbRows = [{ metadata: { analysis_request_id: UUID, analysis_report: report } }, { metadata: { analysis_request_id: UUID, analysis_report: report } }];
  const duplicate = await invoke();
  assert.equal(duplicate.statusCode, 409, "ambiguous duplicate reports are not silently selected");

  const invalidId = await invoke({ id: "not-a-uuid" });
  assert.equal(invalidId.statusCode, 400);
  const analyzeSource = await readFile(new URL("../api/analyze.js", import.meta.url), "utf8");
  assert.match(analyzeSource, /diagnostic_detail:\s*persistedReport\.diagnostic_detail/, "stored diagnostic detail uses the sanitized report projection");
  for (const file of ["../index.html", "../diagnostics.html"]) {
    const html = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(html, /admin-diagnostics\?analysis_request_id=/, file + " must query by analysis ID");
    assert.match(html, /Analyse-ID|analysisRequestIdDisplay/, file + " must expose ID entry/result display");
    const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(scriptRe)) if (match[1].trim()) new vm.Script(match[1], { filename: file });
  }
  console.log("PASS Test 7.30: trace allowlist/value redaction, bounded report, safe error logs/responses, auth, exact ID query, no history fallback.");
} finally {
  console.error = originalConsoleError;
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
