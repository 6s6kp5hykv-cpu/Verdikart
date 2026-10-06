// Kistefunn analysebackend v14.26
// V14.26: Strukturmodularisering. OpenAI-identifikasjon og eBay-engine flyttet til egne moduler. Logikken er ellers beholdt.
// V14.25: Intern tidsmåling for å finne flaskehalser i OpenAI, eBay, item-details, web-referanser og valutakonvertering.

import { identifyWithOpenAI } from "./openai.js";
import { createEbayEngine } from "./ebay.js";
import { parseNok, median } from "./valuation-utils.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const backendStartedAt = performance.now();
    const timings = {
      openai_identification_ms: null,
      ebay_oauth_ms: null,
      ebay_search_ms: null,
      ebay_item_details_ms: null,
      web_reference_openai_ms: null,
      frankfurter_fx_ms: 0,
      ebay_total_ms: null,
      market_processing_ms: null,
      total_backend_ms: null
    };

    let buy_opportunities = [];
    let priceInvestigations = [];
    const { image, description } = req.body || {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Mangler bilde" });
    }

    if (!image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Ugyldig bildeformat" });
    }

    const userDescription = typeof description === "string" ? description.trim() : "";

    /* ---------------------------------------------------------
       1. IDENTIFISER MED OPENAI
       --------------------------------------------------------- */

    let parsed;
    try {
      const aiResult = await identifyWithOpenAI({ image, userDescription });
      parsed = aiResult.parsed;
      timings.openai_identification_ms = aiResult.duration_ms;
    } catch (error) {
      return res.status(500).json({
        error: error?.message || "OpenAI-feil"
      });
    }

    /* ---------------------------------------------------------
       2. NORMALISER INFORMASJON
       --------------------------------------------------------- */

    if (!parsed.item_info || typeof parsed.item_info !== "object") {
      parsed.item_info = {};
    }

    parsed._user_description = userDescription;

    const info = parsed.item_info;

    const infoText = (value, fallback = "Ukjent") =>
      typeof value === "string" && value.trim()
        ? value.trim()
        : fallback;

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
      identifying_features: infoList(info.identifying_features),
      brand_evidence: infoText(info.brand_evidence),
      model_evidence: infoText(info.model_evidence),
      user_model_evidence: infoText(info.user_model_evidence, "Ingen konkret modellopplysning fra bruker."),
      identification_basis: infoText(info.identification_basis, "Bildeanalyse."),
      modifications: infoText(
        info.modifications,
        "Ingen sikre modifikasjoner bekreftet."
      ),
      condition_details: infoText(
        info.condition_details,
        parsed.condition || "Tilstanden kan ikke vurderes sikkert fra bildene."
      ),
      value_factors: infoList(info.value_factors),
      uncertainties: infoList(info.uncertainties)
    };

    if (!itemInfo.identifying_features.length && parsed.description) {
      itemInfo.identifying_features = [
        String(parsed.description).trim()
      ];
    }

    if (
      !itemInfo.uncertainties.length &&
      String(parsed.confidence || "").toLowerCase() !== "høy"
    ) {
      itemInfo.uncertainties = [
        "Identifikasjonen er ikke helt sikker og bør kontrolleres mot bilder, merking og eventuelt serienummer."
      ];
    }

    if (!itemInfo.value_factors.length) {
      itemInfo.value_factors = [
        "Merke, modell, alder, tilstand, originalitet og dokum      Number(item.nok) <= q3 + 1.5 * iqr
      );
    }

    /* ---------------------------------------------------------
       3. AI-VERDI
       --------------------------------------------------------- */

    let aiEstimated = parseNok(parsed.estimated_value_nok);
    let aiLow = parseNok(parsed.low_value_nok);
    let aiHigh = parseNok(parsed.high_value_nok);

    if (
      !Number.isFinite(aiEstimated) &&
      Number.isFinite(aiLow) &&
      Number.isFinite(aiHigh)
    ) {
      aiEstimated =
        Math.round((aiLow + aiHigh) / 2);
    }

    if (Number.isFinite(aiEstimated)) {
      if (!Number.isFinite(aiLow)) {
        aiLow = Math.round(aiEstimated * 0.7);
      }

      if (!Number.isFinite(aiHigh)) {
        aiHigh = Math.round(aiEstimated * 1.3);
      }

      aiLow = Math.min(aiLow, aiEstimated);
      aiHigh = Math.max(aiHigh, aiEstimated);
    }


    /* ---------------------------------------------------------
       4. eBAY ENGINE
       --------------------------------------------------------- */

    const ebayState = {
      buy_opportunities: [],
      priceInvestigations: []
    };

    const ebayEngine = createEbayEngine({
      parsed,
      itemInfo,
      timings,
      state: ebayState
    });

    let ebay = {
      enabled: false,
      reason: "eBay-søk ikke utført",
      queries: [],
      successful_queries: []
    };

    try {
      const ebayTotalStartedAt = performance.now();
      ebay = await ebayEngine.searchEbay(parsed);
      timings.ebay_total_ms = Math.round(performance.now() - ebayTotalStartedAt);
    } catch (error) {
      if (!Number.isFinite(timings.ebay_total_ms)) {
        timings.ebay_total_ms = null;
      }
      const diagnosticError = ebayEngine.getDiagnosticError();
      const message = error?.message || diagnosticError?.message || "Ukjent feil i eBay-søket.";
      ebay = {
        enabled: false,
        reason: String(message).slice(0, 300),
        diagnostic: diagnosticError
          ? { stage: diagnosticError.stage, status: diagnosticError.status, code: diagnosticError.code }
          : { stage: "search_exception", status: error?.status ?? null, code: error?.code || "search_exception" },
        queries: [],
        successful_queries: []
      };
    }

    buy_opportunities = ebayState.buy_opportunities;
    priceInvestigations = ebayState.priceInvestigations;

      const confirmedUserModel = String(ebay.filtering.user_model_text).trim();
      if (confirmedUserModel) {
        itemInfo.model = confirmedUserModel;
        itemInfo.user_model_evidence =
          `Brukeren oppga ${confirmedUserModel}. Bildet støtter merke/serie; modellvarianten er hentet fra brukerens opplysning.`;
        itemInfo.identification_basis =
          ebay.filtering.identification_basis || "Bilde + brukeroppgitt spesifikk modellvariant.";
        if (String(itemInfo.brand || "").toLowerCase() === "haibike" && String(itemInfo.type || "").toLowerCase().includes("sykkel")) {
          parsed.name = `${itemInfo.brand} ${confirmedUserModel} elsykkel`;
        }
        parsed.confidence = "høy";
      }
    }

    /* ---------------------------------------------------------
       7. MARKEDSMOTOR
       ---------------------------------------------------------
       V11.0 gjør markedsmotoren klar for flere markedsplasser.

       Prinsipp:
       - AI-estimat er alltid grunnlaget dersom det finnes.
       - eBay brukes som markedsreferanse når treffene er gode nok.
       - FINN er klargjort som egen kilde, men aktiveres først når
         Kistefunn har legitim FINN/API-tilgang.
       - Hver kilde kan få egen vekt og kvalitetspoeng.
       - Frontend beholder de gamle feltene for bakoverkompatibilitet.
       --------------------------------------------------------- */

    /*
     * V13.7 – EKSAKT REFERANSE WEB-FALLBACK
     * --------------------------------------
     * Hvis eBay ikke finner nok eksakte treff på en kjent modellreferanse,
     * bruker vi OpenAI Responses API + web_search for å finne aktuelle
     * markedsreferanser på andre nettsteder.
     *
     * Søket er låst til samme modellreferanse. Andre modeller skal ikke
     * brukes som prisgrunnlag.
     */
    async function searchExactReferenceWeb(referenceCode, brand, modelName) {
      /*
       * V13.9 – ROBUST WEB-REFERANSE-SØK
       * --------------------------------
       * Web-søket bruker nå Structured Outputs slik at resultatet faktisk
       * kommer tilbake som maskinlesbar JSON. Tidligere stolte vi på at
       * output_text alltid var ren JSON, noe som kan feile når web-søk
       * legger til tekst/citasjoner rundt svaret.
       *
       * Referansen er fortsatt hardlåst: 5308G-001 kan aldri bruke 5304,
       * 5204, 5905 eller andre modeller som eksakt prisgrunnlag.
       */
      const code = String(referenceCode || "").trim();
      const brandText = String(brand || "").trim();
      const modelText = String(modelName || "").trim();

      function normalizeModelCode(value) {
        return String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      }

      if (!code || code.length < 4 || !process.env.OPENAI_API_KEY) {
        return {
          enabled: false,
          status: "not_available",
          reason: "Ingen spesifikk modellreferanse eller API-nøkkel.",
          exact_match_count: 0,
          distinct_count: 0,
          value_nok: null,
          low_nok: null,
          high_nok: null,
          references: []
        };
      }

      try {
        const normalizedTarget = normalizeModelCode(code);

        const searchPrompt = `
Søk på nettet etter AKTUELLE PRISER for NØYAKTIG produktreferanse "${code}".

Merke: ${brandText}
Modell: ${modelText}
Eksakt referanse: ${code}

KRITISK MATCH-REGEL:
- En kilde teller bare hvis siden/listingen selv viser den eksakte referansen "${code}".
- ${code} må være identisk med referansen, med bindestrek, mellomrom og store/små bokstaver ignorert.
- Ikke bruk 5304, 5204, 5905 eller andre Patek Philippe Grand Complications som erstatning.
- Ikke bruk generelle artikler, auksjonsestimater, prisguider, forum eller sider uten en faktisk oppgitt pris.
- Prioriter seriøse forhandlere, markedsplasser og produsent.
- Se etter sider der både "${code}" og en konkret pris faktisk finnes.

Returner KUN data i det angitte JSON-skjemaet. Hvis du ikke finner en sikker eksakt pris, returner en tom references-liste.
`;

        const r = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
            tools: [{ type: "web_search" }],
            tool_choice: "required",
            input: searchPrompt,
            text: {
              format: {
                type: "json_schema",
                name: "exact_reference_market_prices",
                description: "Eksakte markedspriser for én konkret produktreferanse.",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    references: {
                      type: "array",
                      maxItems: 8,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          reference: { type: "string" },
                          title: { type: "string" },
                          url: { type: "string" },
                          price: { type: "number" },
                          currency: { type: "string" },
                          source_type: { type: "string" },
                          exact_reference_evidence: { type: "string" }
                        },
                        required: [
                          "reference",
                          "title",
                          "url",
                          "price",
                          "currency",
                          "source_type",
                          "exact_reference_evidence"
                        ]
                      }
                    }
                  },
                  required: ["references"]
                }
              }
            }
          })
        });

        if (!r.ok) {
          const errorText = await r.text().catch(() => "");
          return {
            enabled: false,
            status: "web_search_error",
            reason: `Web-søk feilet (${r.status})${errorText ? `: ${errorText.slice(0, 180)}` : "."}`,
            exact_match_count: 0,
            distinct_count: 0,
            value_nok: null,
            low_nok: null,
            high_nok: null,
            references: []
          };
        }

        const data = await r.json();
        const outputText = String(data?.output_text || "").trim();

        let parsedWeb = null;
        if (outputText) {
          try {
            parsedWeb = JSON.parse(outputText);
          } catch (_) {
            const match = outputText.match(/\{[\s\S]*\}/);
            if (match) {
              try { parsedWeb = JSON.parse(match[0]); } catch (_) {}
            }
          }
        }

        // Fallback for environments where output_text is not populated by the SDK/API response.
        if (!parsedWeb && Array.isArray(data?.output)) {
          const outputParts = [];
          for (const item of data.output) {
            if (Array.isArray(item?.content)) {
              for (const part of item.content) {
                if (part?.type === "output_text" && typeof part.text === "string") {
                  outputParts.push(part.text);
                }
              }
            }
          }
          const fallbackText = outputParts.join("\n").trim();
          if (fallbackText) {
            try {
              parsedWeb = JSON.parse(fallbackText);
            } catch (_) {
              const match = fallbackText.match(/\{[\s\S]*\}/);
              if (match) {
                try { parsedWeb = JSON.parse(match[0]); } catch (_) {}
              }
            }
          }
        }

        const references = Array.isArray(parsedWeb?.references)
          ? parsedWeb.references
              .map(item => ({
                reference: String(item?.reference || "").trim(),
                title: String(item?.title || "").trim(),
                url: String(item?.url || "").trim(),
                price: Number(item?.price),
                currency: String(item?.currency || "").trim().toUpperCase(),
                price_nok: null,
                source_type: String(item?.source_type || "").trim(),
                exact_reference_evidence: String(item?.exact_reference_evidence || "").trim()
              }))
              .filter(item => {
                const normalizedText = normalizeModelCode(
                  `${item.reference} ${item.title} ${item.exact_reference_evidence}`
                );
                return (
                  normalizedTarget &&
                  normalizedText.includes(normalizedTarget) &&
                  item.url.startsWith("http") &&
                  Number.isFinite(item.price) &&
                  item.price > 0 &&
                  item.price < 1000000000 &&
                  item.currency.length === 3
                );
              })
          : [];

        // Convert source prices to NOK on the server instead of asking the web-search model to calculate currency conversion.
        const converted = [];
        for (const item of references) {
          let priceNok = null;
          if (item.currency === "NOK") {
            priceNok = item.price;
          } else {
            try {
              const rate = await getExchangeRate(item.currency, "NOK");
              if (Number.isFinite(rate) && rate > 0) {
                priceNok = item.price * rate;
              }
            } catch (_) {}
          }

          if (Number.isFinite(priceNok) && priceNok > 0 && priceNok < 1000000000) {
            converted.push({
              ...item,
              price_nok: Math.round(priceNok)
            });
          }
        }

        // Deduplicate by URL + rounded NOK price.
        const unique = [];
        const seen = new Set();
        for (const item of converted) {
          const key = `${item.url}|${Math.round(item.price_nok)}`;
          if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
          }
        }

        const values = unique
          .map(x => x.price_nok)
          .filter(Number.isFinite)
          .sort((a, b) => a - b);

        /*
         * V14.0 – ROBUST EKSAKT-REFERANSE VERDIBEREGNING
         * ------------------------------------------------
         * Alle eksakte referanser skal fortsatt vises, men én svært høy
         * eller lav aktiv forhandlerpris skal ikke alene få bestemme
         * markedsverdien. Vi bruker IQR (interkvartilavstand) til å finne
         * statistiske avvik og beregner markedsverdien fra de robuste
         * treffene. Avvik beholdes som synlige referanser, men merkes som
         * ikke brukt i verdiberegningen.
         */
        let valuationValues = values.slice();
        let outlierIndexes = new Set();

        if (values.length >= 4) {
          const q1 = values[Math.floor((values.length - 1) * 0.25)];
          const q3 = values[Math.floor((values.length - 1) * 0.75)];
          const iqr = q3 - q1;
          const lowerFence = q1 - 1.5 * iqr;
          const upperFence = q3 + 1.5 * iqr;

          const candidateValues = values.filter(v =>
            v >= lowerFence && v <= upperFence
          );

          if (candidateValues.length >= 3 && candidateValues.length < values.length) {
            valuationValues = candidateValues;
          }

          for (let i = 0; i < unique.length; i++) {
            const v = Number(unique[i]?.price_nok);
            if (Number.isFinite(v) && !valuationValues.includes(v)) {
              outlierIndexes.add(i);
            }
          }
        }

        const valuationMedian = median(valuationValues);
        const valuationLow = valuationValues[0];
        const valuationHigh = valuationValues[valuationValues.length - 1];

        const referencesWithValuation = unique.map((item, index) => ({
          ...item,
          valuation_included: !outlierIndexes.has(index),
          valuation_exclusion_reason: outlierIndexes.has(index)
            ? "Ekstremt prisavvik – beholdes som referanse, men brukes ikke til markedsverdien."
            : "Eksakt referanse brukt i markedsverdien."
        }));

        if (!values.length) {
          return {
            enabled: false,
            status: "no_exact_web_prices",
            reason: "Ingen verifiserbare priser på eksakt modellreferanse ble funnet.",
            exact_match_count: 0,
            distinct_count: 0,
            value_nok: null,
            low_nok: null,
            high_nok: null,
            references: []
          };
        }

        return {
          enabled: true,
          status: "ok",
          reason: outlierIndexes.size
            ? `Eksakte referansepriser funnet. ${outlierIndexes.size} ekstremt prisavvik er ikke brukt i markedsverdien.`
            : "Eksakte referansepriser funnet via web-søk.",
          exact_match_count: values.length,
          distinct_count: new Set(values.map(v => Math.round(v))).size,
          value_nok: Math.round(valuationMedian),
          low_nok: Math.round(valuationLow),
          high_nok: Math.round(valuationHigh),
          valuation_reference_count: valuationValues.length,
          outlier_count: outlierIndexes.size,
          references: referencesWithValuation.slice(0, 8)
        };
      } catch (error) {
        return {
          enabled: false,
          status: "web_search_exception",
          reason: error?.message || "Ukjent web-søkfeil.",
          exact_match_count: 0,
          distinct_count: 0,
          value_nok: null,
          low_nok: null,
          high_nok: null,
          references: []
        };
      }
    }

    // V13.7.1 – WEB-REFERANSE-FIKS
    // targetModelCode ble tidligere deklarert inne i markedsblokken og
    // var derfor ikke tilgjengelig her når web-fallbacken skulle kjøre.
    // Vi beregner referansekoden på nytt i riktig scope.
    // V13.7.3 – GLOBAL MODELLREFERANSE-NORMALISERING
    // Web-fallbacken kjører utenfor blokken som inneholder v13.6-gaten.
    // Derfor må funksjonen være tilgjengelig i dette scopet også.
    function normalizeModelCode(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    }

    const marketProcessingStartedAt = performance.now();

    const webTargetModelCandidates = [
      itemInfo?.model,
      itemInfo?.model_number,
      itemInfo?.reference,
      parsed?.model,
      parsed?.name
    ]
      .map(v => String(v || "").trim())
      .filter(Boolean);

    const webTargetModelCode =
      webTargetModelCandidates
        .map(normalizeModelCode)
        .find(code =>
          code.length >= 4 &&
          /[a-z]/i.test(code) &&
          /\d/.test(code)
        ) || "";

    const webReferenceStartedAt = performance.now();
    const webReferenceSearch =
      webTargetModelCode && Number(ebay?.exact_match_count || 0) < 2
        ? await searchExactReferenceWeb(webTargetModelCode, itemInfo.brand, itemInfo.model || parsed.name)
        : { enabled: false, status: "not_needed", reason: "eBay har tilstrekkelig eksakt grunnlag.", exact_match_count: 0, distinct_count: 0, value_nok: null, low_nok: null, high_nok: null, references: [] };
    timings.web_reference_openai_ms = Math.round(
      performance.now() - webReferenceStartedAt
    );

    const marketSources = {
      ai: {
        enabled: Number.isFinite(aiEstimated),
        value_nok: Number.isFinite(aiEstimated)
          ? Math.round(aiEstimated)
          : null,
        low_nok: Number.isFinite(aiLow)
          ? Math.round(aiLow)
          : null,
        high_nok: Number.isFinite(aiHigh)
          ? Math.round(aiHigh)
          : null
      },

      ebay: {
        enabled: Boolean(ebay?.enabled),
        value_nok: Number.isFinite(Number(ebay?.median_nok))
          ? Math.round(Number(ebay.median_nok))
          : null,
        low_nok: Number.isFinite(Number(ebay?.low_nok))
          ? Math.round(Number(ebay.low_nok))
          : null,
        high_nok: Number.isFinite(Number(ebay?.high_nok))
          ? Math.round(Number(ebay.high_nok))
          : null,
        exact_match_count: Number(ebay?.exact_match_count || 0),
        same_model_match_count: Number(ebay?.same_model_match_count || 0),
        distinct_count: Number(ebay?.distinct_valuation_count || 0)
      },

      web_reference: {
        enabled: Boolean(webReferenceSearch?.enabled),
        value_nok: Number.isFinite(Number(webReferenceSearch?.value_nok)) ? Math.round(Number(webReferenceSearch.value_nok)) : null,
        low_nok: Number.isFinite(Number(webReferenceSearch?.low_nok)) ? Math.round(Number(webReferenceSearch.low_nok)) : null,
        high_nok: Number.isFinite(Number(webReferenceSearch?.high_nok)) ? Math.round(Number(webReferenceSearch.high_nok)) : null,
        exact_match_count: Number(webReferenceSearch?.exact_match_count || 0),
        same_model_match_count: 0,
        distinct_count: Number(webReferenceSearch?.distinct_count || 0),
        valuation_reference_count: Number(webReferenceSearch?.valuation_reference_count || 0),
        outlier_count: Number(webReferenceSearch?.outlier_count || 0),
        status: webReferenceSearch?.status || "not_available",
        reason: webReferenceSearch?.reason || "",
        references: Array.isArray(webReferenceSearch?.references) ? webReferenceSearch.references.slice(0, 8) : []
      },

      finn: {
        enabled: false,
        value_nok: null,
        low_nok: null,
        high_nok: null,
        exact_match_count: 0,
        same_model_match_count: 0,
        distinct_count: 0,
        reason:
          "FINN-adapter er klargjort, men live FINN-data er deaktivert til Kistefunn har legitim FINN API-tilgang og nødvendige API-parametre."
      }
    };

    /*
     * FINN-ADAPTER V11.0
     * -------------------
     * FINN skal ikke skrapes. Live FINN-data aktiveres først når Kistefunn
     * har legitim API-tilgang, API-nøkkel og dokumentert endepunkt/format.
     * Vi holder derfor adapteren eksplisitt deaktivert her i stedet for å
     * late som et uoffisielt endepunkt er tilgjengelig.
     *
     * Når tilgangen er på plass skal adapteren levere samme interne format
     * som eBay: value_nok, low_nok, high_nok, exact_match_count,
     * same_model_match_count og distinct_count. Frontend trenger da ikke
     * endres.
     */
    const finnAdapter = {
      enabled: false,
      status: "ready_for_official_api",
      requires: [
        "FINN API-tilgang",
        "API-nøkkel/credentials",
        "offisielt søkeendepunkt",
        "dokumentert responsformat"
      ]
    };

    marketSources.finn.adapter_status = finnAdapter.status;
    marketSources.finn.adapter_requires = finnAdapter.requires;

    function calculateEbayQuality(source) {
      if (!source?.enabled || !Number.isFinite(source.value_nok)) {
        return 0;
      }

      const exact = Math.max(0, source.exact_match_count || 0);
      const sameModel = Math.max(0, source.same_model_match_count || 0);
      const distinct = Math.max(0, source.distinct_count || 0);
      const hasYear = Boolean(
        ebay?.filtering?.exact_year_required_for_valuation
      );

      let weight = 0;

      if (hasYear && exact >= 6 && distinct >= 5) {
        weight = 0.95;
      } else if (hasYear && exact >= 4 && distinct >= 4) {
        weight = 0.90;
      } else if (hasYear && exact >= 3 && distinct >= 3) {
        weight = 0.82;
      } else if (hasYear && exact >= 2 && distinct >= 2) {
        weight = 0.70;
      } else if (hasYear && exact === 1 && sameModel >= 2) {
        weight = 0.45;
      } else if (hasYear && exact === 1) {
        weight = 0.30;
      } else if (hasYear && exact === 0 && sameModel >= 5) {
        weight = 0.25;
      } else if (hasYear && exact === 0 && sameModel >= 2) {
        weight = 0.20;
      } else if (!hasYear && exact >= 5 && distinct >= 4) {
        weight = 0.80;
      } else if (!hasYear && exact >= 3 && distinct >= 3) {
        weight = 0.70;
      } else if (!hasYear && exact >= 2 && distinct >= 2) {
        weight = 0.60;
      } else if (!hasYear && exact >= 1) {
        weight = 0.30;
      } else {
        weight = 0.15;
      }

      const confidence = String(parsed.confidence || "lav").toLowerCase();
      const brandEvidence = String(itemInfo.brand_evidence || "")
        .trim()
        .toLowerCase();
      const modelEvidence = String(itemInfo.model_evidence || "")
        .trim()
        .toLowerCase();
      const userModelHint = Boolean(ebay?.filtering?.user_model_hint);

      if (confidence === "lav" || brandEvidence === "ukjent") {
        weight = Math.min(weight, userModelHint ? 0.45 : 0.15);
      } else if (modelEvidence === "ukjent" && !userModelHint) {
        weight = Math.min(weight, 0.25);
      }

      return weight;
    }

    function calculateWebReferenceQuality(source) {
      if (!source?.enabled || !Number.isFinite(source.value_nok)) return 0;
      const exact = Math.max(0, Number(source.exact_match_count || 0));
      const distinct = Math.max(0, Number(source.distinct_count || 0));
      const valuationRefs = Math.max(0, Number(source.valuation_reference_count || 0));

      // Fire eller flere eksakte, robuste referanser er et sterkt
      // markedsgrunnlag. AI skal da være kontrollanker, ikke hovedkilde.
      if (exact >= 6 && valuationRefs >= 4 && distinct >= 4) return 0.95;
      if (exact >= 4 && valuationRefs >= 3 && distinct >= 3) return 0.90;
      if (exact >= 3 && valuationRefs >= 3 && distinct >= 2) return 0.78;
      if (exact >= 2 && valuationRefs >= 2 && distinct >= 2) return 0.60;
      if (exact === 1) return 0.25;
      return 0;
    }

    /*
     * V11.0 bruker source weights i stedet for at kombinasjonslogikken
     * er bundet direkte til eBay. Når FINN senere aktiveres, kan samme
     * motor bruke FINN + eBay samtidig uten å endre frontend.
     */
    function combineMarketSources(sources) {
      const candidates = [];

      if (
        sources.ai?.enabled &&
        Number.isFinite(sources.ai.value_nok)
      ) {
        candidates.push({
          source: "ai",
          value: sources.ai.value_nok,
          low: sources.ai.low_nok,
          high: sources.ai.high_nok,
          quality_weight: 1
        });
      }

      const ebayQuality = calculateEbayQuality(sources.ebay);

      if (
        sources.ebay?.enabled &&
        Number.isFinite(sources.ebay.value_nok) &&
        ebayQuality > 0
      ) {
        candidates.push({
          source: "ebay",
          value: sources.ebay.value_nok,
          low: sources.ebay.low_nok,
          high: sources.ebay.high_nok,
          quality_weight: ebayQuality
        });
      }

      const webReferenceQuality =
        calculateWebReferenceQuality(sources.web_reference);

      if (
        sources.web_reference?.enabled &&
        Number.isFinite(sources.web_reference.value_nok) &&
        webReferenceQuality > 0
      ) {
        candidates.push({
          source: "web_reference",
          value: sources.web_reference.value_nok,
          low: sources.web_reference.low_nok,
          high: sources.web_reference.high_nok,
          quality_weight: webReferenceQuality
        });
      }

      if (
        sources.finn?.enabled &&
        Number.isFinite(sources.finn.value_nok)
      ) {
        candidates.push({
          source: "finn",
          value: sources.finn.value_nok,
          low: sources.finn.low_nok,
          high: sources.finn.high_nok,
          quality_weight: 0.80
        });
      }

      if (!candidates.length) {
        return {
          estimated_nok: null,
          low_nok: null,
          high_nok: null,
          source_weights: [],
          confidence: "lav",
          basis: "Ingen brukbare markedsdata"
        };
      }

      const marketCandidates = candidates.filter(
        x => x.source !== "ai"
      );

      const aiCandidate = candidates.find(
        x => x.source === "ai"
      );

      const exactMarketCount = marketCandidates.reduce(
        (sum, x) => {
          if (x.source === "ebay") {
            return sum + Number(sources.ebay?.exact_match_count || 0);
          }
          if (x.source === "web_reference") {
            return sum + Number(sources.web_reference?.exact_match_count || 0);
          }
          if (x.source === "finn") {
            return sum + Number(sources.finn?.exact_match_count || 0);
          }
          return sum;
        },
        0
      );

      let marketWeight = 0;

      if (marketCandidates.length) {
        const totalQuality = marketCandidates.reduce(
          (sum, x) => sum + x.quality_weight,
          0
        );

        marketWeight = Math.min(
          0.90,
          0.45 + Math.min(0.45, totalQuality * 0.35)
        );

        const strongWebReference =
          sources.web_reference?.enabled &&
          Number(sources.web_reference.exact_match_count || 0) >= 4 &&
          Number(sources.web_reference.valuation_reference_count || 0) >= 3;

        if (strongWebReference) {
          marketWeight = Math.max(marketWeight, 0.95);
        }

        if (marketCandidates.length >= 2) {
          marketWeight = Math.min(0.95, marketWeight + 0.05);
        }

        // V14.3: minst to eksakte markedsreferanser gir markedet
        // hovedvekt også for selve prisintervallet.
        if (exactMarketCount >= 2) {
          marketWeight = Math.max(marketWeight, 0.90);
        }
      }

      const aiWeight = aiCandidate ? 1 - marketWeight : 0;

      let estimated = 0;
      let low = 0;
      let high = 0;
      let marketLow = 0;
      let marketHigh = 0;
      let marketEstimated = 0;

      if (aiCandidate) {
        estimated += aiCandidate.value * aiWeight;

        if (Number.isFinite(aiCandidate.low)) {
          low += aiCandidate.low * aiWeight;
        }

        if (Number.isFinite(aiCandidate.high)) {
          high += aiCandidate.high * aiWeight;
        }
      }

      if (marketCandidates.length) {
        const totalQuality = marketCandidates.reduce(
          (sum, x) => sum + x.quality_weight,
          0
        );

        for (const item of marketCandidates) {
          const marketShare =
            item.quality_weight / totalQuality;

          marketEstimated += item.value * marketShare;

          if (Number.isFinite(item.low)) {
            marketLow += item.low * marketShare;
          }

          if (Number.isFinite(item.high)) {
            marketHigh += item.high * marketShare;
          }

          const share = marketWeight * marketShare;

          estimated += item.value * share;

          if (Number.isFinite(item.low)) {
            low += item.low * share;
          }

          if (Number.isFinite(item.high)) {
            high += item.high * share;
          }
        }
      }

      /*
       * V14.3:
       * Når vi har minst to eksakte markedsreferanser, skal ikke
       * AI-low/AI-high kunne trekke intervallet langt under/over
       * det dokumenterte markedet. Estimatet kan fortsatt bruke AI
       * som kontrollsignal, men low/high forankres i markedet.
       */
      if (
        exactMarketCount >= 2 &&
        Number.isFinite(marketLow) &&
        marketLow > 0
      ) {
        low = Math.round(marketLow);
      }

      if (
        exactMarketCount >= 2 &&
        Number.isFinite(marketHigh) &&
        marketHigh > 0
      ) {
        high = Math.round(marketHigh);
      }

      const enabledMarketSources = marketCandidates.length;

      let confidence = "middels";

      if (enabledMarketSources >= 2 && exactMarketCount >= 3) {
        confidence = "høy";
      } else if (enabledMarketSources === 1 && exactMarketCount >= 4) {
        confidence = "høy";
      } else if (!marketCandidates.length) {
        confidence = "lav";
      }

      const totalSourceQuality = marketCandidates.reduce(
        (sum, x) => sum + x.quality_weight,
        0
      );

      const sourceWeights = [
        ...(aiCandidate
          ? [{
              source: "ai",
              percent: Math.round(aiWeight * 100)
            }]
          : []),
        ...marketCandidates.map(item => ({
          source: item.source,
          percent: Math.round(
            marketWeight *
            (item.quality_weight / totalSourceQuality) *
            100
          )
        }))
      ];

      const names = marketCandidates.map(x => {
        if (x.source === "ebay") return "eBay";
        if (x.source === "web_reference") return "Web-referanser";
        return "FINN";
      });

      const finalEstimated =
        exactMarketCount >= 2 && Number.isFinite(marketEstimated)
          ? marketEstimated * marketWeight +
            (aiCandidate ? aiCandidate.value * aiWeight : 0)
          : estimated;

      return {
        estimated_nok: Number.isFinite(finalEstimated)
          ? Math.round(finalEstimated)
          : null,
        low_nok:
          Number.isFinite(low) && low > 0
            ? Math.round(low)
            : null,
        high_nok:
          Number.isFinite(high) && high > 0
            ? Math.round(high)
            : null,
        source_weights: sourceWeights,
        confidence,
        basis: names.length
          ? `AI + ${names.join(" + ")}`
          : "AI-estimat"
      };
    }

    const market = combineMarketSources(marketSources);

    // V14.2: Når en enkelt markedsdatakilde har minst fire sterke, eksakte
    // referanser, får den robuste markedsverdien direkte gjennomslag. AI
    // skal da være kontroll, ikke trekke verdien bort fra markedet.
    const strongExactWebMarket =
      marketSources.web_reference?.enabled &&
      Number(marketSources.web_reference.exact_match_count || 0) >= 4 &&
      Number(marketSources.web_reference.valuation_reference_count || 0) >= 3 &&
      Number.isFinite(Number(marketSources.web_reference.value_nok));

    const strongExactEbayMarket =
      marketSources.ebay?.enabled &&
      Number(marketSources.ebay.exact_match_count || 0) >= 4 &&
      Number(marketSources.ebay.distinct_count || 0) >= 3 &&
      Number.isFinite(Number(marketSources.ebay.value_nok));

    const strongExactFinnMarket =
      marketSources.finn?.enabled &&
      Number(marketSources.finn.exact_match_count || 0) >= 4 &&
      Number(marketSources.finn.distinct_count || 0) >= 3 &&
      Number.isFinite(Number(marketSources.finn.value_nok));

    /*
     * V14.2 – STERKT EKSAKT MARKED = HOVEDVERDI
     * ----------------------------------------------
     * Når én markedsdatakilde alene har minst fire gode, eksakte
     * sammenligninger, skal ikke AI-estimatet trekke verdien bort fra
     * det dokumenterte markedet. Dette gjelder både eBay og eksterne
     * web-referanser.
     *
     * Eksempel: Haibike Trekking 6 hadde 5 eksakte eBay-referanser
     * med median 16 879 kr, mens AI trakk totalverdien opp til 18 262 kr.
     * Fra v14.2 skal markedets median være hovedverdien i et slikt tilfelle.
     */
    if (strongExactWebMarket && !strongExactEbayMarket && !strongExactFinnMarket) {
      market.estimated_nok = Math.round(Number(marketSources.web_reference.value_nok));
      market.low_nok = Number.isFinite(Number(marketSources.web_reference.low_nok))
        ? Math.round(Number(marketSources.web_reference.low_nok))
        : market.low_nok;
      market.high_nok = Number.isFinite(Number(marketSources.web_reference.high_nok))
        ? Math.round(Number(marketSources.web_reference.high_nok))
        : market.high_nok;
      market.confidence = "høy";
      market.basis = "Eksakte web-markedsreferanser";
      market.source_weights = [
        { source: "web_reference", percent: 100 }
      ];
    } else if (strongExactEbayMarket && !strongExactWebMarket && !strongExactFinnMarket) {
      market.estimated_nok = Math.round(Number(marketSources.ebay.value_nok));
      market.low_nok = Number.isFinite(Number(marketSources.ebay.low_nok))
        ? Math.round(Number(marketSources.ebay.low_nok))
        : market.low_nok;
      market.high_nok = Number.isFinite(Number(marketSources.ebay.high_nok))
        ? Math.round(Number(marketSources.ebay.high_nok))
        : market.high_nok;
      market.confidence = "høy";
      market.basis = "Eksakte eBay-markedsreferanser";
      market.source_weights = [
        { source: "ebay", percent: 100 }
      ];
    } else if (strongExactFinnMarket && !strongExactWebMarket && !strongExactEbayMarket) {
      market.estimated_nok = Math.round(Number(marketSources.finn.value_nok));
      market.low_nok = Number.isFinite(Number(marketSources.finn.low_nok))
        ? Math.round(Number(marketSources.finn.low_nok))
        : market.low_nok;
      market.high_nok = Number.isFinite(Number(marketSources.finn.high_nok))
        ? Math.round(Number(marketSources.finn.high_nok))
        : market.high_nok;
      market.confidence = "høy";
      market.basis = "Eksakte FINN-markedsreferanser";
      market.source_weights = [
        { source: "finn", percent: 100 }
      ];
    }

    let finalEstimated =
      Number.isFinite(market.estimated_nok)
        ? market.estimated_nok
        : aiEstimated;

    let finalLow =
      Number.isFinite(market.low_nok)
        ? market.low_nok
        : aiLow;

    let finalHigh =
      Number.isFinite(market.high_nok)
        ? market.high_nok
        : aiHigh;

    const ebayWeight =
      market.source_weights.find(x => x.source === "ebay")?.percent || 0;

    const valuationMethod =
      `V14.8 markedsmotor: ${market.basis}`;

    // V12.0: Vis den faktiske rensede eBay-søkestrengen.
    // Dermed vises ikke serienummerfragmenter som f.eks. MN5,
    // selv om AI-en opprinnelig la dette inn i søkefeltet.
    const displayEbaySearchQuery =
      ebay?.discovery_queries?.[0] ||
      ebay?.queries?.[0] ||
      parsed.ebay_search_query ||
      "";

    timings.market_processing_ms = Math.round(
      performance.now() - marketProcessingStartedAt
    );
    timings.total_backend_ms = Math.round(
      performance.now() - backendStartedAt
    );

    /* ---------------------------------------------------------
       8. RETURNER
       --------------------------------------------------------- */

    return res.status(200).json({
      version: "v14.26",
      timings,
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

      brand_evidence:
        itemInfo.brand_evidence,

      model_evidence:
        itemInfo.model_evidence,

      user_model_evidence:
        itemInfo.user_model_evidence,

      identification_basis:
        itemInfo.identification_basis,

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
        displayEbaySearchQuery,

      ebay_search_queries:
        ebay?.queries ||
        [],

      ebay,

      valuation_method:
        valuationMethod,

      ebay_weight_percent:
        Math.round(
          ebayWeight
        ),

      market,

      market_sources: marketSources,

      // V13.8: eksplisitt web-markedsgrunnlag til frontend.
      // Dette gjør at eksterne eksakte referanser kan vises selv når eBay har 0 treff.
      web_reference_market: {
        enabled: Boolean(marketSources.web_reference?.enabled),
        status: marketSources.web_reference?.status || "not_available",
        reason: marketSources.web_reference?.reason || "",
        exact_match_count: Number(marketSources.web_reference?.exact_match_count || 0),
        distinct_count: Number(marketSources.web_reference?.distinct_count || 0),
        value_nok: Number.isFinite(Number(marketSources.web_reference?.value_nok)) ? Math.round(Number(marketSources.web_reference.value_nok)) : null,
        low_nok: Number.isFinite(Number(marketSources.web_reference?.low_nok)) ? Math.round(Number(marketSources.web_reference.low_nok)) : null,
        high_nok: Number.isFinite(Number(marketSources.web_reference?.high_nok)) ? Math.round(Number(marketSources.web_reference.high_nok)) : null,
        references: Array.isArray(marketSources.web_reference?.references) ? marketSources.web_reference.references.slice(0, 8) : []
      },

      market_engine_version:
        "v14.9-structured-target-identity-final-title-gate",

      market_filter_version:
        "v14.9-hard-model-reference-gate-structured-target-identity-final-title-gate",

      buy_opportunities:
        buy_opportunities,

      buy_opportunities_count:
        buy_opportunities.length,

      price_investigations:
        priceInvestigations.slice(0, 8),

      price_investigations_count:
        priceInvestigations.length,

      /*
       * V14.4:
       * low_value_nok er normal lav markedspris.
       * Et godkjent billigfunn/kupp skal ikke senke denne verdien.
       * Frontend kan bruke disse feltene til å vise skillet tydelig.
       */
      normal_low_value_nok:
        Number.isFinite(finalLow)
          ? finalLow
          : null,

      bargain_low_value_nok:
        buy_opportunities.length
          ? Math.min(
              ...buy_opportunities
                .map(x => Number(x.price_nok))
                .filter(Number.isFinite)
            )
          : null,

      bargain_reference_count:
        buy_opportunities.length
    });

  } catch (e) {
    return res.status(500).json({
      error:
        e?.message ||
        "Ukjent feil"
    });
  }
}
