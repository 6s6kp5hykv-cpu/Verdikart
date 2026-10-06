// Kistefunn OpenAI-identifikasjon v14.29
// V14.29: Kun diagnostikk av OpenAI latency/token-bruk. Ingen endring av prompt, modell, request eller identifikasjonslogikk.
// OpenAI-delen er flyttet fra v14.25 uten endring av prompt eller request-struktur.
// V14.27: Beholder SAFE v2-logikken, men eksponerer OpenAI error.code, error.type, status og request-id til backend-diagnostikken.

export async function identifyWithOpenAI({ image, userDescription }) {
  const contextText = userDescription
    ? `Brukeren har også skrevet følgende informasjon om gjenstanden:
"${userDescription}"
Bruk dette som et sterkt identifikasjonssignal. Hvis brukeren oppgir en konkret modell eller variant, skal dette brukes aktivt i identifikasjonen og markedssøket når bildet støtter samme merke og produktserie. Dette er spesielt viktig når flere modeller ser nesten identiske ut, som Haibike Trekking 4 og Trekking 6. Ikke avvis en brukerspesifikk modell bare fordi modellnummeret ikke kan leses i bildet. Hvis bildet viser et annet merke, en annen serie eller en tydelig annen variant, skal du markere konflikten i stedet for å gjette.`
    : "Brukeren har ikke gitt noen ekstra informasjon om gjenstanden.";

  const identificationStartedAt = performance.now();

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Du er ekspert på visuell identifisering og verdivurdering av fysiske gjenstander.

IDENTIFIKASJON SKAL VÆRE BEVISDREVET.

Ikke gjett merke eller modell bare fordi formen ligner et kjent produkt.

Før du bestemmer identiteten skal du aktivt lese og vurdere:
- synlig logo
- merkenavn
- modellnavn
- etiketter
- serienummer
- dekaler
- produksjonsmerking
- landmerking
- komponenter
- andre særpreg

Hvis et merkenavn er synlig på selve gjenstanden, skal dette veie tyngre enn generell form/silhuett.

${contextText}

FOR SYKLER:
Kontroller spesielt:
- merkenavn/logo på ramme
- modellnavn/dekal og eventuelle modellnummer
- motorprodusent
- motorplassering
- batteritype og plassering
- rammeform
- hjulstørrelse
- synlige komponenter
- eventuelt produksjonsår

Hvis brukeren skriver en konkret variant som "Haibike Trekking 4", skal du ikke bare svare "Haibike Trekking" dersom bildet er kompatibelt med brukerens opplysning. Bruk "Trekking 4" som modellidentitet for markedssøket, og oppgi at modellnummeret kommer fra brukerens tekst dersom det ikke kan leses på bildet.

FOR GITARER:
Kontroller spesielt:
- Fender/Gibson/etc. merke
- modellserie
- produksjonsland
- serienummer
- headstock
- logo
- bridge
- pickups
- kontrollplate
- kropp og hals
- dekaler
- synlige produksjonskoder

IKKE BLAND VARIANTER:
American Standard, American Professional, Player, Vintera, Squier, Classic Series osv. skal ikke behandles som samme modell bare fordi grunnmodellen ligner.

Hvis merke eller modell ikke kan bekreftes:
skriv "ukjent" der det faktisk er ukjent.

ÅR:
Oppgi konkret år bare når det finnes rimelig bevis fra serienummer, etikett, produksjonsmerking, dokumentasjon eller annen tydelig informasjon.
Hvis år ikke kan bekreftes, skriv "ukjent".
Ikke finn på et konkret år basert kun på utseende.

Gjør en intern kontroll før JSON:
1. Hvilket merke er faktisk synlig eller støttet?
2. Hvilken modell er faktisk støttet?
3. Finnes det en annen produsent/variant som bare ligner?
4. Stemmer brukerens tekst med bildet?
5. Kan år/produksjonsperiode faktisk dokumenteres?
6. Er dette komplett produkt eller bare del/tilbehør?

VERDIVURDERING:
Gi realistiske priser i norske kroner:
estimated_value_nok, low_value_nok, high_value_nok.

Prisene skal være NUMERISKE verdier uten "kr", punktum eller mellomrom som tusenskiller.

eBAY:
Lag et kort, produktorientert eBay-søk.
Bruk merke + modell + variant + land + år når dette er sikkert.

Eksempel:
"Fender Standard Stratocaster Mexico 1995"
"Haibike Trekking 4 e-bike"
"Sony Walkman WM-3"

Ikke skriv hele beskrivelsen inn i søket.

Returner KUN gyldig JSON:

{
  "name": "navn",
  "description": "kort beskrivelse",
  "estimated_value_nok": 175,
  "low_value_nok": 100,
  "high_value_nok": 250,
  "confidence": "lav, middels eller høy",
  "condition": "kort vurdering",
  "item_info": {
    "brand": "merke eller ukjent",
    "model": "modell eller ukjent",
    "manufacturer": "produsent eller ukjent",
    "type": "type",
    "year_or_period": "år/periode eller ukjent",
    "material": "materiale eller ukjent",
    "serial_number": "serienummer eller ukjent",
    "identifying_features": ["synlige kjennetegn"],
    "brand_evidence": "hva som støtter merkeidentifikasjonen",
    "model_evidence": "hva som støtter modellidentifikasjonen",
    "user_model_evidence": "eventuell konkret modell oppgitt av brukeren og om bildet støtter den",
    "identification_basis": "bilde, synlig merking, brukeropplysning eller kombinasjon",
    "modifications": "modifikasjoner eller ingen synlig",
    "condition_details": "detaljert tilstand",
    "value_factors": ["forhold som påvirker verdi"],
    "uncertainties": ["det som ikke kan bekreftes"]
  },
  "ebay_search_query": "kort presist produkt-søk"
}
`
          },
          {
            type: "input_image",
            image_url: image,
            detail: "high"
          }
        ]
      }]
    })
  });

  const requestId =
    response.headers.get("x-request-id") ||
    response.headers.get("x-openai-request-id") ||
    null;

  let data = null;
  let rawResponse = "";
  try {
    data = await response.json();
  } catch {
    try {
      rawResponse = await response.text();
    } catch {}
  }

  if (!response.ok) {
    const apiError = data?.error || {};
    const error = new Error(
      apiError.message ||
      rawResponse ||
      `OpenAI-feil (HTTP ${response.status})`
    );
    error.status = response.status;
    error.error_code = apiError.code || null;
    error.error_type = apiError.type || null;
    error.error_param = apiError.param || null;
    error.request_id = requestId;
    throw error;
  }

  const text =
    data.output
      ?.find(item => item.type === "message")
      ?.content
      ?.find(item => item.type === "output_text")
      ?.text || "";

  if (!text) {
    throw new Error("AI returnerte ikke noe svar");
  }

  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {}
    }
  }

  if (!parsed) {
    parsed = {
      name: "Ukjent",
      description: text,
      estimated_value_nok: null,
      low_value_nok: null,
      high_value_nok: null,
      confidence: "lav",
      condition: "",
      item_info: {},
      ebay_search_query: ""
    };
  }

  const usage = data?.usage || {};
  const inputTokens = Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null;
  const outputTokens = Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null;
  const totalTokens = Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : null;
  const cachedInputTokens = Number.isFinite(Number(usage.input_tokens_details?.cached_tokens))
    ? Number(usage.input_tokens_details.cached_tokens)
    : null;
  const reasoningTokens = Number.isFinite(Number(usage.output_tokens_details?.reasoning_tokens))
    ? Number(usage.output_tokens_details.reasoning_tokens)
    : null;

  return {
    parsed,
    duration_ms: Math.round(performance.now() - identificationStartedAt),
    openai_diagnostics: {
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cached_input_tokens: cachedInputTokens,
      reasoning_tokens: reasoningTokens,
      request_id: requestId
    }
  };
}
