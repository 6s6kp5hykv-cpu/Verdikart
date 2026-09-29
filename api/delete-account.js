const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL =
  'https://tiqwlxpclqqncykdwvjf.supabase.co';

const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, body){
  return res.status(status).json(body);
}

module.exports = async function handler(req, res){

  if(req.method !== 'POST'){
    res.setHeader('Allow', 'POST');

    return sendJson(res, 405, {
      error: 'Metoden er ikke tillatt.'
    });
  }

  if(!SUPABASE_SECRET_KEY){
    return sendJson(res, 500, {
      error: 'Serveren mangler Supabase Secret Key.'
    });
  }

  const authorization =
    req.headers.authorization || '';

  const match =
    authorization.match(/^Bearer\s+(.+)$/i);

  if(!match){
    return sendJson(res, 401, {
      error: 'Mangler innloggingstoken.'
    });
  }

  const accessToken = match[1];

  try{

    /*
     * Valider brukerens access-token mot Supabase Auth.
     *
     * Viktig:
     * Secret Key brukes som API-nøkkel i "apikey".
     * Brukerens access-token brukes separat i
     * "Authorization: Bearer ...".
     */

    const authResponse =
      await fetch(
        SUPABASE_URL + '/auth/v1/user',
        {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_SECRET_KEY,
            'Authorization': 'Bearer ' + accessToken
          }
        }
      );

    if(!authResponse.ok){

      let authError = {};

      try{
        authError = await authResponse.json();
      }
      catch(_){
        authError = {};
      }

      console.error(
        'Supabase Auth validation failed:',
        authResponse.status,
        authError
      );

      return sendJson(res, 401, {
        error: 'Innloggingen kunne ikke godkjennes.',
        status: authResponse.status,
        supabase_error:
          authError?.message ||
          authError?.error_description ||
          authError?.error ||
          'Ukjent Supabase-feil.'
      });
    }

    const user = await authResponse.json();

    if(!user || !user.id){
      return sendJson(res, 401, {
        error: 'Supabase returnerte ingen gyldig bruker.'
      });
    }

    const userId = user.id;

    /*
     * Admin-klient.
     * Secret Key skal kun brukes på serveren.
     */

    const adminClient =
      createClient(
        SUPABASE_URL,
        SUPABASE_SECRET_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false
          }
        }
      );

    const { error: collectionError } =
      await adminClient
        .from('collection_items')
        .delete()
        .eq('user_id', userId);

    if(collectionError){
      console.error(
        'collection_items delete:',
        collectionError
      );

      return sendJson(res, 500, {
        error: 'Kunne ikke slette samlingen.',
        details: collectionError.message
      });
    }

    const { error: wantedError } =
      await adminClient
        .from('wanted_items')
        .delete()
        .eq('user_id', userId);

    if(wantedError){
      console.error(
        'wanted_items delete:',
        wantedError
      );

      return sendJson(res, 500, {
        error: 'Kunne ikke slette kjøpsønskene.',
        details: wantedError.message
      });
    }

    const { error: deleteUserError } =
      await adminClient.auth.admin.deleteUser(userId);

    if(deleteUserError){
      console.error(
        'auth.admin.deleteUser:',
        deleteUserError
      );

      return sendJson(res, 500, {
        error:
          'Dataene ble behandlet, men selve kontoen kunne ikke slettes.',
        details: deleteUserError.message
      });
    }

    return sendJson(res, 200, {
      success: true
    });

  }
  catch(error){

    console.error(
      'delete-account:',
      error
    );

    return sendJson(res, 500, {
      error: 'Serverfeil ved sletting av kontoen.',
      details: error?.message || String(error)
    });
  }
};
