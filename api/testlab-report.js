
/* Kistefunn TestLab report ingestion — v1.1.0
 * Accepts bounded TestRunner JSON reports and stores them in a dedicated table.
 * No report read endpoint; no credentials are accepted from the client.
 */
import crypto from 'node:crypto';

const MAX_BODY_BYTES = 512 * 1024;
const WINDOW_MS = 60 * 1000;
const LIMIT = 12;
const buckets = new Map();

function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  const host = req.headers && req.headers.host;

  if (!origin || !host) return false;

  try {
    const u = new URL(origin);
    return (
      u.host.toLowerCase() === String(host).toLowerCase() &&
      (u.protocol === 'https:' ||
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1')
    );
  } catch (_) {
    return false;
  }
}

function allowedRate(req) {
  const ip = String(
    (req.headers || {})['x-forwarded-for'] || 'unknown'
  ).split(',')[0].trim();

  const now = Date.now();
  const b = buckets.get(ip);

  if (!b || now - b.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
  } else {
    b.count++;
    if (b.count > LIMIT) return false;
  }

  if (buckets.size > 300) {
    for (const [k, v] of buckets) {
      if (now - v.start >= WINDOW_MS) buckets.delete(k);
    }
  }

  return true;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      ok: false,
      error: 'method_not_allowed'
    });
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({
      ok: false,
      error: 'origin_rejected'
    });
  }

  if (!allowedRate(req)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      ok: false,
      error: 'rate_limited'
    });
  }

  let body;

  try {
    body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});
  } catch (_) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_json'
    });
  }

  let raw;

  try {
    raw = JSON.stringify(body);
  } catch (_) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_report'
    });
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({
      ok: false,
      error: 'report_too_large'
    });
  }

  if (
    !body ||
    body.report_type !== 'kistefunn_test_runner' ||
    !Array.isArray(body.results) ||
    !body.summary ||
    typeof body.summary !== 'object' ||
    body.results.length < 1 ||
    body.results.length > 20
  ) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_report_shape'
    });
  }

  if (
    typeof body.created_at !== 'string' ||
    !Number.isFinite(Date.parse(body.created_at))
  ) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_created_at'
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return res.status(503).json({
      ok: false,
      error: 'report_storage_not_configured'
    });
  }

  const hash = crypto
    .createHash('sha256')
    .update(raw)
    .digest('hex');

  const versions = [
    ...new Set(
      body.results
        .map(r =>
          r && typeof r.backend_version === 'string'
            ? r.backend_version
            : null
        )
        .filter(Boolean)
    )
  ].slice(0, 20);

  const row = {
    payload_sha256: hash,
    report_created_at: body.created_at,
    page_url: typeof body.page_url === 'string'
      ? body.page_url.slice(0, 300)
      : null,
    runner_version: typeof body.runner_version === 'string'
      ? body.runner_version.slice(0, 100)
      : null,
    execution_mode: typeof body.execution_mode === 'string'
      ? body.execution_mode.slice(0, 40)
      : null,
    backend_versions: versions,
    summary: body.summary,
    report: body
  };

  try {
    const response = await fetch(
      url.replace(/\/$/, '') +
        '/rest/v1/kistefunn_test_reports?on_conflict=payload_sha256',
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=representation'
        },
        body: JSON.stringify(row)
      }
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(
        '[TESTLAB_REPORT_WRITE_FAILED]',
        response.status,
        detail.slice(0, 300)
      );

      return res.status(503).json({
        ok: false,
        error: 'report_storage_failed'
      });
    }

    const saved = await response.json().catch(() => []);

    return res.status(200).json({
      ok: true,
      duplicate: !Array.isArray(saved) || saved.length === 0,
      report_hash: hash.slice(0, 12)
    });
  } catch (e) {
    console.error(
      '[TESTLAB_REPORT_EXCEPTION]',
      String(e && e.message || e).slice(0, 200)
    );

    return res.status(503).json({
      ok: false,
      error: 'report_storage_unavailable'
    });
  }
};
