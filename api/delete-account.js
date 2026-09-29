const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL =
  'https://tiqwlxpclqqncykdwvjf.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_2lQgSsDQRbOO4DIg6pbDsg_5n1lfGKS';

/*
  Vercel-variabelen heter foreløpig
  SUPABASE_SERVICE_ROLE_KEY.

  Vi støtter også SUPABASE_SECRET_KEY hvis
  du senere velger å gi den det navnet.
*/
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;


function sendJson(res, status, body){

  return res
    .status(status)
    .json(body);

}


module.exports = async function handler(req, res){

  /*
    Bare POST er tillatt.
  */
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


  /*
    Kontroller at serveren har
    Supabase Secret Key.
  */
  if(!SUPABASE_SECRET_KEY){

    return sendJson(
      res,
      500,
      {
        error:
          'Serveren mangler Supabase Secret Key.'
      }
    );

  }


  /*
    Hent brukerens access-token
    fra Authorization-headeren.
  */
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

    /*
      VIKTIG:

      Brukerens JWT valideres direkte mot
      Supabase Auth.

      Publishable key brukes som API-key.
      Brukerens access-token brukes som
      Authorization Bearer-token.

      Dette skiller brukerinnloggingen fra
      den administrative Secret Key-en.
    */
    const authResponse =
      await fetch(
        SUPABASE_URL +
        '/auth/v1/user',
        {
          method: 'GET',

          headers: {
            'apikey':
              SUPABASE_PUBLISHABLE_KEY,

            'Authorization':
              'Bearer ' + accessToken
          }
        }
      );


    if(!authResponse.ok){

      let authError = {};

      try{

        authError =
          await authResponse.json();

      }
      catch(_){

        authError = {};

      }


      console.error(
        'Supabase Auth validation failed:',
        authResponse.status,
        authError
      );


      return sendJson(
        res,
        401,
        {
          error:
            'Innloggingen er ikke gyldig.'
        }
      );

    }


    const user =
      await authResponse.json();


    if(!user || !user.id){

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
      user.id;


    /*
      Opprett en separat admin-klient.

      Secret Key brukes KUN på serveren
      og aldri i nettleseren.
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


    /*
      Slett alle gjenstander
      tilhørende brukeren.
    */
    const {
      error: collectionError
    } =
      await adminClient
        .from('collection_items')
        .delete()
        .eq(
          'user_id',
          userId
        );


    if(collectionError){

      console.error(
        'collection_items delete:',
        collectionError
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


    /*
      Slett alle kjøpsønsker
      tilhørende brukeren.
    */
    const {
      error: wantedError
    } =
      await adminClient
        .from('wanted_items')
        .delete()
        .eq(
          'user_id',
          userId
        );


    if(wantedError){

      console.error(
        'wanted_items delete:',
        wantedError
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


    /*
      Til slutt slettes selve
      Supabase Auth-kontoen.
    */
    const {
      error: deleteUserError
    } =
      await adminClient
        .auth
        .admin
        .deleteUser(
          userId
        );


    if(deleteUserError){

      console.error(
        'auth.admin.deleteUser:',
        deleteUserError
      );

      return sendJson(
        res,
        500,
        {
          error:
            'Dataene ble behandlet, men selve kontoen kunne ikke slettes.'
        }
      );

    }


    /*
      Alt OK.
    */
    return sendJson(
      res,
      200,
      {
        success: true
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
          'Kunne ikke slette kontoen og alle dataene.'
      }
    );

  }

};
