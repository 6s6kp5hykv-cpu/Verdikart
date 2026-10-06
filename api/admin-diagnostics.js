/*
 * KISTEFUNN ADMIN DIAGNOSTICS
 * Version: v14.28
 *
 * Secure server-side admin gate for the in-app diagnostics panel.
 *
 * Required Vercel environment variables:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - ADMIN_EMAIL
 *
 * ADMIN_EMAIL must match the Supabase Auth email of the admin account.
 * The service role key is never exposed to the browser.
 */

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (!supabaseUrl || !serviceRoleKey || !adminEmail) {
    return res.status(500).json({
      error: "Admin diagnostics is not configured."
    });
  }

  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const accessToken = match ? match[1].trim() : "";

  if (!accessToken) {
    return res.status(401).json({
      error: "Missing authentication token."
    });
  }

  try {
    // Verify the user's access token with Supabase Auth.
    const userResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(401).json({
        error: "Invalid authentication session."
      });
    }

    const user = await userResponse.json();
    const email = String(user?.email || "")
      .trim()
      .toLowerCase();

    if (!email || email !== adminEmail) {
      return res.status(403).json({
        error: "Admin access required."
      });
    }

    // Read diagnostics only on the server with the service role.
    const query = new URLSearchParams({
      select:
        "id,created_at,event_id,level,stage,code,message,http_status,backend_version,model,request_id,image_count,duration_ms,metadata",
      order: "created_at.desc",
      limit: "50"
    });

    const diagnosticsResponse = await fetch(
      `${supabaseUrl}/rest/v1/kistefunn_diagnostics?${query.toString()}`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json"
        }
      }
    );

    if (!diagnosticsResponse.ok) {
      const text = await diagnosticsResponse.text();

      return res.status(502).json({
        error: "Could not read diagnostics.",
        detail: text.slice(0, 500)
      });
    }

    const rows = await diagnosticsResponse.json();

    return res.status(200).json({
      ok: true,
      admin_email: email,
      events: Array.isArray(rows) ? rows : []
    });
  } catch (error) {
    console.error("Admin diagnostics error:", error);

    return res.status(500).json({
      error: "Admin diagnostics failed."
    });
  }
}
