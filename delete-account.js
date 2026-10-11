export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Kistefunn v15.5.33: align account deletion with current frontend tables and fail closed.
    // This is the public Supabase project URL.
    const supabaseUrl =
      "https://tiqwlxpclqqncykdwvjf.supabase.co";

    // Keep the Secret Key only in Vercel Environment Variables.
    const secretKey =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!secretKey) {
      return res.status(500).json({
        error: "Supabase Secret Key is missing in Vercel."
      });
    }

    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!accessToken) {
      return res.status(401).json({
        error: "Innloggingen er ikke gyldig."
      });
    }

    // Verify the logged-in user directly through Supabase Auth.
    const userResponse = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        method: "GET",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const userData = await userResponse.json();

    if (!userResponse.ok || !userData.id) {
      console.error("Auth verification failed:", userData);

      return res.status(401).json({
        error: "Innloggingen er ikke gyldig."
      });
    }

    const userId = userData.id;

    // Delete rows from the tables actually used by the current frontend.
    // Order child records before parent records to reduce foreign-key conflicts.
    // Fail closed: do not delete the Auth user if any data cleanup fails.
    const userTables = [
      "marketplace_listings",
      "value_history",
      "collection_items",
      "wanted_items"
    ];

    for (const table of userTables) {
      const deleteResponse = await fetch(
        `${supabaseUrl}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: {
            apikey: secretKey,
            Authorization: `Bearer ${secretKey}`,
            Prefer: "return=minimal"
          }
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text().catch(() => "");
        console.error(`Delete ${table} failed with HTTP ${deleteResponse.status}:`, errorText.slice(0, 300));
        return res.status(502).json({
          error: "Kunne ikke slette alle brukerdata. Kontoen er beholdt; prøv igjen eller kontakt support."
        });
      }
    }

    // Delete the Supabase Auth account.
    const deleteUserResponse = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`
        }
      }
    );

    if (!deleteUserResponse.ok) {
      const errorText = await deleteUserResponse.text();

      console.error("Auth account deletion failed:", errorText);

      return res.status(500).json({
        error: "Kunne ikke slette brukerkontoen.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Kontoen er slettet."
    });
  } catch (error) {
    console.error("Delete account error:", error);

    return res.status(500).json({
      error: "Serverfeil ved sletting av konto.",
    });
  }
}
