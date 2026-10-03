export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const { image, description = "" } = req.body || {};

    if (
      !image ||
      typeof image !== "string" ||
      !image.startsWith("data:image/")
    ) {
      return res.status(400).json({
        error: "Mangler eller ugyldig bilde"
      });
    }

    const context = String(description).trim();

    const prompt = `
Du er Kistefunn, ekspert på identifisering og verdivurdering av fysiske gjenstander.

Identifiser gjenstanden på bildet så presist som mulig.
Ikke finn på detaljer.

${
  context
    ? `Brukerens ekstra informasjon: "${context}"`
    : "Ingen ekstra informasjon fra brukeren."
}

Vurder:

- merke
- modell
- produsent
- type
- alder eller produksjonsperiode
- materiale
- spesielle kjennetegn
- eventuell samlerverdi
- synlig tilstand

Vær spesielt forsiktig dersom identifikasjonen er usikker.
Lav sikkerhet skal gi et forsiktig verdiestimat.

Returner KUN gyldig JSON med denne strukturen:

{
  "name": "navn",
  "description": "kort beskrivelse",
  "estimated_value_nok": 500,
  "low_value_nok": 150,
  "high_value_nok": 1200,
  "confidence": "lav",
  "condition": "kort tilstandsvurdering",
  "item_info": {
    "brand": "ukjent",
    "model": "ukjent",
    "manufacturer": "ukjent",
    "type": "type",
    "year_or_period": "ukjent",
    "material": "ukjent",
    "serial_number": "ukjent",
    "identifying_features": [
      "synlig kjennetegn"
    ],
    "modifications": "ingen sikre modifikasjoner",
    "condition_details": "detaljert tilstand",
    "value_factors": [
      "forhold som påvirker verdien"
    ],
    "uncertainties": [
      "det som ikke kan bekreftes"
    ]
  },
  "ebay_search_query": "3-8 presise søkeord"
}

Prisene skal være numeriske NOK-verdier uten "kr".

Hvis du ikke kan identifisere gjenstanden sikkert,
skal du si det tydelig og bruke et forsiktig verdiestimat.
`;

    // ---------------------------------------------------------
    // 1. OPENAI-ANALYSE
    // ---------------------------------------------------------

    const aiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization":
            `Bearer ${process.env.OPENAI_API_KEY}`
        },

        body: JSON.stringify({
          model: "gpt-5.6-luna",

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",
                  text: prompt
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

    const aiData = await aiResponse.json();

    if (!aiResponse.ok) {
      return res.status(500).json({
        error:
          aiData?.error?.message ||
          "OpenAI-feil"
      });
    }

    const text =
      aiData.output
        ?.find(x => x.type === "message")
        ?.content
        ?.find(x => x.type === "output_text")
        ?.text || "";

    if (!text) {
      return res.status(500).json({
        error: "AI returnerte ikke noe svar"
      });
    }

    // ---------------------------------------------------------
    // 2. LES JSON FRA AI
    // ---------------------------------------------------------

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
        confidence: "lav"
      };
    }

    // ---------------------------------------------------------
    // 3. INFORMASJON TIL FUNNRAPPORT
    // ---------------------------------------------------------

    const info =
      parsed.item_info &&
      typeof parsed.item_info === "object"
        ? parsed.item_info
        : {};

    const str = (
      value,
      fallback = "Ukjent"
    ) => {
      if (
        typeof value === "string" &&
        value.trim()
      ) {
        return value.trim();
      }

      return fallback;
    };

    const list = value => {
      if (Array.isArray(value)) {
        return value
          .filter(
            x =>
              typeof x === "string" &&
              x.trim()
          )
          .map(x => x.trim());
      }

      if (
        typeof value === "string" &&
        value.trim()
      ) {
        return [value.trim()];
      }

      return [];
    };

    const itemInfo = {
      brand:
        str(info.brand),

      model:
        str(info.model),

      manufacturer:
        str(info.manufacturer),

      type:
        str(
          info.type,
          parsed.name || "Ukjent"
        ),

      year_or_period:
        str(info.year_or_period),

      material:
        str(info.material),

      serial_number:
        str(info.serial_number),

      identifying_features:
        list(info.identifying_features),

      modifications:
        str(
          info.modifications,
          "Ingen sikre modifikasjoner bekreftet."
        ),

      condition_details:
        str(
          info.condition_details,
          str(
            parsed.condition,
            "Tilstanden kan ikke vurderes sikkert fra bildene."
          )
        ),

      value_factors:
        list(info.value_factors),

      uncertainties:
        list(info.uncertainties)
    };

    if (
      !itemInfo.identifying_features.length &&
      parsed.description
    ) {
      itemInfo.identifying_features = [
        String(parsed.description)
      ];
    }

    if (
      !itemInfo.uncertainties.length &&
      String(parsed.confidence).toLowerCase() !==
        "høy"
    ) {
      itemInfo.uncertainties = [
        "Identifikasjonen er ikke sikkert bekreftet.",
        "Merke, modell, signatur eller produksjonsår kan ikke fastslås sikkert fra tilgjengelig materiale."
      ];
    }

    // ---------------------------------------------------------
    // 4. HJELPEFUNKSJONER FOR PRIS
    // ---------------------------------------------------------

    const number = value => {
      if (
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        return value;
      }

      if (typeof value !== "string") {
        return null;
      }

      const cleaned =
        value
          .replace(/[^0-9,.-]/g, "")
          .replace(
            /\.(?=.*\.)/g,
            ""
          )
          .replace(",", ".");

      const n = Number(cleaned);

      return Number.isFinite(n)
        ? n
        : null;
    };

    const median = values => {
      if (!values.length) {
        return null;
      }

      const sorted =
        [...values].sort(
          (a, b) => a - b
        );

      const middle =
        Math.floor(
          sorted.length / 2
        );

      if (
        sorted.length % 2
      ) {
        return sorted[middle];
      }

      return (
        sorted[middle - 1] +
        sorted[middle]
      ) / 2;
    };

    const percentile = (
      values,
      p
    ) => {
      if (!values.length) {
        return null;
      }

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
    };

    const removeOutliers =
      items => {
        if (items.length < 5) {
          return items;
        }

        const prices =
          items.map(
            x => x.nok
          );

        const q1 =
          percentile(
            prices,
            0.25
          );

        const q3 =
          percentile(
            prices,
            0.75
          );

        const iqr =
          q3 - q1;

        return items.filter(
          x =>
            x.nok >=
              q1 - 1.5 * iqr &&
            x.nok <=
              q3 + 1.5 * iqr
        );
      };

    // ---------------------------------------------------------
    // 5. AI-VERDI
    // ---------------------------------------------------------

    let aiEstimated =
      number(
        parsed.estimated_value_nok
      );

    let aiLow =
      number(
        parsed.low_value_nok
      );

    let aiHigh =
      number(
        parsed.high_value_nok
      );

    if (
      !Number.isFinite(
        aiEstimated
      ) &&
      Number.isFinite(aiLow) &&
      Number.isFinite(aiHigh)
    ) {
      aiEstimated =
        Math.round(
          (aiLow + aiHigh) / 2
        );
    }

    if (
      Number.isFinite(
        aiEstimated
      )
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

      aiLow =
        Math.min(
          aiLow,
          aiEstimated
        );

      aiHigh =
        Math.max(
          aiHigh,
          aiEstimated
        );
    }

    // ---------------------------------------------------------
    // 6. eBAY TOKEN
    // ---------------------------------------------------------

    async function ebayToken() {
      const id =
        process.env.EBAY_CLIENT_ID;

      const secret =
        process.env.EBAY_CLIENT_SECRET;

      if (!id || !secret) {
        return null;
      }

      const auth =
        Buffer
          .from(
            `${id}:${secret}`
          )
          .toString("base64");

      const response =
        await fetch(
          "https://api.ebay.com/identity/v1/oauth2/token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",

              "Authorization":
                `Basic ${auth}`
            },

            body:
              "grant_type=client_credentials" +
              "&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        return null;
      }

      return (
        data.access_token ||
        null
      );
    }

    // ---------------------------------------------------------
    // 7. VALUTAKURS
    // ---------------------------------------------------------

    async function exchangeRate(
      from
    ) {
      if (
        !from ||
        from === "NOK"
      ) {
        return 1;
      }

      try {
        const response =
          await fetch(
            `https://api.frankfurter.app/latest?from=${encodeURIComponent(
              from
            )}&to=NOK`
          );

        const data =
          await response.json();

        if (!response.ok) {
          return null;
        }

        return (
          data?.rates?.NOK ||
          null
        );
      } catch {
        return null;
      }
    }

    // ---------------------------------------------------------
    // 8. eBAY-SØK
    // ---------------------------------------------------------

    async function searchEbay(
      query
    ) {
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
        await ebayToken();

      if (!token) {
        return {
          enabled: false,
          reason:
            "eBay-tilkobling er ikke tilgjengelig"
        };
      }

      const url =
        "https://api.ebay.com" +
        "/buy/browse/v1/item_summary/search" +
        `?q=${encodeURIComponent(
          query
        )}` +
        "&limit=20";

      const response =
        await fetch(
          url,
          {
            headers: {
              "Authorization":
                `Bearer ${token}`,

              "Accept":
                "application/json",

              "X-EBAY-C-MARKETPLACE-ID":
                "EBAY_DE"
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        return {
          enabled: false,
          reason:
            data?.errors?.[0]?.message ||
            "eBay-søk feilet"
        };
      }

      const raw =
        Array.isArray(
          data.itemSummaries
        )
          ? data.itemSummaries
          : [];

      const items = [];

      for (
        const item of raw
      ) {
        const value =
          Number(
            item?.price?.value
          );

        const currency =
          item?.price?.currency;

        if (
          !Number.isFinite(
            value
          ) ||
          !currency
        ) {
          continue;
        }

        const fx =
          await exchangeRate(
            currency
          );

        if (!fx) {
          continue;
        }

        const nok =
          value * fx;

        if (
          !Number.isFinite(nok) ||
          nok <= 0
        ) {
          continue;
        }

        items.push({
          title:
            item.title || "",

          price: {
            value,
            currency
          },

          nok:
            Math.round(nok),

          url:
            item.itemWebUrl || ""
        });
      }

      const clean =
        removeOutliers(
          items
        );

      const prices =
        clean.map(
          x => x.nok
        );

      return {
        enabled: true,

        marketplace:
          "EBAY_DE",

        query,

        sample_size:
          clean.length,

        median_nok:
          median(prices),

        low_nok:
          percentile(
            prices,
            0.15
          ),

        high_nok:
          percentile(
            prices,
            0.85
          ),

        listings:
          clean
            .slice(0, 10)
            .map(x => ({
              title:
                x.title,

              price:
                x.price,

              price_nok:
                x.nok,

              url:
                x.url
            }))
      };
    }

    // ---------------------------------------------------------
    // 9. KJØR eBAY
    // ---------------------------------------------------------

    let ebay;

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

    // ---------------------------------------------------------
    // 10. KOMBINER AI + eBAY
    // ---------------------------------------------------------

    let finalEstimated =
      aiEstimated;

    let finalLow =
      aiLow;

    let finalHigh =
      aiHigh;

    let ebayWeight = 0;

    let valuationMethod =
      "AI-estimat uten eBay-grunnlag";

    const sampleSize =
      ebay?.enabled
        ? Number(
            ebay.sample_size
          ) || 0
        : 0;

    if (
      sampleSize > 0 &&
      Number.isFinite(
        ebay.median_nok
      )
    ) {
      if (
        sampleSize === 1
      ) {
        ebayWeight = 0.15;
      } else if (
        sampleSize === 2
      ) {
        ebayWeight = 0.25;
      } else if (
        sampleSize <= 4
      ) {
        ebayWeight = 0.40;
      } else {
        ebayWeight = 0.50;
      }

      const aiWeight =
        1 - ebayWeight;

      if (
        Number.isFinite(
          aiEstimated
        )
      ) {
        finalEstimated =
          Math.round(
            aiEstimated *
              aiWeight +
            ebay.median_nok *
              ebayWeight
          );
      } else {
        finalEstimated =
          Math.round(
            ebay.median_nok
          );
      }

      if (
        Number.isFinite(aiLow) &&
        Number.isFinite(
          ebay.low_nok
        )
      ) {
        finalLow =
          Math.round(
            aiLow *
              aiWeight +
            ebay.low_nok *
              ebayWeight
          );
      } else if (
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
        Number.isFinite(aiHigh) &&
        Number.isFinite(
          ebay.high_nok
        )
      ) {
        finalHigh =
          Math.round(
            aiHigh *
              aiWeight +
            ebay.high_nok *
              ebayWeight
          );
      } else if (
        Number.isFinite(
          ebay.high_nok
        )
      ) {
        finalHigh =
          Math.round(
            ebay.high_nok
          );
      }

      valuationMethod =
        `AI + eBay-markedsdata (${Math.round(
          ebayWeight * 100
        )} % eBay-vekt, ${sampleSize} treff)`;
    }

    // ---------------------------------------------------------
    // 11. SØRG FOR LOGISK PRISINTERVALL
    // ---------------------------------------------------------

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

      finalLow =
        Math.min(
          finalLow,
          finalEstimated
        );

      finalHigh =
        Math.max(
          finalHigh,
          finalEstimated
        );
    }

    // ---------------------------------------------------------
    // 12. RETURNER ALT TIL KISTEFUNN
    // ---------------------------------------------------------

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
    console.error(e);

    return res.status(500).json({
      error:
        e?.message ||
        "Ukjent feil"
    });
  }
}
