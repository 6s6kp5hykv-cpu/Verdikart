export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, description } = req.body || {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({
        error: "Mangler bilde"
      });
    }

    if (!image.startsWith("data:image/")) {
      return res.status(400).json({
        error: "Ugyldig bildeformat"
      });
    }

    const userDescription =
      typeof description === "string"
        ? description.trim()
        : "";

    const contextText = userDescription
      ? `
Brukeren har også skrevet følgende informasjon om gjenstanden:

"${userDescription}"

Bruk dette som ekstra informasjon. Hvis opplysningene virker feil i forhold til bildet, skal du ikke stole blindt på dem.
`
      : `
Brukeren har ikke gitt noen ekstra informasjon om gjenstanden.
`;

    /*
     * ---------------------------------------------------------
     * 1. IDENTIFISER GJENSTANDEN MED OPENAI
     * ---------------------------------------------------------
     */

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `
Du er ekspert på identifisering og verdivurdering av gjenstander.

Identifiser gjenstanden på bildet så presist som mulig.

${contextText}

Vurder spesielt:

- merke
- modell
- produsent
- type gjenstand
- alder eller produksjonsperiode
- materiale
- spesielle kjennetegn
- eventuell samlerverdi
- tilstand dersom dette kan vurderes fra bildet

Gi et forsiktig og realistisk verdiestimat i norske kroner.

Du skal returnere TRE prisverdier:

1. estimated_value_nok
   Den mest sannsynlige markedsverdien.

2. low_value_nok
   En realistisk lav pris for samme eller tilsvarende gjenstand.

3. high_value_nok
   En realistisk høy pris for samme eller tilsvarende gjenstand.

Prisintervallet skal være realistisk for akkurat denne gjenstanden.

Ikke bruk ekstreme verdier uten tydelig grunnlag.

Hvis du er usikker på identifikasjonen, skal du være forsiktig med verdien.

VIKTIG:
Returner prisene som NUMERISKE VERDIER uten "kr", punktum eller mellomrom som tusenskiller.

Eksempel:

{
  "estimated_value_nok": 175,
  "low_value_nok": 100,
  "high_value_nok": 250
}

Lag også et presist eBay-søkeord som kan brukes til å finne tilsvarende gjenstander.

eBay-søket skal prioritere sikre opplysninger i denne rekkefølgen:
- merke
- modell
- modellnummer
- type
- viktig kjennetegn

Unngå unødvendige ord. Ikke bruk "old item", "rare" eller "valuable" med mindre dette faktisk er en del av identifikasjonen.

Returner KUN gyldig JSON:

{
  "name": "navn på gjenstanden",
  "description": "kort beskrivelse",
  "estimated_value_nok": 175,
  "low_value_nok": 100,
  "high_value_nok": 250,
  "confidence": "lav, middels eller høy",
  "condition": "kort vurdering av tilstanden",
  "item_info": {
    "brand": "merke eller ukjent",
    "model": "modell eller ukjent",
    "manufacturer": "produsent eller ukjent",
    "type": "type gjenstand",
    "year_or_period": "år eller periode eller ukjent",
    "material": "materiale eller ukjent",
    "serial_number": "serienummer hvis synlig, ellers ukjent",
    "identifying_features": ["viktig synlig kjennetegn"],
    "modifications": "synlige modifikasjoner eller ingen synlig",
    "condition_details": "detaljert tilstandsvurdering",
    "value_factors": ["konkret forhold som påvirker verdien"],
    "uncertainties": ["det som ikke kan bekreftes sikkert"]
  },
  "ebay_search_query": "kort presist eBay-søk"
}

Hvis du ikke kan identifisere gjenstanden sikkert, si det tydelig og bruk et forsiktig verdiestimat.
`
                },
                {
                  type: "input_image",
                  image_url: image,
                  detail: "high"
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const openaiError = data?.error || {};

      const requestId =
        response.headers.get("x-request-id") ||
        response.headers.get("request-id") ||
        null;

      console.error("OpenAI API error", {
        status: response.status,
        code: openaiError.code || null,
        type: openaiError.type || null,
        message: openaiError.message || null,
        requestId
      });

      return res.status(response.status || 500).json({
        error: openaiError.message || "OpenAI-feil",
        code: openaiError.code || null,
        type: openaiError.type || null,
        status: response.status || 500,
        request_id: requestId
      });
    }

    const text =
      data.output
        ?.find(item => item.type === "message")
        ?.content
        ?.find(item => item.type === "output_text")
        ?.text || "";

    if (!text) {
      return res.status(500).json({
        error: "AI returnerte ikke noe svar"
      });
    }

    /*
     * ---------------------------------------------------------
     * 2. LES JSON FRA AI
     * ---------------------------------------------------------
     */

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);

      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
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
        ebay_search_query: ""
      };
    }

    /*
     * ---------------------------------------------------------
     * 3. HJELPEFUNKSJONER OG ITEM INFO
     * ---------------------------------------------------------
     */

    if (!parsed.item_info || typeof parsed.item_info !== "object") {
      parsed.item_info = {};
    }

    const info = parsed.item_info;

    const infoText = (value, fallback = "Ukjent") => {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      return fallback;
    };

    const infoList = value => {
      if (Array.isArray(value)) {
        return value
          .filter(v => typeof v === "string" && v.trim())
          .map(v => v.trim());
      }

      if (typeof value === "string" && value.trim()) {
        return [value.trim()];
      }

      return [];
    };

    const itemInfo = {
      brand: infoText(info.brand),
      model: infoText(info.model),
      manufacturer: infoText(info.manufacturer),
      type: infoText(info.type, parsed.name || "Ukjent"),
      year_or_period: infoText(info.year_or_period),
      material: infoText(info.material),
      serial_number: infoText(info.serial_number),

      identifying_features:
        infoList(info.identifying_features),

      modifications:
        infoText(
          info.modifications,
          "Ingen sikre modifikasjoner bekreftet."
        ),

      condition_details:
        infoText(
          info.condition_details,
          parsed.condition ||
          "Tilstanden kan ikke vurderes sikkert fra bildene."
        ),

      value_factors:
        infoList(info.value_factors),

      uncertainties:
        infoList(info.uncertainties)
    };

    if (
      itemInfo.identifying_features.length === 0 &&
      typeof parsed.description === "string" &&
      parsed.description.trim()
    ) {
      itemInfo.identifying_features = [
        parsed.description.trim()
      ];
    }

    if (
      itemInfo.uncertainties.length === 0 &&
      String(parsed.confidence || "").toLowerCase() !== "høy"
    ) {
      itemInfo.uncertainties = [
        "Identifikasjonen er ikke helt sikker og bør kontrolleres mot bilder, merking og eventuelt serienummer."
      ];
    }

    if (itemInfo.value_factors.length === 0) {
      itemInfo.value_factors = [
        "Merke, modell, alder, tilstand, originalitet og dokumentert markedspris kan påvirke verdien."
      ];
    }

    function parseNok(value) {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }

      if (typeof value !== "string") {
        return null;
      }

      let textValue = value
        .toLowerCase()
        .replace(/kr/g, "")
        .trim();

      const rangeMatch = textValue.match(
        /(\d+(?:[.,]\d+)?)\s*(?:-|–|—|til)\s*(\d+(?:[.,]\d+)?)/i
      );

      if (rangeMatch) {
        const low = Number(
          rangeMatch[1].replace(",", ".")
        );

        const high = Number(
          rangeMatch[2].replace(",", ".")
        );

        if (
          Number.isFinite(low) &&
          Number.isFinite(high)
        ) {
          return Math.round((low + high) / 2);
        }
      }

      let cleaned = textValue
        .replace(/\s/g, "")
        .replace(/[^\d,.-]/g, "");

      if (
        cleaned.includes(",") &&
        cleaned.includes(".")
      ) {
        const lastComma = cleaned.lastIndexOf(",");
        const lastDot = cleaned.lastIndexOf(".");

        if (lastComma > lastDot) {
          cleaned = cleaned
            .replace(/\./g, "")
            .replace(",", ".");
        } else {
          cleaned = cleaned.replace(/,/g, "");
        }
      } else if (cleaned.includes(",")) {
        const parts = cleaned.split(",");

        if (
          parts.length === 2 &&
          parts[1].length <= 2
        ) {
          cleaned = parts[0] + "." + parts[1];
        } else {
          cleaned = parts.join("");
        }
      } else if (cleaned.includes(".")) {
        const parts = cleaned.split(".");

        if (
          parts.length === 2 &&
          parts[1].length <= 2
        ) {
          cleaned = parts[0] + "." + parts[1];
        } else {
          cleaned = parts.join("");
        }
      }

      const number = Number(cleaned);

      return Number.isFinite(number)
        ? number
        : null;
    }

    function median(values) {
      if (!values.length) return null;

      const sorted = [...values].sort(
        (a, b) => a - b
      );

      const middle = Math.floor(sorted.length / 2);

      if (sorted.length % 2 === 0) {
        return (
          sorted[middle - 1] +
          sorted[middle]
        ) / 2;
      }

      return sorted[middle];
    }

    function percentile(values, p) {
      if (!values.length) return null;

      const sorted = [...values].sort(
        (a, b) => a - b
      );

      const index = (sorted.length - 1) * p;
      const lower = Math.floor(index);
      const upper = Math.ceil(index);

      if (lower === upper) {
        return sorted[lower];
      }

      return (
        sorted[lower] +
        (sorted[upper] - sorted[lower]) *
        (index - lower)
      );
    }

    function removeOutliers(items) {
      if (items.length < 5) {
        return items;
      }

      const prices = items.map(item => item.nok);

      const q1 = percentile(prices, 0.25);
      const q3 = percentile(prices, 0.75);
      const iqr = q3 - q1;

      const minimum = q1 - 1.5 * iqr;
      const maximum = q3 + 1.5 * iqr;

      return items.filter(
        item =>
          item.nok >= minimum &&
          item.nok <= maximum
      );
    }

    function normalizeText(value) {
      return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9æøå]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function cleanSearchPart(value) {
      if (typeof value !== "string") return "";

      return value
        .replace(/["']/g, "")
        .replace(/[^\p{L}\p{N}\s./-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    /*
     * ---------------------------------------------------------
     * 4. LAG ET REALISTISK AI-PRIS
     * ---------------------------------------------------------
     */

    let aiEstimated = parseNok(
      parsed.estimated_value_nok
    );

    let aiLow = parseNok(
      parsed.low_value_nok
    );

    let aiHigh = parseNok(
      parsed.high_value_nok
    );

    if (!Number.isFinite(aiEstimated)) {
      if (
        Number.isFinite(aiLow) &&
        Number.isFinite(aiHigh)
      ) {
        aiEstimated = Math.round(
          (aiLow + aiHigh) / 2
        );
      }
    }

    if (Number.isFinite(aiEstimated)) {
      if (!Number.isFinite(aiLow)) {
        aiLow = Math.round(aiEstimated * 0.7);
      }

      if (!Number.isFinite(aiHigh)) {
        aiHigh = Math.round(aiEstimated * 1.3);
      }
    }

    if (
      Number.isFinite(aiEstimated) &&
      Number.isFinite(aiLow) &&
      aiLow > aiEstimated
    ) {
      aiLow = aiEstimated;
    }

    if (
      Number.isFinite(aiEstimated) &&
      Number.isFinite(aiHigh) &&
      aiHigh < aiEstimated
    ) {
      aiHigh = aiEstimated;
    }

    if (
      Number.isFinite(aiLow) &&
      Number.isFinite(aiHigh) &&
      Number.isFinite(aiEstimated)
    ) {
      aiEstimated = Math.min(
        Math.max(aiEstimated, aiLow),
        aiHigh
      );
    }

    /*
     * ---------------------------------------------------------
     * 5. eBAY-INTEGRASJON
     *
     * Vi gjør flere søk i stedet for å stole på ett svært
     * spesifikt søkeord.
     *
     * Eksempel:
     *   Fender Stratocaster
     *   Fender Stratocaster Mexico
     *   Fender Stratocaster Standard
     *   Fender Stratocaster black rosewood
     *
     * Søkeordene bygges automatisk fra AI-identifikasjonen.
     * ---------------------------------------------------------
     */

    let ebayToken = null;

    async function getEbayToken() {
      if (ebayToken) {
        return ebayToken;
      }

      const clientId = process.env.EBAY_CLIENT_ID;
      const clientSecret = process.env.EBAY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return null;
      }

      const credentials = Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString("base64");

      const tokenResponse = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
            "Authorization":
              `Basic ${credentials}`
          },
          body:
            "grant_type=client_credentials" +
            "&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
        }
      );

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        console.error("eBay OAuth error", {
          status: tokenResponse.status,
          message:
            tokenData?.error_description ||
            tokenData?.error ||
            null
        });

        return null;
      }

      ebayToken = tokenData.access_token || null;

      return ebayToken;
    }

    const exchangeRateCache = {};

    async function getExchangeRate(
      fromCurrency,
      toCurrency = "NOK"
    ) {
      if (fromCurrency === toCurrency) {
        return 1;
      }

      const key = `${fromCurrency}_${toCurrency}`;

      if (exchangeRateCache[key]) {
        return exchangeRateCache[key];
      }

      try {
        const response = await fetch(
          `https://api.frankfurter.app/latest?from=${encodeURIComponent(
            fromCurrency
          )}&to=${encodeURIComponent(
            toCurrency
          )}`
        );

        if (!response.ok) {
          return null;
        }

        const data = await response.json();

        const rate = data?.rates?.[toCurrency] || null;

        if (rate) {
          exchangeRateCache[key] = rate;
        }

        return rate;
      } catch {
        return null;
      }
    }

    function buildEbayQueries() {
      const queries = [];

      const addQuery = value => {
        const cleaned = cleanSearchPart(value);

        if (!cleaned) return;

        const normalized = normalizeText(cleaned);

        if (normalized.length < 2) return;

        if (
          !queries.some(
            q => normalizeText(q) === normalized
          )
        ) {
          queries.push(cleaned);
        }
      };

      const brand = cleanSearchPart(itemInfo.brand);
      const model = cleanSearchPart(itemInfo.model);
      const manufacturer = cleanSearchPart(
        itemInfo.manufacturer
      );
      const type = cleanSearchPart(itemInfo.type);
      const material = cleanSearchPart(itemInfo.material);
      const period = cleanSearchPart(
        itemInfo.year_or_period
      );
      const aiQuery = cleanSearchPart(
        parsed.ebay_search_query
      );
      const name = cleanSearchPart(parsed.name);

      // Førstevalg: AI sitt presise søk.
      addQuery(aiQuery);

      // Deretter bygges bredere søk automatisk.
      if (brand && model) {
        addQuery(`${brand} ${model}`);
      }

      if (brand && type) {
        addQuery(`${brand} ${type}`);
      }

      if (manufacturer && model && manufacturer !== brand) {
        addQuery(`${manufacturer} ${model}`);
      }

      if (brand && model && material) {
        addQuery(`${brand} ${model} ${material}`);
      }

      if (brand && model && period) {
        addQuery(`${brand} ${model} ${period}`);
      }

      // Navnet brukes bare som bredt reserve-søk.
      if (name) {
        addQuery(name);
      }

      // Begrens antall API-søk slik at appen ikke gjør unødvendig mange kall.
      return queries.slice(0, 5);
    }

    function calculateRelevance(
      title,
      queryParts
    ) {
      const normalizedTitle = normalizeText(title);

      if (!normalizedTitle) {
        return 0;
      }

      const tokens = queryParts
        .flatMap(part =>
          normalizeText(part)
            .split(" ")
            .filter(token => token.length >= 2)
        );

      if (!tokens.length) {
        return 0;
      }

      let matches = 0;

      for (const token of tokens) {
        if (normalizedTitle.includes(token)) {
          matches += 1;
        }
      }

      return matches / tokens.length;
    }

    async function searchEbaySingle(
      query,
      token
    ) {
      const url =
        "https://api.ebay.com" +
        "/buy/browse/v1/item_summary/search" +
        `?q=${encodeURIComponent(query)}` +
        "&limit=20";

      const ebayResponse = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE"
        }
      });

      const ebayData = await ebayResponse.json();

      if (!ebayResponse.ok) {
        return {
          ok: false,
          query,
          reason:
            ebayData?.errors?.[0]?.message ||
            "eBay-søk feilet",
          items: []
        };
      }

      return {
        ok: true,
        query,
        reason: null,
        items: Array.isArray(ebayData.itemSummaries)
          ? ebayData.itemSummaries
          : []
      };
    }

    async function searchEbayMultiple() {
      const queries = buildEbayQueries();

      if (!queries.length) {
        return {
          enabled: false,
          reason: "Ingen egnet eBay-søkestreng",
          queries: [],
          sample_size: 0,
          listings: []
        };
      }

      const token = await getEbayToken();

      if (!token) {
        return {
          enabled: false,
          reason:
            "eBay-tilkobling er ikke tilgjengelig",
          queries,
          sample_size: 0,
          listings: []
        };
      }

      /*
       * Kjør søkene parallelt.
       * Dette er raskere enn å vente på hvert søk etter tur.
       */
      const results = await Promise.all(
        queries.map(query =>
          searchEbaySingle(query, token).catch(() => ({
            ok: false,
            query,
            reason: "eBay-søk feilet",
            items: []
          }))
        )
      );

      const allItems = [];
      const seenIds = new Set();

      for (const result of results) {
        if (!result.ok) continue;

        const queryParts = result.query
          .split(/\s+/)
          .filter(Boolean);

        for (const item of result.items) {
          const itemId =
            item.itemId ||
            item.legacyItemId ||
            item.itemWebUrl ||
            `${item.title}-${item?.price?.value}`;

          if (seenIds.has(itemId)) {
            continue;
          }

          seenIds.add(itemId);

          const title = item.title || "";

          /*
           * Ikke ta med svært svake treff.
           * For et svært kort/bredt søk tillater vi litt lavere
           * relevans, men presise søk må faktisk ligne på varen.
           */
          const relevance = calculateRelevance(
            title,
            queryParts
          );

          const minimumRelevance =
            queryParts.length <= 2
              ? 0.50
              : 0.34;

          if (relevance < minimumRelevance) {
            continue;
          }

          const originalPrice =
            Number(item?.price?.value);

          const currency =
            item?.price?.currency;

          if (
            !Number.isFinite(originalPrice) ||
            !currency ||
            originalPrice <= 0
          ) {
            continue;
          }

          allItems.push({
            raw: item,
            query: result.query,
            relevance
          });
        }
      }

      if (!allItems.length) {
        return {
          enabled: true,
          marketplace: "EBAY_DE",
          queries,
          successful_queries:
            results
              .filter(result => result.ok)
              .map(result => result.query),
          sample_size: 0,
          listings: []
        };
      }

      /*
       * Konverter valuta.
       * Vi bruker cache slik at EUR/USD/GBP osv. ikke hentes
       * på nytt for hvert enkelt treff.
       */
      const prepared = [];

      for (const entry of allItems) {
        const item = entry.raw;

        const originalPrice =
          Number(item?.price?.value);

        const currency =
          item?.price?.currency;

        const rate =
          await getExchangeRate(
            currency,
            "NOK"
          );

        if (!rate) {
          continue;
        }

        const nok =
          originalPrice * rate;

        if (
          !Number.isFinite(nok) ||
          nok <= 0
        ) {
          continue;
        }

        prepared.push({
          id:
            item.itemId ||
            item.legacyItemId ||
            item.itemWebUrl ||
            "",

          title:
            item.title || "",

          price: {
            value: originalPrice,
            currency
          },

          nok:
            Math.round(nok),

          url:
            item.itemWebUrl || "",

          query:
            entry.query,

          relevance:
            Number(entry.relevance.toFixed(3))
        });
      }

      /*
       * Fjern de svakeste treffene når vi har mange resultater.
       * Dette gjør at et tilfeldig treff ikke får stor påvirkning.
       */
      prepared.sort(
        (a, b) =>
          b.relevance - a.relevance
      );

      let relevantItems = prepared;

      if (relevantItems.length > 12) {
        relevantItems =
          relevantItems.slice(0, 40);
      }

      const filtered =
        removeOutliers(relevantItems);

      const prices =
        filtered.map(item => item.nok);

      const medianNok =
        median(prices);

      const ebayLow =
        percentile(prices, 0.15);

      const ebayHigh =
        percentile(prices, 0.85);

      /*
       * Vis de mest relevante annonsene først.
       */
      const listings =
        [...filtered]
          .sort(
            (a, b) =>
              b.relevance - a.relevance
          )
          .slice(0, 12)
          .map(item => ({
            title: item.title,
            price: item.price,
            price_nok: item.nok,
            url: item.url,
            search_query: item.query,
            relevance: item.relevance
          }));

      return {
        enabled: true,
        marketplace: "EBAY_DE",
        queries,
        successful_queries:
          results
            .filter(result => result.ok)
            .map(result => result.query),

        sample_size:
          filtered.length,

        total_candidates:
          prepared.length,

        median_nok:
          Number.isFinite(medianNok)
            ? Math.round(medianNok)
            : null,

        low_nok:
          Number.isFinite(ebayLow)
            ? Math.round(ebayLow)
            : null,

        high_nok:
          Number.isFinite(ebayHigh)
            ? Math.round(ebayHigh)
            : null,

        listings
      };
    }

    /*
     * ---------------------------------------------------------
     * 6. KJØR FLERE eBAY-SØK
     * ---------------------------------------------------------
     */

    let ebay = {
      enabled: false,
      reason: "eBay-søk ikke utført",
      queries: [],
      sample_size: 0,
      listings: []
    };

    try {
      ebay = await searchEbayMultiple();
    } catch (error) {
      console.error("eBay search error", {
        message: error?.message || "Ukjent eBay-feil"
      });

      ebay = {
        enabled: false,
        reason:
          "eBay-søk kunne ikke gjennomføres",
        queries: buildEbayQueries(),
        sample_size: 0,
        listings: []
      };
    }

    /*
     * ---------------------------------------------------------
     * 7. KOMBINER AI + eBAY
     * ---------------------------------------------------------
     *
     * eBay-data skal hjelpe verdsettelsen, men ikke dominere når
     * det finnes få treff. Aktive annonsepriser er prisforlangende,
     * ikke dokumenterte salgspriser.
     *
     * 0 treff  = 100 % AI
     * 1 treff  = 85 % AI / 15 % eBay
     * 2 treff  = 75 % AI / 25 % eBay
     * 3-4     = 60 % AI / 40 % eBay
     * 5+      = 50 % AI / 50 % eBay
     * ---------------------------------------------------------
     */

    let finalEstimated = aiEstimated;
    let finalLow = aiLow;
    let finalHigh = aiHigh;
    let ebayWeight = 0;
    let valuationMethod =
      "AI-estimat uten eBay-grunnlag";

    const ebaySampleSize =
      ebay?.enabled &&
      Number.isFinite(
        Number(ebay.sample_size)
      )
        ? Number(ebay.sample_size)
        : 0;

    if (
      ebaySampleSize > 0 &&
      Number.isFinite(ebay.median_nok)
    ) {
      if (ebaySampleSize === 1) {
        ebayWeight = 0.15;
      } else if (ebaySampleSize === 2) {
        ebayWeight = 0.25;
      } else if (ebaySampleSize <= 4) {
        ebayWeight = 0.40;
      } else {
        ebayWeight = 0.50;
      }

      const aiWeight = 1 - ebayWeight;

      if (Number.isFinite(aiEstimated)) {
        finalEstimated = Math.round(
          aiEstimated * aiWeight +
          ebay.median_nok * ebayWeight
        );
      } else {
        finalEstimated =
          Math.round(ebay.median_nok);
      }

      if (
        Number.isFinite(aiLow) &&
        Number.isFinite(ebay.low_nok)
      ) {
        finalLow = Math.round(
          aiLow * aiWeight +
          ebay.low_nok * ebayWeight
        );
      } else if (
        Number.isFinite(ebay.low_nok)
      ) {
        finalLow =
          Math.round(ebay.low_nok);
      }

      if (
        Number.isFinite(aiHigh) &&
        Number.isFinite(ebay.high_nok)
      ) {
        finalHigh = Math.round(
          aiHigh * aiWeight +
          ebay.high_nok * ebayWeight
        );
      } else if (
        Number.isFinite(ebay.high_nok)
      ) {
        finalHigh =
          Math.round(ebay.high_nok);
      }

      valuationMethod =
        `AI + eBay-markedsdata (${Math.round(
          ebayWeight * 100
        )} % eBay-vekt, ${ebaySampleSize} relevante treff)`;
    }

    if (Number.isFinite(finalEstimated)) {
      if (!Number.isFinite(finalLow)) {
        finalLow =
          Math.round(finalEstimated * 0.7);
      }

      if (!Number.isFinite(finalHigh)) {
        finalHigh =
          Math.round(finalEstimated * 1.3);
      }

      if (finalLow > finalEstimated) {
        finalLow = finalEstimated;
      }

      if (finalHigh < finalEstimated) {
        finalHigh = finalEstimated;
      }
    }

    /*
     * ---------------------------------------------------------
     * 8. RETURNER ALT TIL APPEN
     * ---------------------------------------------------------
     */

    return res.status(200).json({
      name:
        parsed.name ||
        "Ukjent",

      description:
        parsed.description ||
        "",

      estimated_value_nok:
        Number.isFinite(finalEstimated)
          ? finalEstimated
          : null,

      low_value_nok:
        Number.isFinite(finalLow)
          ? finalLow
          : null,

      high_value_nok:
        Number.isFinite(finalHigh)
          ? finalHigh
          : null,

      ai_estimated_value_nok:
        Number.isFinite(aiEstimated)
          ? aiEstimated
          : null,

      ai_low_value_nok:
        Number.isFinite(aiLow)
          ? aiLow
          : null,

      ai_high_value_nok:
        Number.isFinite(aiHigh)
          ? aiHigh
          : null,

      confidence:
        parsed.confidence ||
        "lav",

      condition:
        parsed.condition ||
        "",

      brand:
        itemInfo.brand,

      model:
        itemInfo.model,

      manufacturer:
        itemInfo.manufacturer,

      type:
        itemInfo.type,

      year_or_period:
        itemInfo.year_or_period,

      material:
        itemInfo.material,

      serial_number:
        itemInfo.serial_number,

      identifying_features:
        itemInfo.identifying_features,

      modifications:
        itemInfo.modifications,

      condition_details:
        itemInfo.condition_details,

      value_factors:
        itemInfo.value_factors,

      uncertainties:
        itemInfo.uncertainties,

      item_info:
        itemInfo,

      ebay_search_query:
        parsed.ebay_search_query ||
        "",

      ebay:
        ebay,

      valuation_method:
        valuationMethod,

      ebay_weight_percent:
        Math.round(
          ebayWeight * 100
        )
    });

  } catch (e) {
    console.error("analyze.js error", e);

    return res.status(500).json({
      error:
        e.message ||
        "Ukjent feil"
    });
  }
}
