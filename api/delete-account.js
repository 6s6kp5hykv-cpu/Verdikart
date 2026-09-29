const SUPABASE_URL =
  'https://tiqwlxpclqqncykdwvjf.supabase.co';

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;


/* ========================= */
/* JSON-SVAR */
/* ========================= */

function sendJson(res, status, body){
  return res.status(status).json(body);
}


/* ========================= */
/* SUPABASE REQUEST */
/* ========================= */

async function supabaseRequest(path, options = {}){

  const response = await fetch(
    SUPABASE_URL + path,
    {
      ...options,

      headers:{
        ...(options.headers || {}),

        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          'Bearer ' +
          SUPABASE_SERVICE_ROLE_KEY,

        'Content-Type':
          'application/json'
      }
    }
  );

  const text =
    await response.text();

  let data = null;

  try{
    data = text
      ? JSON.parse(text)
      : null;
  }
  catch(_){
    data = text;
  }

  return {
    response,
    data
  };
}


/* ========================= */
/* DELETE ACCOUNT */
/* ========================= */

module.exports = async function handler(req, res){

  /* Kun POST */
  if(req.method !== 'POST'){

    res.setHeader(
      'Allow',
      'POST'
    );

    return sendJson(
      res,
      405,
      {
        error:
          'Metoden er ikke tillatt.'
      }
    );
  }


  /* Kontroller servernøkkel */

  if(!SUPABASE_SERVICE_ROLE_KEY){

    return sendJson(
      res,
      500,
      {
        error:
          'Serveren mangler SUPABASE_SERVICE_ROLE_KEY.'
      }
    );
  }


  /* Hent brukerens token */

  const authorization =
    req.headers.authorization || '';

  const match =
    authorization.match(
      /^Bearer\s+(.+)$/i
    );


  if(!match){

    return sendJson(
      res,
      401,
      {
        error:
          'Mangler innloggingstoken.'
      }
    );
  }


  const accessToken =
    match[1];


  try{

    /* ========================= */
    /* 1. KONTROLLER INNLOGGING */
    /* ========================= */

    const userResult =
      await supabaseRequest(
        '/auth/v1/user',
        {
          method:'GET',

          headers:{
            Authorization:
              'Bearer ' +
              accessToken
          }
        }
      );


    if(
      !userResult.response.ok ||
      !userResult.data ||
      !userResult.data.id
    ){

      return sendJson(
        res,
        401,
        {
          error:
            'Innloggingen er ikke gyldig.'
        }
      );
    }


    const userId =
      userResult.data.id;


    /* ========================= */
    /* 2. SLETT SAMLING */
    /* ========================= */

    const collectionResult =
      await supabaseRequest(
        '/rest/v1/collection_items?user_id=eq.' +
        encodeURIComponent(userId),
        {
          method:'DELETE',

          headers:{
            Prefer:
              'return=minimal'
          }
        }
      );


    if(!collectionResult.response.ok){

      console.error(
        'collection_items:',
        collectionResult.data
      );

      return sendJson(
        res,
        500,
        {
          error:
            'Kunne ikke slette samlingen.'
        }
      );
    }


    /* ========================= */
    /* 3. SLETT KJØPSØNSKER */
    /* ========================= */

    const wantedResult =
      await supabaseRequest(
        '/rest/v1/wanted_items?user_id=eq.' +
        encodeURIComponent(userId),
        {
          method:'DELETE',

          headers:{
            Prefer:
              'return=minimal'
          }
        }
      );


    if(!wantedResult.response.ok){

      console.error(
        'wanted_items:',
        wantedResult.data
      );

      return sendJson(
        res,
        500,
        {
          error:
            'Kunne ikke slette kjøpsønskene.'
        }
      );
    }


    /* ========================= */
    /* 4. SLETT BRUKERKONTO */
    /* ========================= */

    const deleteUserResult =
      await supabaseRequest(
        '/auth/v1/admin/users/' +
        encodeURIComponent(userId),
        {
          method:'DELETE'
        }
      );


    if(!deleteUserResult.response.ok){

      console.error(
        'delete user:',
        deleteUserResult.data
      );

      return sendJson(
        res,
        500,
        {
          error:
            'Kunne ikke slette brukerkontoen.'
        }
      );
    }


    /* ========================= */
    /* FERDIG */
    /* ========================= */

    return sendJson(
      res,
      200,
      {
        success:true,
        message:
          'Kontoen og alle dataene er slettet.'
      }
    );


  }
  catch(error){

    console.error(
      'delete-account:',
      error
    );

    return sendJson(
      res,
      500,
      {
        error:
          'Det oppstod en feil under sletting av kontoen.'
      }
    );
  }

};
