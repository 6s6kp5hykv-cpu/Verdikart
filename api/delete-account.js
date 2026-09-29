export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const secretKey =
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !secretKey) {
      return res.status(500).json({
        error: "Supabase environment variables are missing."
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

    // Verify the currently logged-in user directly through Supabase Auth.
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

    // Delete the user's application data first.
    const tables = ["collection", "wants"];

    for (const table of tables) {
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
        const errorText = await deleteResponse.text();
        console.error(`Delete ${table} failed:`, errorText);

        // Continue so an absent/non-existing table does not prevent
        // the account deletion itself.
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
        details: errorText
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
      details: error.message
    });
  }
}
