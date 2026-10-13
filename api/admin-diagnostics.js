import { sanitizeDiagnosticMetadata } from "./_diagnostics.js";
/*
 * KISTEFUNN ADMIN DIAGNOSTICS
 * Authenticated single-analysis report lookup.
 */
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const analysisRequestId = String(req.query?.analysis_request_id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(analysisRequestId)) {
    return res.status(400).json({ error: "A valid analysis_request_id is required." });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!supabaseUrl || !serviceRoleKey || !adminEmail) return res.status(500).json({ error: "Admin diagnostics is not configured." });
  const match = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  const accessToken = match ? match[1].trim() : "";
  if (!accessToken) return res.status(401).json({ error: "Missing authentication token." });
  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET", headers: { apikey: serviceRoleKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!userResponse.ok) return res.status(401).json({ error: "Invalid authentication session." });
    const user = await userResponse.json();
    const email = String(user?.email || "").trim().toLowerCase();
    if (!email || email !== adminEmail) return res.status(403).json({ error: "Admin access required." });
    const query = new URLSearchParams({
      select: "id,created_at,event_id,stage,code,http_status,backend_version,model,duration_ms,metadata",
      "metadata->>analysis_request_id": `eq.${analysisRequestId}`,
      stage: "eq.analysis_completed", code: "eq.analysis_completed", limit: "2"
    });
    const diagnosticsResponse = await fetch(`${supabaseUrl}/rest/v1/kistefunn_diagnostics?${query.toString()}`, {
      method: "GET", headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" }
    });
    if (!diagnosticsResponse.ok) return res.status(502).json({ error: "Could not read the requested diagnostic report." });
    const rows = await diagnosticsResponse.json();
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: "No diagnostic report found for that analysis ID." });
    if (rows.length !== 1) return res.status(409).json({ error: "Multiple reports found for that analysis ID." });
    const row = rows[0];
    const rawReport = row?.metadata?.analysis_report;
    const report = rawReport && typeof rawReport === "object" ? sanitizeDiagnosticMetadata(rawReport) : null;
    if (!report || report.analysis_request_id !== analysisRequestId) return res.status(404).json({ error: "No diagnostic report found for that analysis ID." });
    return res.status(200).json({ ok: true, report: {
      analysis_request_id: report.analysis_request_id,
      created_at: row.created_at || null, event_id: row.event_id || null,
      backend_version: row.backend_version || "unknown", report
    } });
  } catch (_) {
    console.error("ADMIN_DIAGNOSTICS_LOOKUP_FAILED");
    return res.status(500).json({ error: "Admin diagnostics lookup failed." });
  }
}
