const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://tiqwlxpclqqncykdwvjf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, body){
  res.status(status).json(body);
}

module.exports = async function handler(req, res){

  if(req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, {
      error: 'Metoden er ikke tillatt.'
    });
  }

  if(!SUPABASE_SERVICE_ROLE_KEY){
    return sendJson(res, 500, {
      error: 'Serveren mangler Supabase-konfigurasjon.'
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

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  try{

    const {
      data: userData,
      error: userError
    } = await supabase.auth.getUser(accessToken);

    if(userError || !userData?.user){
      return sendJson(res, 401, {
        error: 'Innloggingen er ikke gyldig.'
      });
    }

    const userId = userData.user.id;

    const { error: collectionError } =
      await supabase
        .from('collection_items')
        .delete()
        .eq('user_id', userId);

    if(collectionError){
      throw collectionError;
    }

    const { error: wantedError } =
      await supabase
        .from('wanted_items')
        .delete()
        .eq('user_id', userId);

    if(wantedError){
      throw wantedError;
    }

    const { error: deleteUserError } =
      await supabase.auth.admin.deleteUser(userId);

    if(deleteUserError){
      throw deleteUserError;
    }

    return sendJson(res, 200, {
      success: true
    });

  }
  catch(error){

    console.error('delete-account:', error);

    return sendJson(res, 500, {
      error: 'Kunne ikke slette kontoen og alle dataene.'
    });
  }
};
