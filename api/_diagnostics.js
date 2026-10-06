*
 * KISTEFUNN DIAGNOSTICS
 * Version: diag-v1
 *
 * Server-side helper.
 * Never logs secrets, API keys, passwords or image contents.
 */

const crypto = require("crypto");

const DIAG_VERSION = "diag-v1";

function cleanText(value, max = 2000) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

function safeMetadata(value) {
  if (!value || typeof value !== "object") return null;

  const blocked = /key|token|secret|password|authorization|cookie|image|base64|dataurl/i;
  const out = {};

  for (const [key, val] of Object.entries(value)) {
    if (blocked.test(key)) continue;

    if (
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean" ||
      val === null
    ) {
      out[key] = typeof val === "string" ? val.slice(0, 500) : val;
    }
  }

  return out;
}

function makeEventId() {
  return `KF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function normalizeError(error) {
  const raw = error || {};

  const status =
    Number(raw.status) ||
    Number(raw.statusCode) ||
    Number(raw.http_status) ||
    null;

  let code =
    raw.code ||
    raw.error?.code ||
    raw.body?.error?.code ||
    null;

  let message =
    raw.message ||
    raw.error?.message ||
    raw.body?.error?.message ||
    null;

  const combined = `${code || ""} ${message || ""}`.toLowerCase();

  if (!code && combined.includes("quota")) {
    code = "quota_exceeded";
  } else if (!code && combined.includes("rate limit")) {
    code = "rate_limit_exceeded";
  } else if (!code && combined.includes("unauthorized")) {
    code = "unauthorized";
  } else if (!code && combined.includes("timeout")) {
    code = "timeout";
  }

  return {
    status,
    code: cleanText(code, 200),
    message: cleanText(message || String(raw), 2000),
  };
}

async function logDiagnostic({
  level = "info",
  stage = "unknown",
  code = null,
  message = null,
  http_status = null,
  backend_version = "v14.18",
  model = null,
  request_id = null,
  image_count = null,
  duration_ms = null,
  metadata = null,
  event_id = null,
} = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const id = event_id || makeEventId();

  // Diagnostics must never break the real analysis.
  if (!supabaseUrl || !serviceKey) {
    console.warn("[KISTEFUNN_DIAGNOSTICS_DISABLED]", {
      id,
      level,
      stage,
      code,
      message,
    });
    return { ok: false, event_id: id, disabled: true };
  }

  const row = {
    event_id: id,
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
    metadata: safeMetadata(metadata),
  };

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/kistefunn_diagnostics`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(row),
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("[KISTEFUNN_DIAGNOSTICS_WRITE_FAILED]", {
        id,
        status: response.status,
        response: text.slice(0, 500),
      });
      return { ok: false, event_id: id };
    }

    return { ok: true, event_id: id };
  } catch (error) {
    console.error("[KISTEFUNN_DIAGNOSTICS_EXCEPTION]", {
      id,
      message: error?.message || String(error),
    });
    return { ok: false, event_id: id };
  }
}

module.exports = {
  DIAG_VERSION,
  makeEventId,
  normalizeError,
  logDiagnostic,
};
