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
          model: "gpt-5.6-luna",
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

IKKE skriv:

"100-250 kr"

og ikke skriv:

"100 250"

Hvis du bare kan anslå et prisintervall, skal du selv beregne en realistisk estimert verdi mellom lav og høy.

Ikke finn på detaljer som ikke kan underbygges av bildet eller brukerens informasjon.

Hvis flere identifikasjoner er mulige, velg den mest sannsynlige og forklar usikkerheten kort.

Lag også et presist søkeord som kan brukes til å finne tilsvarende gjenstander på eBay.

eBay-søket skal helst inneholde:
- merke
- modell
- type
- relevant modellnummer
- relevante kjennetegn

Ikke bruk generelle ord som "old item" dersom en mer presis identifikasjon er mulig.

Returner KUN gyldig JSON:

{
  "name": "navn på gjenstanden",
  "description": "kort beskrivelse",
  "estimated_value_nok": 175,
  "low_value_nok": 100,
  "high_value_nok": 250,
  "confidence": "lav, middels eller høy",
  "condition": "kort vurdering av tilstanden",
  "ebay_search_query": "presist eBay-søk"
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
      return res.status(500).json({
        error: data?.error?.message || "OpenAI-feil"
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
     * 3. HJELPEFUNKSJONER
     * ---------------------------------------------------------
     */

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

      /*
       * Finn prisintervall som:
       * 100-250
       * 100 – 250
       * 100–250
       * 100 til 250
       */

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

      /*
       * Vanlig tallverdi.
       */

      let cleaned = textValue
        .replace(/\s/g, "")
        .replace(/[^\d,.-]/g, "");

      /*
       * Norsk/desimal håndtering.
       */

      if (
        cleaned.includes(",") &&
        cleaned.includes(".")
      ) {
        const lastComma =
          cleaned.lastIndexOf(",");

        const lastDot =
          cleaned.lastIndexOf(".");

        if (lastComma > lastDot) {
          cleaned = cleaned
            .replace(/\./g, "")
            .replace(",", ".");
        } else {
          cleaned = cleaned.replace(/,/g, "");
        }
      } else if (cleaned.includes(",")) {
        const parts = cleaned.split(",");

        /*
         * 1,5 = 1.5
         * 1,250 = 1250
         */

        if (
          parts.length === 2 &&
          parts[1].length <= 2
        ) {
          cleaned = parts[0] + "." + parts[1];
        } else {
          cleaned = parts.join("");
        }
      } else if (
        cleaned.includes(".")
      ) {
        const parts = cleaned.split(".");

        /*
         * 1.5 = 1.5
         * 1.250 = 1250
         */

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

      const sorted =
        [...values].sort(
          (a, b) => a - b
        );

      const middle =
        Math.floor(sorted.length / 2);

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

      const sorted =
        [...values].sort(
          (a, b) => a - b
        );

      const index =
        (sorted.length - 1) * p;

      const lower =
        Math.floor(index);

      const upper =
        Math.ceil(index);

      if (lower === upper) {
        return sorted[lower];
      }

      return (
        sorted[lower] +
        (sorted[upper] -
          sorted[lower]) *
          (index - lower)
      );
    }

    function removeOutliers(items) {
      if (items.length < 5) {
        return items;
      }

      const prices =
        items.map(item => item.nok);

      const q1 =
        percentile(prices, 0.25);

      const q3 =
        percentile(prices, 0.75);

      const iqr = q3 - q1;

      const minimum =
        q1 - 1.5 * iqr;

      const maximum =
        q3 + 1.5 * iqr;

      return items.filter(
        item =>
          item.nok >= minimum &&
          item.nok <= maximum
      );
    }

    /*
     * ---------------------------------------------------------
     * 4. LAG ET REALISTISK AI-PRIS
     * ---------------------------------------------------------
     */

    let aiEstimated =
      parseNok(
        parsed.estimated_value_nok
      );

    let aiLow =
      parseNok(
        parsed.low_value_nok
      );

    let aiHigh =
      parseNok(
        parsed.high_value_nok
      );

    /*
     * Hvis AI bare har gitt én verdi,
     * lager vi et forsiktig intervall.
     */

    if (
      !Number.isFinite(aiEstimated)
    ) {
      if (
        Number.isFinite(aiLow) &&
        Number.isFinite(aiHigh)
      ) {
        aiEstimated =
          Math.round(
            (aiLow + aiHigh) / 2
          );
      }
    }

    if (
      Number.isFinite(aiEstimated)
    ) {
      if (
        !Number.isFinite(aiLow)
      ) {
        aiLow =
          Math.round(
            aiEstimated * 0.7
          );
      }

      if (
        !Number.isFinite(aiHigh)
      ) {
        aiHigh =
          Math.round(
            aiEstimated * 1.3
          );
      }
    }

    /*
     * Sørg for riktig rekkefølge:
     *
     * lav <= estimert <= høy
     */

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

    /*
     * Hvis lav og høy finnes,
     * men estimert ligger utenfor,
     * legg estimert mellom dem.
     */

    if (
      Number.isFinite(aiLow) &&
      Number.isFinite(aiHigh) &&
      Number.isFinite(aiEstimated)
    ) {
      aiEstimated =
        Math.min(
          Math.max(
            aiEstimated,
            aiLow
          ),
          aiHigh
        );
    }

    /*
     * ---------------------------------------------------------
     * 5. eBAY-INTEGRASJON
     * ---------------------------------------------------------
     */

    async function getEbayToken() {
      const clientId =
        process.env.EBAY_CLIENT_ID;

      const clientSecret =
        process.env.EBAY_CLIENT_SECRET;

      if (
        !clientId ||
        !clientSecret
      ) {
        return null;
      }

      const credentials =
        Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64");

      const tokenResponse =
        await fetch(
          "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
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

      const tokenData =
        await tokenResponse.json();

      if (!tokenResponse.ok) {
        return null;
      }

      return (
        tokenData.access_token ||
        null
      );
    }

    async function getExchangeRate(
      fromCurrency,
      toCurrency = "NOK"
    ) {
      if (
        fromCurrency === toCurrency
      ) {
        return 1;
      }

      try {
        const response =
          await fetch(
            `https://api.frankfurter.app/latest?from=${encodeURIComponent(
              fromCurrency
            )}&to=${encodeURIComponent(
              toCurrency
            )}`
          );

        if (!response.ok) {
          return null;
        }

        const data =
          await response.json();

        return (
          data?.rates?.[toCurrency] ||
          null
        );
      } catch {
        return null;
      }
    }

    async function searchEbay(query) {
      if (
        !query ||
        query.trim().length < 2
      ) {
        return {
          enabled: false,
          reason:
            "Ingen egnet eBay-søkestreng"
        };
      }

      const token =
        await getEbayToken();

      if (!token) {
        return {
          enabled: false,
          reason:
            "eBay-tilkobling er ikke tilgjengelig"
        };
      }

      const url =
        "https://api.sandbox.ebay.com" +
        "/buy/browse/v1/item_summary/search" +
        `?q=${encodeURIComponent(query)}` +
        "&limit=20";

      const ebayResponse =
        await fetch(url, {
          method: "GET",
          headers: {
            "Authorization":
              `Bearer ${token}`,
            "Accept":
              "application/json",
            "X-EBAY-C-MARKETPLACE-ID":
              "EBAY_DE"
          }
        });

      const ebayData =
        await ebayResponse.json();

      if (!ebayResponse.ok) {
        return {
          enabled: false,
          reason:
            ebayData?.errors?.[0]?.message ||
            "eBay-søk feilet"
        };
      }

      const rawItems =
        Array.isArray(
          ebayData.itemSummaries
        )
          ? ebayData.itemSummaries
          : [];

      if (!rawItems.length) {
        return {
          enabled: true,
          marketplace:
            "EBAY_DE",
          query,
          sample_size: 0,
          listings: []
        };
      }

      const prepared = [];

      /*
       * Hent priser.
       */

      for (
        const item of rawItems
      ) {
        const originalPrice =
          Number(
            item?.price?.value
          );

        const currency =
          item?.price?.currency;

        if (
          !Number.isFinite(
            originalPrice
          ) ||
          !currency
        ) {
          continue;
        }

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
          title:
            item.title || "",

          price: {
            value:
              originalPrice,
            currency
          },

          nok:
            Math.round(nok),

          url:
            item.itemWebUrl || ""
        });
      }

      const filtered =
        removeOutliers(
          prepared
        );

      const prices =
        filtered.map(
          item => item.nok
        );

      const medianNok =
        median(prices);

      /*
       * Bruk robuste prosentiler i stedet
       * for absolutt laveste/høyeste.
       */

      const ebayLow =
        percentile(
          prices,
          0.15
        );

      const ebayHigh =
        percentile(
          prices,
          0.85
        );

      return {
        enabled: true,

        marketplace:
          "EBAY_DE",

        query,

        sample_size:
          filtered.length,

        median_nok:
          Number.isFinite(
            medianNok
          )
            ? Math.round(
                medianNok
              )
            : null,

        low_nok:
          Number.isFinite(
            ebayLow
          )
            ? Math.round(
                ebayLow
              )
            : null,

        high_nok:
          Number.isFinite(
            ebayHigh
          )
            ? Math.round(
                ebayHigh
              )
            : null,

        listings:
          filtered
            .slice(0, 10)
            .map(item => ({
              title:
                item.title,

              price:
                item.price,

              price_nok:
                item.nok,

              url:
                item.url
            }))
      };
    }

    /*
     * ---------------------------------------------------------
     * 6. KJØR eBAY-SØK
     * ---------------------------------------------------------
     */

    let ebay = {
      enabled: false,
      reason:
        "eBay-søk ikke utført"
    };

    try {
      ebay =
        await searchEbay(
          parsed.ebay_search_query ||
          parsed.name ||
          ""
        );
    } catch {
      ebay = {
        enabled: false,
        reason:
          "eBay-søk kunne ikke gjennomføres"
      };
    }

    /*
     * ---------------------------------------------------------
     * 7. KOMBINER AI + eBAY
     * ---------------------------------------------------------
     */

    let finalEstimated =
      aiEstimated;

    let finalLow =
      aiLow;

    let finalHigh =
      aiHigh;

    /*
     * eBay brukes bare dersom vi har
     * minst 3 relevante annonser.
     */

    if (
      ebay.enabled &&
      ebay.sample_size >= 3 &&
      Number.isFinite(
        ebay.median_nok
      )
    ) {
      if (
        Number.isFinite(
          aiEstimated
        )
      ) {
        finalEstimated =
          Math.round(
            aiEstimated * 0.5 +
            ebay.median_nok * 0.5
          );
      } else {
        finalEstimated =
          Math.round(
            ebay.median_nok
          );
      }

      if (
        Number.isFinite(
          ebay.low_nok
        )
      ) {
        finalLow =
          Math.round(
            ebay.low_nok
          );
      }

      if (
        Number.isFinite(
          ebay.high_nok
        )
      ) {
        finalHigh =
          Math.round(
            ebay.high_nok
          );
      }
    }

    /*
     * Sørg for at sluttverdiene
     * alltid har riktig rekkefølge.
     */

    if (
      Number.isFinite(
        finalEstimated
      )
    ) {
      if (
        !Number.isFinite(
          finalLow
        )
      ) {
        finalLow =
          Math.round(
            finalEstimated * 0.7
          );
      }

      if (
        !Number.isFinite(
          finalHigh
        )
      ) {
        finalHigh =
          Math.round(
            finalEstimated * 1.3
          );
      }

      if (
        finalLow >
        finalEstimated
      ) {
        finalLow =
          finalEstimated;
      }

      if (
        finalHigh <
        finalEstimated
      ) {
        finalHigh =
          finalEstimated;
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
        Number.isFinite(
          finalEstimated
        )
          ? finalEstimated
          : null,

      low_value_nok:
        Number.isFinite(
          finalLow
        )
          ? finalLow
          : null,

      high_value_nok:
        Number.isFinite(
          finalHigh
        )
          ? finalHigh
          : null,

      ai_estimated_value_nok:
        Number.isFinite(
          aiEstimated
        )
          ? aiEstimated
          : null,

      ai_low_value_nok:
        Number.isFinite(
          aiLow
        )
          ? aiLow
          : null,

      ai_high_value_nok:
        Number.isFinite(
          aiHigh
        )
          ? aiHigh
          : null,

      confidence:
        parsed.confidence ||
        "lav",

      condition:
        parsed.condition ||
        "",

      ebay_search_query:
        parsed.ebay_search_query ||
        "",

      ebay:
        ebay
    });

  } catch (e) {
    return res.status(500).json({
      error:
        e.message ||
        "Ukjent feil"
    });
  }
}
