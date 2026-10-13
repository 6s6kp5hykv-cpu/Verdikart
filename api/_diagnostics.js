/*
KISTEFUNN DIAGNOSTICS
Version: diag-v3
*/

import crypto from "node:crypto";

var DIAG_VERSION = "diag-v3";

function cleanText(value, max) {
  if (max === undefined) max = 2000;
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

function safeMetadata(value, depth) {
  depth = depth || 0;
  if (value === null || value === undefined) return null;
  if (depth > 6) return "[truncated-depth]";

  var blocked = /key|token|secret|password|authorization|cookie|image|base64|dataurl|request.?body|prompt|user.?email|session/i;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 30).map(function (item) {
      return safeMetadata(item, depth + 1);
    });
  }
  if (typeof value !== "object") return null;

  var out = {};
  Object.keys(value).slice(0, 40).forEach(function (key) {
    if (blocked.test(key)) return;
    var val = value[key];
    if (val === null || ["string", "number", "boolean"].includes(typeof val) || Array.isArray(val) || (val && typeof val === "object")) {
      out[key.slice(0, 100)] = safeMetadata(val, depth + 1);
    }
  });
  return out;
}

function sanitizeDiagnosticMetadata(value) { return safeMetadata(value); }
function sanitizeEbaySearchTrace(trace) {
  if (!Array.isArray(trace)) return null;
  return trace.slice(0, 12).map(function (entry) {
    entry = entry && typeof entry === "object" ? entry : {};
    var parsedStatus = Number(entry.http_status);
    var status = Number.isInteger(parsedStatus) && parsedStatus >= 100 && parsedStatus <= 599 ? parsedStatus : null;
    var rawCount = entry.raw_hit_count ?? entry.raw_count;
    var parsedCount = rawCount === null || rawCount === undefined || rawCount === "" ? NaN : Number(rawCount);
    var count = Number.isInteger(parsedCount) && parsedCount >= 0 ? Math.min(parsedCount, 1000000) : null;
    var result = "unknown_result";
    var code = "UNKNOWN";
    if (status !== null && status >= 200 && status < 300) {
      if (count > 0) { result = "hits_received"; code = "NONE"; }
      else if (count === 0) { result = "zero_results"; code = "NO_RESULTS"; }
    } else if (status === 408 || status === 504) {
      result = "timeout"; code = "TIMEOUT";
    } else if (status !== null && status >= 400 && status < 500) {
      result = "request_rejected"; code = "HTTP_CLIENT_ERROR";
    } else if (status !== null && status >= 500) {
      result = "upstream_failure"; code = "HTTP_SERVER_ERROR";
    } else if (status === null) {
      result = "request_failed"; code = "REQUEST_FAILED";
    }
    var source = String(entry.source || entry.marketplace || "").trim().toLowerCase() === "ebay" ? "ebay" : "other";
    return { source: source, http_status: status, raw_hit_count: count, error_code: code, error_result: result };
  });
}
function sanitizeAnalysisDiagnosticDetail(value) {
  var safe = safeMetadata(value);
  if (!safe || typeof safe !== "object" || Array.isArray(safe)) return safe;
  var search = value && value.ebay_search;
  if (search && typeof search === "object") {
    safe.ebay_search = {
      search_status: ["unknown", "not_run", "no_trace_recorded", "search_errors", "zero_raw_hits", "raw_hits_received"].includes(search.search_status) ? search.search_status : "unknown",
      raw_total: Number.isFinite(Number(search.raw_total)) ? Number(search.raw_total) : null,
      trace_entries: Number.isFinite(Number(search.trace_entries)) ? Number(search.trace_entries) : null,
      trace: sanitizeEbaySearchTrace(search.trace)
    };
  }
  return safe;
}
function sanitizeAnalysisEbayReport(value) {
  var safe = safeMetadata(value);
  if (!safe || typeof safe !== "object" || Array.isArray(safe)) return safe;
  if (value && Object.prototype.hasOwnProperty.call(value, "search_trace")) safe.search_trace = sanitizeEbaySearchTrace(value.search_trace);
  for (var field of ["valuation_listing_audit", "valuation_used_listing_audit"]) {
    if (!Array.isArray(value[field])) continue;
    safe[field] = value[field].slice(0, 30).map(function (item) {
      item = item && typeof item === "object" ? item : {};
      var price = Number(item.price_nok);
      return {
        item_id: String(item.item_id || item.itemId || "").slice(0, 80) || null,
        price_nok: Number.isFinite(price) ? price : null,
        used_for_valuation: Boolean(item.used_for_valuation)
      };
    });
  }
  return safe;
}
function makeEventId() {
  return "KF-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function classifyEbaySearchStatus(searchTrace, discoveryQueries) {
  if (!Array.isArray(searchTrace)) return "unknown";
  if (searchTrace.length === 0) return Array.isArray(discoveryQueries) && discoveryQueries.length > 0 ? "no_trace_recorded" : "not_run";
  if (searchTrace.some(item => Number(item?.http_status) === 200 && Number(item?.raw_count) > 0)) return "raw_hits_received";
  if (searchTrace.some(item => Number(item?.http_status) === 200)) return "zero_raw_hits";
  return "search_errors";
}
function buildAnalysisDiagnosticReport(input) {
  input = input && typeof input === "object" ? input : {};
  var report = {
    schema_version: 1,
    analysis_request_id: cleanText(input.analysis_request_id, 36),
    runtime: {
      backend_version: cleanText(input.backend_version || "unknown", 80),
      commit_sha: cleanText(input.commit_sha || "unknown", 40),
      vercel_env: cleanText(input.vercel_env || "unknown", 20),
      vercel_url: cleanText(input.vercel_url || "unknown", 200),
      deployment_id: cleanText(input.deployment_id || "unknown", 100)
    },
    diagnostic_detail: sanitizeAnalysisDiagnosticDetail(input.diagnostic_detail),
    valuation: safeMetadata(input.valuation),
    ebay: sanitizeAnalysisEbayReport(input.ebay)
  };
  var serialized = JSON.stringify(report);
  if (serialized.length > 90000) {
    if (report.ebay && Array.isArray(report.ebay.valuation_listing_audit)) report.ebay.valuation_listing_audit = report.ebay.valuation_listing_audit.slice(0, 30);
    if (report.ebay && Array.isArray(report.ebay.valuation_used_listing_audit)) report.ebay.valuation_used_listing_audit = report.ebay.valuation_used_listing_audit.slice(0, 30);
    if (report.diagnostic_detail && report.diagnostic_detail.ebay_search && Array.isArray(report.diagnostic_detail.ebay_search.trace)) report.diagnostic_detail.ebay_search.trace = report.diagnostic_detail.ebay_search.trace.slice(0, 8);
    serialized = JSON.stringify(report);
  }
  if (serialized.length > 90000) report = {
    schema_version: 1, analysis_request_id: report.analysis_request_id, runtime: report.runtime,
    diagnostic_detail: { omitted: "report_exceeded_size_limit" }, valuation: report.valuation,
    ebay: { omitted: "report_exceeded_size_limit" }
  };
  return report;
}

