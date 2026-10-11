/*
 * KISTEFUNN DIAGNOSTICS API
 * Version: diag-v4 / v15.5.33 candidate
 *
 * GET is retired; protected reads use /api/admin-diagnostics.
 * POST accepts only bounded frontend telemetry, never arbitrary row fields.
 */

const { logDiagnostic } = require("./_diagnostics");

const DIAG_VERSION = "diag-v4";
const MAX_BODY_BYTES = 24 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 20;
// Best-effort per-instance protection. Serverless instances do not share this map.
const requestBuckets = new Map();

function jsonSize(value) {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); }
  catch (_) { return Infinity; }
}

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  const host = req.headers && req.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === String(host).toLowerCase()
      && (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  } catch (_) { return false; }
}

function withinRateLimit(req, now = Date.now()) {
  const forwarded = String((req.headers || {})["x-forwarded-for"] || "").split(",")[0].trim();
  const key = forwarded || "unknown";
  const old = requestBuckets.get(key);
  if (!old || now - old.start >= RATE_WINDOW_MS) {
    requestBuckets.set(key, { start: now, count: 1 });
  } else {
    old.count += 1;
    if (old.count > RATE_LIMIT) return false;
  }
  // Keep memory bounded on warm serverless instances.
  if (requestBuckets.size > 500) {
    for (const [k, v] of requestBuckets) if (now - v.start >= RATE_WINDOW_MS) requestBuckets.delete(k);
    if (requestBuckets.size > 500) requestBuckets.clear();
  }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") {
    return res.status(410).json({
      ok: false,
      diagnostic_version: DIAG_VERSION,
      error: { code: "diagnostics_read_moved", message: "Diagnostikklesing krever admin-tilgang. Bruk det beskyttede adminpanelet." }
    });
  }

  if (req.method === "POST") {
    if (!sameOrigin(req)) {
      return res.status(403).json({ ok: false, diagnostic_version: DIAG_VERSION, error: { code: "origin_rejected", message: "Ugyldig eller manglende Origin." } });
    }
    if (!withinRateLimit(req)) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({ ok: false, diagnostic_version: DIAG_VERSION, error: { code: "rate_limited", message: "For mange diagnostikkhendelser. Prøv igjen senere." } });
    }
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ ok: false, diagnostic_version: DIAG_VERSION, error: { code: "invalid_body", message: "Body må være et JSON-objekt." } });
      }
      if (jsonSize(body) > MAX_BODY_BYTES) {
        return res.status(413).json({ ok: false, diagnostic_version: DIAG_VERSION, error: { code: "payload_too_large", message: "Diagnostikkpayloaden er for stor." } });
      }
      // Allow only the telemetry columns used by the frontend; ignore caller-supplied IDs.
      const allowed = ["level", "stage", "code", "message", "http_status", "backend_version", "model", "request_id", "image_count", "duration_ms", "metadata"];
      const safe = {};
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(body, key)) safe[key] = body[key];
      safe.backend_version = safe.backend_version || "frontend-unspecified";
      const result = await logDiagnostic(safe);
      return res.status(result.ok ? 200 : 503).json({
        ok: Boolean(result.ok), diagnostic_version: DIAG_VERSION, event_id: result.event_id,
        ...(result.ok ? {} : { error: { code: "diagnostic_write_failed", message: "Diagnostikkhendelsen kunne ikke lagres." } })
      });
    } catch (_) {
      return res.status(400).json({ ok: false, diagnostic_version: DIAG_VERSION, error: { code: "diagnostics_bad_request", message: "Ugyldig diagnostikkforespørsel." } });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, diagnostic_version: DIAG_VERSION, error: { code: "method_not_allowed", message: "GET eller POST er tillatt." } });
};
