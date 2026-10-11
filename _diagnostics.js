/*
KISTEFUNN DIAGNOSTICS
Version: diag-v3
*/

var crypto = require("crypto");

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

  var blocked = /key|token|secret|password|authorization|cookie|image|base64|dataurl/i;
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

function makeEventId() {
  return "KF-" + crypto.randomBytes(4).toString("hex").toUpperCase();
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
      var responseText = await response.text().catch(function () {
        return "";
      });

      console.error(
        "[KISTEFUNN_DIAGNOSTICS_WRITE_FAILED]",
        event_id,
        response.status,
        responseText.slice(0, 500)
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
      event_id,
      error && error.message ? error.message : String(error)
    );

    return {
      ok: false,
      event_id: event_id
    };
  }
}

module.exports = {
  DIAG_VERSION: DIAG_VERSION,
  makeEventId: makeEventId,
  normalizeError: normalizeError,
  logDiagnostic: logDiagnostic
};
