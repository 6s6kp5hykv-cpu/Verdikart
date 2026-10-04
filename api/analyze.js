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

        IKKE skriv:

        "100-250 kr"

        og ikke skriv:

        "100 250"

        Hvis du bare kan anslå et prisintervall, skal du selv beregne en realistisk estimert verdi mellom lav og høy.

        Ikke finn på detaljer som ikke kan underbygges av bildet eller brukerens informasjon.

        Hvis flere identifikasjoner er mulige, velg den mest sannsynlige og forklar usikkerheten kort.

        Lag også ett KORT eBay-søkeord som kan brukes til å finne tilsvarende gjenstander.

        eBay-søket skal være produktorientert og normalt 2-4 korte deler, for eksempel:
        "Fender Stratocaster Mexico"
        eller "Sony Walkman WM-3".

        Bruk helst:
        - merke
        - modell
        - type
        - relevant modellnummer eller produksjonsvariant hvis sikkert

        IKKE skriv hele beskrivelsen inn i eBay-søket.
        IKKE bruk lange setninger, egenskaper eller tilstandsbeskrivelser.
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
      "ebay_search_query": "kort eBay-søk med 2-4 sikre søkeord"
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

            /*
             * ---------------------------------------------------------
             * 2B. INFORMASJON TIL "SE ALL INFORMASJON"
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

            async function searchEbaySingle(query) {
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
                "https://api.ebay.com" +
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
             * 6. KORTE eBAY-SØK
             * ---------------------------------------------------------
             *
             * AI kan lage lange beskrivelser. De skal ikke sendes direkte
             * til eBay. Vi bygger i stedet noen få korte, produktorienterte
             * søk fra merke, modell og type.
             * ---------------------------------------------------------
             */

            function cleanEbayTerm(value, maxWords = 3) {
              if (!value) return "";

              const stop = new Set([
                "sannsynligvis", "muligens", "trolig", "ukjent",
                "unknown", "eller", "med", "og", "av", "for",
                "fra", "som", "mulig", "antatt", "probably",
                "likely", "possibly", "treverk", "lakkert",
                "kropp", "gripebrett", "metallhardware",
                "plastplekterbrett", "plast", "condition",
                "excellent", "good", "very"
              ]);

              const words = String(value)
                .replace(/[\n\r\t,;:()\[\]{}"']/g, " ")
                .replace(/[\/|]+/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .split(" ")
                .map(word => word.replace(/[^\p{L}\p{N}.-]/gu, ""))
                .filter(Boolean)
                .filter(word => !stop.has(word.toLowerCase()));

              const unique = [];
              const seen = new Set();

              for (const word of words) {
                const key = word.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                unique.push(word);
                if (unique.length >= maxWords) break;
              }

              return unique.join(" " );
            }

            function buildEbayQueries(parsed) {
              const info = parsed?.item_info || {};

              // Only structured identification fields are used here.
              // The long AI description/search sentence is deliberately
              // NOT sent directly to eBay.
              const brand = cleanEbayTerm(info.brand, 1);
              const model = cleanEbayTerm(info.model, 3);
              const type = cleanEbayTerm(info.type, 2);
              const manufacturer = cleanEbayTerm(info.manufacturer, 1);

              const candidates = [];

              if (brand && model) candidates.push(`${brand} ${model}`);
              if (brand && type) candidates.push(`${brand} ${type}`);
              if (model && type) candidates.push(`${model} ${type}`);

              if (
                manufacturer &&
                model &&
                manufacturer.toLowerCase() !== brand.toLowerCase()
              ) {
                candidates.push(`${manufacturer} ${model}`);
              }

              if (model) candidates.push(model);

              const seen = new Set();
              const queries = [];

              for (const raw of candidates) {
                const q = cleanEbayTerm(raw, 4);
                if (!q || q.length < 3) continue;
                if (q.split(/\s+/).length > 4) continue;

                const key = q.toLowerCase();
                if (seen.has(key)) continue;

                seen.add(key);
                queries.push(q);
                if (queries.length >= 5) break;
              }

              return queries;
            }

            async function searchEbay(parsed) {
              const queries = buildEbayQueries(parsed);

              if (!queries.length) {
                return {
                  enabled: false,
                  reason: "Ingen egnet eBay-søkestreng",
                  queries: [],
                  successful_queries: []
                };
              }

              const results = await Promise.all(
                queries.map(async query => {
                  try {
                    return await searchEbaySingle(query);
                  } catch {
                    return {
                      enabled: false,
                      query,
                      sample_size: 0,
                      listings: []
                    };
                  }
                })
              );

              const successful = results
                .filter(r => r?.enabled && Number(r.sample_size) > 0)
                .map(r => r.query);

              const allListings = [];
              const seen = new Set();

              for (const result of results) {
                for (const item of result?.listings || []) {
                  const key = String(item.url || item.title || "")
                    .trim()
                    .toLowerCase();
                  if (!key || seen.has(key)) continue;
                  seen.add(key);
                  allListings.push({ ...item, query: result.query });
                }
              }

              const prices = allListings
                .map(item => Number(item.price_nok))
                .filter(Number.isFinite)
                .filter(value => value > 0);

              const filteredPriceItems = removeOutliers(
                allListings
                  .filter(item => Number.isFinite(Number(item.price_nok)) && Number(item.price_nok) > 0)
                  .map(item => ({ ...item, nok: Number(item.price_nok) }))
              );

              const filtered = filteredPriceItems.length
                ? filteredPriceItems
                : allListings.map(item => ({ ...item, nok: Number(item.price_nok) }));

              const finalPrices = filtered
                .map(item => Number(item.nok))
                .filter(Number.isFinite)
                .filter(value => value > 0);

              const medianNok = median(finalPrices);
              const ebayLow = percentile(finalPrices, 0.15);
              const ebayHigh = percentile(finalPrices, 0.85);

              return {
                enabled: true,
                marketplace: "EBAY_DE",
                query: queries[0],
                queries,
                successful_queries: successful,
                total_candidates: allListings.length,
                sample_size: filtered.length,
                median_nok: Number.isFinite(medianNok) ? Math.round(medianNok) : null,
                low_nok: Number.isFinite(ebayLow) ? Math.round(ebayLow) : null,
                high_nok: Number.isFinite(ebayHigh) ? Math.round(ebayHigh) : null,
                listings: filtered.slice(0, 12).map(item => ({
                  title: item.title,
                  price: item.price,
                  price_nok: item.nok,
                  url: item.url,
                  query: item.query
                }))
              };
            }

            /*
             * ---------------------------------------------------------
             * 7. KJØR eBAY-SØK
             * ---------------------------------------------------------
             */

            let ebay = {
              enabled: false,
              reason: "eBay-søk ikke utført"
            };

            try {
              ebay = await searchEbay(parsed);
            } catch {
              ebay = {
                enabled: false,
                reason: "eBay-søk kunne ikke gjennomføres",
                queries: [],
                successful_queries: []
              };
            }

            /*
             * ---------------------------------------------------------
             * 7. KOMBINER AI + eBAY
             * ---------------------------------------------------------
             *
             * eBay-data skal hjelpe verdsettelsen, men ikke dominere når
             * det finnes få treff. Aktive annonsepriser er tross alt
             * prisforlangende og ikke dokumenterte salgspriser.
             *
             * Vekting:
             * 0 treff  = 100 % AI
             * 1 treff  = 85 % AI / 15 % eBay
             * 2 treff  = 75 % AI / 25 % eBay
             * 3-4     = 60 % AI / 40 % eBay
             * 5+      = 50 % AI / 50 % eBay
             *
             * På denne måten vil ett enkelt eBay-treff påvirke estimatet
             * litt, mens mange sammenlignbare treff får større betydning.
             * ---------------------------------------------------------
             */

            let finalEstimated = aiEstimated;
            let finalLow = aiLow;
            let finalHigh = aiHigh;
            let ebayWeight = 0;
            let valuationMethod = "AI-estimat uten eBay-grunnlag";

            const ebaySampleSize =
              ebay?.enabled && Number.isFinite(Number(ebay.sample_size))
                ? Number(ebay.sample_size)
                : 0;

            if (ebaySampleSize > 0 && Number.isFinite(ebay.median_nok)) {
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
                finalEstimated = Math.round(ebay.median_nok);
              }

              // For ranges, blend AI's range with the eBay market range.
              // If eBay has only one or two listings, its range is treated
              // cautiously instead of replacing the AI range completely.
              if (Number.isFinite(aiLow) && Number.isFinite(ebay.low_nok)) {
                finalLow = Math.round(
                  aiLow * aiWeight +
                  ebay.low_nok * ebayWeight
                );
              } else if (Number.isFinite(ebay.low_nok)) {
                finalLow = Math.round(ebay.low_nok);
              }

              if (Number.isFinite(aiHigh) && Number.isFinite(ebay.high_nok)) {
                finalHigh = Math.round(
                  aiHigh * aiWeight +
                  ebay.high_nok * ebayWeight
                );
              } else if (Number.isFinite(ebay.high_nok)) {
                finalHigh = Math.round(ebay.high_nok);
              }

              valuationMethod =
                `AI + eBay-markedsdata (${Math.round(ebayWeight * 100)} % eBay-vekt, ${ebaySampleSize} treff)`;
            }

            // Keep the final range logically consistent.
            if (Number.isFinite(finalEstimated)) {
              if (!Number.isFinite(finalLow)) {
                finalLow = Math.round(finalEstimated * 0.7);
              }

              if (!Number.isFinite(finalHigh)) {
                finalHigh = Math.round(finalEstimated * 1.3);
              }

              if (finalLow > finalEstimated) {
                finalLow = finalEstimated;
              }

              if (finalHigh < finalEstimated) {
                finalHigh = finalEstimated;
              }
            }

            // Expose the method/weight so the frontend can explain why the
            // value changed when market references are available.

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
                Math.round(ebayWeight * 100)
            });

          } catch (e) {
            return res.status(500).json({
              error:
                e.message ||
                "Ukjent feil"
            });
          }
        }
