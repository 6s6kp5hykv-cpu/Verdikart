/*
 * KISTEFUNN DIAGNOSTICS API
 * Version: diag-v1
 *
 * GET  /api/diagnostics?limit=50
 * POST /api/diagnostics
 */

const { logDiagnostic } = require("./_diagnostics");

const DIAG_VERSION = "diag-v1";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const limit = Math.min(
      Math.max(parseInt(req.query?.limit || "50", 10) || 50, 1),
      200
    );

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        diagnostic_version: DIAG_VERSION,
        error: {
          code: "diagnostics_not_configured",
          message: "SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler.",
        },
      });
    }

    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/kistefunn_diagnostics?select=*&order=created_at.desc&limit=${limit}`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );

      const body = await response.text();

      if (!response.ok) {
        return res.status(502).json({
          ok: false,
          diagnostic_version: DIAG_VERSION,
          error: {
            code: "diagnostics_read_failed",
            message: body.slice(0, 1000),
          },
        });
      }

      let rows = [];
      try {
        rows = JSON.parse(body);
      } catch {
        rows = [];
      }

      return res.status(200).json({
        ok: true,
        diagnostic_version: DIAG_VERSION,
        count: rows.length,
        rows,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        diagnostic_version: DIAG_VERSION,
        error: {
          code: "diagnostics_exception",
          message: error?.message || String(error),
        },
      });
    }
  }

  if (req.method === "POST") {
    try {
      const body =
        typeof req.body === "string"
          ? JSON.parse(req.body || "{}")
          : req.body || {};

      const result = await logDiagnostic({
        ...body,
        backend_version: body.backend_version || "v14.18",
      });

      return res.status(200).json({
        ok: true,
        diagnostic_version: DIAG_VERSION,
        event_id: result.event_id,
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        diagnostic_version: DIAG_VERSION,
        error: {
          code: "diagnostics_bad_request",
          message: error?.message || String(error),
        },
      });
    }
  }

  res.setHeader("Allow", "GET, POST");

  return res.status(405).json({
    ok: false,
    diagnostic_version: DIAG_VERSION,
    error: {
      code: "method_not_allowed",
      message: "GET eller POST er tillatt.",
    },
  });
};

