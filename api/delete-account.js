const SUPABASE_URL = 'https://tiqwlxpclqqncykdwvjf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, body) {
  res.status(status).json(body);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(
    SUPABASE_URL + path,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          'Bearer ' + SUPABASE_SERVICE_ROLE_KEY,
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = null;
  }

  return {
    response,
    data,
    text
  };
}

module.exports = async function handler(req, res) {

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return sendJson(res, 405, {
      error: 'Metoden er ikke tillatt.'
    });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return sendJson(res, 500, {
      error:
        'Serveren mangler SUPABASE_SERVICE_ROLE_KEY i Vercel.'
    });
  }

  const authorization =
    req.headers.authorization || '';

  const match =
    authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return sendJson(res, 401, {
      error: 'Mangler innloggingstoken.'
    });
  }

  const accessToken = match[1];

  try {

    // Finn brukeren fra innloggingstokenet
    const userResponse =
      await fetch(
        SUPABASE_URL + '/auth/v1/user',
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization:
              'Bearer ' + accessToken
          }
        }
      );

    const userText =
      await userResponse.text();

    let userData = null;

    try {
      userData =
        userText
          ? JSON.parse(userText)
          : null;
    } catch (_) {
      userData = null;
    }

    if (
      !userResponse.ok ||
      !userData?.id
    ) {
      return sendJson(res, 401, {
        error:
          'Innloggingen er ikke gyldig.'
      });
    }

    const userId = userData.id;

    // Slett samlingen
    const collection =
      await supabaseRequest(
        '/rest/v1/collection_items?user_id=eq.' +
        encodeURIComponent(userId),
        {
          method: 'DELETE',
          headers: {
            Prefer: 'return=minimal'
          }
        }
      );

    if (!collection.response.ok) {
      throw new Error(
        'collection_items: ' +
        collection.response.status +
        ' ' +
        collection.text
      );
    }

    // Slett kjøpsønskene
    const wanted =
      await supabaseRequest(
        '/rest/v1/wanted_items?user_id=eq.' +
        encodeURIComponent(userId),
        {
          method: 'DELETE',
          headers: {
            Prefer: 'return=minimal'
          }
        }
      );

    if (!wanted.response.ok) {
      throw new Error(
        'wanted_items: ' +
        wanted.response.status +
        ' ' +
        wanted.text
      );
    }

    // Slett selve brukerkontoen
    const deletedUser =
      await supabaseRequest(
        '/auth/v1/admin/users/' +
        encodeURIComponent(userId),
        {
          method: 'DELETE'
        }
      );

    if (!deletedUser.response.ok) {
      throw new Error(
        'auth user: ' +
        deletedUser.response.status +
        ' ' +
        deletedUser.text
      );
    }

    return sendJson(res, 200, {
      success: true
    });

  } catch (error) {

    console.error(
      'delete-account:',
      error
    );

    return sendJson(res, 500, {
      error:
        'Kunne ikke slette kontoen og alle dataene.',
      detail: error.message
    });
  }
};