function normalizeError(error) {
  var raw = error || {};

  var status =
    Number(raw.status) ||
    Number(raw.statusCode) ||
    Number(raw.http_status) ||
    null;

  var code =
    raw.code ||
    (raw.error && raw.error.code) ||
    (raw.body && raw.body.error && raw.body.error.code) ||
    null;

  var message =
    raw.message ||
    (raw.error && raw.error.message) ||
    (raw.body && raw.body.error && raw.body.error.message) ||
    null;

  var combined = String(code || "") + " " + String(message || "");
  combined = combined.toLowerCase();

  if (!code && combined.indexOf("quota") !== -1) {
    code = "quota_exceeded";
  } else if (!code && combined.indexOf("rate limit") !== -1) {
    code = "rate_limit_exceeded";
  } else if (!code && combined.indexOf("unauthorized") !== -1) {
    code = "unauthorized";
  } else if (!code && combined.indexOf("timeout") !== -1) {
    code = "timeout";
  }

  return {
    status: status,
    code: cleanText(code, 200),
    message: cleanText(message || String(raw), 2000)
  };
}

async function logDiagnostic(options) {
  options = options || {};

  var level = options.level || "info";
  var stage = options.stage || "unknown";
  var code = options.code || null;
  var message = options.message || null;
  var http_status = options.http_status || null;
  var backend_version = options.backend_version || "unspecified";
  var model = options.model || null;
  var request_id = options.request_id || null;
  var image_count = options.image_count;
  var duration_ms = options.duration_ms;
  var metadata = options.metadata || null;
  var event_id = options.event_id || makeEventId();

  var supabaseUrl = process.env.SUPABASE_URL;
  var serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.warn("[KISTEFUNN_DIAGNOSTICS_DISABLED]", event_id);
    return {
      ok: false,
      event_id: event_id,
      disabled: true
    };
  }

  var row = {
    event_id: cleanText(event_id, 100),
    level: cleanText(level, 50),
    stage: cleanText(stage, 100),
    code: cleanText(code, 200),
    message: cleanText(message, 2000),
    http_status: Number.isFinite(Number(http_status))
      ? Number(http_status)
      : null,
    backend_version: cleanText(backend_version, 50),
    model: cleanText(model, 100),
    request_id: cleanText(request_id, 200),
    image_count: Number.isFinite(Number(image_count))
      ? Number(image_count)
      : null,
    duration_ms: Number.isFinite(Number(duration_ms))
      ? Number(duration_ms)
      : null,
    metadata: safeMetadata(metadata)
  };

  try {
    var response = await fetch(
      supabaseUrl + "/rest/v1/kistefunn_diagnostics",
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: "Bearer " + serviceKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify(row)
      }
    );

    if (!response.ok) {
      console.error(
        "[KISTEFUNN_DIAGNOSTICS_WRITE_FAILED]",
        event_id,
        Number.isInteger(response.status) ? response.status : "unknown_status"
      );

      return {
        ok: false,
        event_id: event_id
      };
    }

    return {
      ok: true,
      event_id: event_id
    };
  } catch (error) {
    console.error(
      "[KISTEFUNN_DIAGNOSTICS_EXCEPTION]",
      event_id
    );

    return {
      ok: false,
      event_id: event_id
    };
  }
}

export { DIAG_VERSION, makeEventId, normalizeError, logDiagnostic, buildAnalysisDiagnosticReport, sanitizeDiagnosticMetadata, sanitizeEbaySearchTrace, classifyEbaySearchStatus };
