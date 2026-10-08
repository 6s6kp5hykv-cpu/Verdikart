// Kistefunn analysebackend v15.4 TEST
// V15.4 TEST: Web-reference quality gate. Sparse/conflicting external prices are corroboration only and cannot be presented as robust valuation or influence final market value.
// V14.35: FX-optimalisering: global TTL-cache + samtidig request-deduplisering for valutakurser.
// V14.34: Utvider diagnostic_detail med detaljert web-reference timing, OpenAI request-id/status/tokens og antall funn. Ingen endring av markeds-, filter- eller identifikasjonslogikk.
// V14.33: Utvider diagnostikken med detaljerte FX-valutaer og eBay item-details per kall (item-ID, tid og feil), samt samlet diagnostic_detail. Ingen endring av markeds-, filter- eller identifikasjonslogikk.
// V14.32: Diagnostikkforbedring: FX-tid skilles fra kumulativ FX-tid, valutakurser caches per valuta, og eBay item-details måler antall kall, total kalltid, tregeste kall og feil. Ingen endring av markeds-, filter- eller identifikasjonslogikk.
// V14.27: Beholder v14.26 SAFE v2-logikken. OpenAI-feil returnerer nå error_code, error_type og request_id for diagnostikk.
// V14.24: Beholder lengre modelltekst i strict market criteria slik at flerords-varianter ikke kuttes etter 4 ord.
// V14.23 STRICT GENERIC MODEL/VARIANT GATE: distinctive model/variant anchors must be present in generic-category listings.
// V14.23 STRICT ACCESSORY GATE: keyrings, miniatures, charms, replacement pieces and packaging-only items are rejected.
// V14.20: Squier/Squire behandles som samme variant i alle Fender/Squier-gater.
// V14.21: Eksakte gitarreferanser avviser eksplisitte bundle/pakke/kit/produktpakke-treff når målobjektet ikke selv er en pakke. Dette stopper f.eks. Squier Affinity Stratocaster + Mustang Micro Pack.
// V14.23: Vanlig Fender MIM Stratocaster avviser også 60s/classic 60s og signature/Jeff Beck-varianter.
// V14.19: produktmerke-gate skiller strukturerte merkeopplysninger fra fritekst/omtaler.
// V14.18: felles Fender/Squier brand-gate. Når målobjektet er Fender og ikke Squier, forkastes alle Squier/Squier by Fender-treff før exactPool, sameModelPool, valuationPool og kuppberegning. Motsatt forkastes Fender-treff når målobjektet faktisk er Squier.
// V14.17: endelig deterministisk Fender-filter basert på den faktiske eBay-søkestrengen, slik at Squier/andre varianter ikke kan påvirke verken exactPool, verdiberegning eller visning.
// V14.3: eksakte markedsreferanser forankrer også low/high slik at AI-low ikke trekker verdien kunstig ned.
// V14.4: normal lavpris holdes separat fra godkjente kupp, slik at et legitimt billigfunn vises som kupp uten å senke markedsintervallet.
// V14.11: retter scope-feil i finalForbiddenFenderVariants som stoppet eBay/markedspipelinen med ReferenceError. V14.10 eBay-diagnostikk beholdes.
// V12.7: brukeroppgitt spesifikk modellvariant brukes som sterkt signal når bildet støtter merke/serie.
// V12.7: nummererte sykkelvarianter (f.eks. Trekking 4 vs Trekking 6) hardfiltreres i markedet.
// Strengere identifikasjon + hardere markedsfilter + multi-source markedsmotor
// - V11.9: feil i søkemotorens variabelrekkefølge rettet + versjonsmerking samlet.
// - V11.8: farge og gripebrett/materiale er sekundære signaler og skal ikke låse markedssøket.
// - V12.0: visningssøket bruker den faktiske rensede eBay-søkestrengen, slik at serienummerfragmenter som MN5 ikke vises.
// - V11.7: videreføring av streng Fender-variantkontroll og mer robust markedsgrunnlag.
// - V11.6: hard Fender-variantgate som ekskluderer 62/Special/American/Player/Vintera/Squier osv.
//
// Viktige endringer fra v7:
// - Når konkret år er kjent, kan KUN annonser med samme år brukes i verdiberegningen.
// - Annonser uten år i tittelen blir kun nærtreff og påvirker ikke verdien.
// - Strengere modell-/variantfilter.
// - Brukerens konkrete modelltekst brukes som identifikasjonssignal.
// - eBay-token caches per kjøring.
// - Markedsgrunnlaget krever flere uavhengige treff før eBay får høy vekt.
// - Beholder eksisterende JSON-struktur slik at frontend normalt ikke trenger endring.
// - Ny markedsmotor er klargjort for FINN + eBay + AI.
// - FINN aktiveres først når legitim API-tilgang er tilgjengelig.

import { identifyWithOpenAI } from "./lib/openai.js";

const EBAY_OAUTH_TIMEOUT_MS = 10_000;
const EBAY_SEARCH_TIMEOUT_MS = 10_000;
const EBAY_ITEM_DETAILS_TIMEOUT_MS = 10_000;
const FRANKFURTER_TIMEOUT_MS = 8_000;
const WEB_REFERENCE_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url, options = {}, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Eksternt kall timeout etter ${timeoutMs} ms`);
      timeoutError.status = 504;
      timeoutError.error_code = "external_timeout";
      timeoutError.error_type = "timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// V14.35: Delbar FX-cache mellom invocations i samme serverless-instans.
// Valutakurser endres ikke så raskt at de trenger nytt kall for hver analyse.
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const globalExchangeRateCache = new Map();
const globalExchangeRatePromises = new Map();
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // V14.25: Intern tidsmåling. Kun måling – ingen endring av markeds-/filterlogikk.
    const backendStartedAt = performance.now();
    const timings = {
      openai_identification_ms: null,
      ebay_oauth_ms: null,
      ebay_search_ms: null,
      ebay_item_details_ms: null,
      ebay_item_details_calls: 0,
      ebay_item_details_total_call_ms: 0,
      ebay_item_details_slowest_ms: 0,
      ebay_item_details_failed: 0,
      web_reference_openai_ms: null,
      web_reference_fetch_ms: null,
      web_reference_fx_ms: 0,
      frankfurter_fx_ms: 0,
      frankfurter_fx_calls: 0,
      frankfurter_fx_wall_ms: null,
      frankfurter_fx_currencies: [],
      ebay_item_details_trace: [],
      ebay_total_ms: null,
      market_processing_ms: null,
      total_backend_ms: null
    };

    // Kupp- og prisundersøkelseslister må være tilgjengelige i hele handler-scope.
    let buy_opportunities = [];
    let priceInvestigations = [];
    const { image, description } = req.body || {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Mangler bilde" });
    }

    if (!image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Ugyldig bildeformat" });
    }

    const userDescription =
      typeof description === "string" ? description.trim() : "";

    /* ---------------------------------------------------------
       1. IDENTIFISER MED OPENAI
       --------------------------------------------------------- */

    let parsed;
    try {
      const aiResult = await identifyWithOpenAI({
        image,
        userDescription
      });
      parsed = aiResult.parsed;
      timings.openai_identification_ms = aiResult.duration_ms;
      timings.openai_diagnostics = aiResult.openai_diagnostics || null;
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return res.status(status).json({
        error: error?.message || "OpenAI-feil",
        error_code: error?.error_code || null,
        error_type: error?.error_type || null,
        error_param: error?.error_param || null,
        request_id: error?.request_id || null,
        status,
        version: "v15.3"
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
        "Merke, modell, alder, tilstand, originalitet og dokumenterte markedspriser påvirker verdien."
      ];
    }

    function parseNok(value) {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }

      if (typeof value !== "string") return null;

      let s = value.toLowerCase().replace(/kr/g, "").trim();

      const range = s.match(
        /(\d+(?:[.,]\d+)?)\s*(?:-|–|—|til)\s*(\d+(?:[.,]\d+)?)/i
      );

      if (range) {
        const a = Number(range[1].replace(",", "."));
        const b = Number(range[2].replace(",", "."));

        if (Number.isFinite(a) && Number.isFinite(b)) {
          return Math.round((a + b) / 2);
        }
      }

      s = s
        .replace(/\s/g, "")
        .replace(/[^\d,.-]/g, "");

      if (s.includes(",") && s.includes(".")) {
        const lc = s.lastIndexOf(",");
        const ld = s.lastIndexOf(".");

        if (lc > ld) {
          s = s.replace(/\./g, "").replace(",", ".");
        } else {
          s = s.replace(/,/g, "");
        }
      } else if (s.includes(",")) {
        const parts = s.split(",");

        s =
          parts.length === 2 && parts[1].length <= 2
            ? parts[0] + "." + parts[1]
            : parts.join("");
      } else if (s.includes(".")) {
        const parts = s.split(".");

        s =
          parts.length === 2 && parts[1].length <= 2
            ? parts[0] + "." + parts[1]
            : parts.join("");
      }

      const n = Number(s);

      return Number.isFinite(n) ? n : null;
    }

    function median(values) {
      if (!values.length) return null;

      const a = [...values].sort((x, y) => x - y);
      const m = Math.floor(a.length / 2);

      return a.length % 2
        ? a[m]
        : (a[m - 1] + a[m]) / 2;
    }

    function percentile(values, p) {
      if (!values.length) return null;

      const a = [...values].sort((x, y) => x - y);
      const index = (a.length - 1) * p;
      const lo = Math.floor(index);
      const hi = Math.ceil(index);

      if (lo === hi) return a[lo];

      return a[lo] +
        (a[hi] - a[lo]) * (index - lo);
    }

    function removeOutliers(items) {
      if (items.length < 5) return items;

      const prices = items
        .map(x => Number(x.nok))
        .filter(Number.isFinite);

      if (prices.length < 5) return items;

      const q1 = percentile(prices, 0.25);
      const q3 = percentile(prices, 0.75);
      const iqr = q3 - q1;

      return items.filter(item =>
        Number(item.nok) >= q1 - 1.5 * iqr &&
        Number(item.nok) <= q3 + 1.5 * iqr
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
       4. eBAY
       --------------------------------------------------------- */

    let ebayTokenCache = null;
    let ebayTokenPromise = null;

    // V14.10: siste trygge eBay-feil for denne kjøringen.
    // Inneholder aldri access-token eller Authorization-header.
    let ebayDiagnosticError = null;

    async function getEbayToken() {
      if (ebayTokenCache) {
        return ebayTokenCache;
      }

      if (ebayTokenPromise) {
        return ebayTokenPromise;
      }

      const clientId = process.env.EBAY_CLIENT_ID;
      const clientSecret = process.env.EBAY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        ebayDiagnosticError = {
          stage: "configuration",
          status: null,
          code:
            !clientId && !clientSecret
              ? "missing_client_id_and_secret"
              : !clientId
                ? "missing_client_id"
                : "missing_client_secret",
          message:
            "EBAY_CLIENT_ID/EBAY_CLIENT_SECRET mangler i servermiljøet."
        };
        return null;
      }

      ebayTokenPromise = (async () => {
        const credentials = Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64");

        const ebayOauthStartedAt = performance.now();
        const r = await fetchWithTimeout(
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
          },
          EBAY_OAUTH_TIMEOUT_MS
        );

        const d = await r.json();
        timings.ebay_oauth_ms = Math.round(
          performance.now() - ebayOauthStartedAt
        );

        if (!r.ok) {
          ebayDiagnosticError = {
            stage: "oauth",
            status: r.status,
            code:
              d?.errors?.[0]?.errorId ||
              d?.error ||
              "oauth_error",
            message:
              d?.errors?.[0]?.message ||
              d?.error_description ||
              "eBay OAuth-token kunne ikke hentes."
          };
          return null;
        }

        ebayTokenCache =
          d.access_token || null;

        if (!ebayTokenCache) {
          ebayDiagnosticError = {
            stage: "oauth",
            status: r.status,
            code: "missing_access_token",
            message: "eBay OAuth svarte uten access_token."
          };
        }

        return ebayTokenCache;
      })();

      try {
        return await ebayTokenPromise;
      } finally {
        ebayTokenPromise = null;
      }
    }

    let frankfurterFxFirstStartedAt = null;
    let frankfurterFxLastFinishedAt = null;

    async function getExchangeRate(from, to = "NOK") {
      if (from === to) return 1;

      const cacheKey = `${String(from).toUpperCase()}->${String(to).toUpperCase()}`;
      const now = Date.now();
      const cached = globalExchangeRateCache.get(cacheKey);

      if (cached && now - cached.cached_at < FX_CACHE_TTL_MS) {
        return cached.rate;
      }

      const existingPromise = globalExchangeRatePromises.get(cacheKey);
      if (existingPromise) {
        return existingPromise;
      }

      const fxStartedAt = performance.now();
      timings.frankfurter_fx_calls += 1;
      const fxCurrency = String(from).toUpperCase();
      if (!timings.frankfurter_fx_currencies.includes(fxCurrency)) {
        timings.frankfurter_fx_currencies.push(fxCurrency);
      }
      if (frankfurterFxFirstStartedAt === null) {
        frankfurterFxFirstStartedAt = fxStartedAt;
      }

      const requestPromise = (async () => {
        try {
          const r = await fetchWithTimeout(
            `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
            {},
            FRANKFURTER_TIMEOUT_MS
          );

          if (!r.ok) {
            return null;
          }

          const d = await r.json();
          const rate = d?.rates?.[to] || null;
          if (Number.isFinite(Number(rate)) && Number(rate) > 0) {
            const numericRate = Number(rate);
            globalExchangeRateCache.set(cacheKey, {
              rate: numericRate,
              cached_at: Date.now()
            });
            return numericRate;
          }

          return null;
        } catch {
          return null;
        } finally {
          const elapsed = Math.round(performance.now() - fxStartedAt);
          timings.frankfurter_fx_ms += elapsed;
          frankfurterFxLastFinishedAt = performance.now();
          if (frankfurterFxFirstStartedAt !== null) {
            timings.frankfurter_fx_wall_ms = Math.round(
              frankfurterFxLastFinishedAt - frankfurterFxFirstStartedAt
            );
          }
          globalExchangeRatePromises.delete(cacheKey);
        }
      })();

      globalExchangeRatePromises.set(cacheKey, requestPromise);
      return requestPromise;
    }

    function cleanText(value) {
      return String(value || "")
        .replace(/[\n\r\t,;:()[\]{}"']/g, " ")
        .replace(/[\/|_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function words(value) {
      return cleanText(value)
        .split(" ")
        .map(x => x.trim())
        .filter(Boolean);
    }

    function uniqueWords(value) {
      const out = [];
      const seen = new Set();

      for (const w of words(value)) {
        const k = w.toLowerCase();

        if (seen.has(k)) continue;

        seen.add(k);
        out.push(w);
      }

      return out;
    }

    function compact(value, maxWords = 4) {
      const stop = new Set([
        "sannsynligvis",
        "muligens",
        "trolig",
        "ukjent",
        "unknown",
        "eller",
        "med",
        "og",
        "av",
        "for",
        "fra",
        "som",
        "mulig",
        "antatt",
        "probably",
        "likely",
        "possibly",
        "treverk",
        "lakkert",
        "kropp",
        "gripebrett",
        "metallhardware",
        "plastplekterbrett",
        "plast",
        "produksjon",
        "produced",
        "made"
      ]);

      return uniqueWords(value)
        .filter(w =>
          !stop.has(w.toLowerCase())
        )
        .map(w =>
          w.replace(/[^\p{L}\p{N}.]/gu, "")
        )
        .filter(Boolean)
        .slice(0, maxWords)
        .join(" ");
    }

    function extractYear(value) {
      const m =
        String(value || "")
          .match(/\b(19\d{2}|20\d{2})\b/);

      return m ? Number(m[1]) : null;
    }

    function extractYears(value) {
      const matches =
        String(value || "")
          .match(/\b(19\d{2}|20\d{2})\b/g) || [];

      return [
        ...new Set(matches.map(Number))
      ];
    }

    function extractCountry(value) {
      const s =
        String(value || "").toLowerCase();

      if (
        /\bmexic/.test(s) ||
        /\bmim\b/.test(s)
      ) {
        return "mexico";
      }

      if (
        /\busa\b/.test(s) ||
        /\bamerican\b/.test(s) ||
        /\bmade in usa\b/.test(s)
      ) {
        return "usa";
      }

      if (
        /\bjapan\b/.test(s) ||
        /\bjapanese\b/.test(s)
      ) {
        return "japan";
      }

      if (
        /\bkorea\b/.test(s) ||
        /\bkorean\b/.test(s)
      ) {
        return "korea";
      }

      if (
        /\bindonesia\b/.test(s) ||
        /\bindonesian\b/.test(s)
      ) {
        return "indonesia";
      }

      if (
        /\bchina\b/.test(s) ||
        /\bchinese\b/.test(s)
      ) {
        return "china";
      }

      return null;
    }

    function extractAgeGroup(...values) {
      const s = values
        .map(v => String(v || ""))
        .join(" ")
        .toLowerCase();

      if (
        /\b(kids?|kid|children|child|junior|youth|infant|baby|toddler)\b/
          .test(s)
      ) {
        return "kids";
      }

      if (
        /\b(adult|adults|men|mens|women|womens|man|woman)\b/
          .test(s)
      ) {
        return "adult";
      }

      return null;
    }

    function detectCategory(...values) {
      const s = values
        .map(v => String(v || ""))
        .join(" ")
        .toLowerCase();

      if (
        /\b(playstation|ps5|xbox|nintendo switch|console|konsoll)\b/
          .test(s)
      ) {
        return "console";
      }

      if (
        /\b(bicycle|bike|sykkel|el-sykkel|elsykkel|e-bike|ebike|trekking bike|pedelec)\b/
          .test(s)
      ) {
        return "bicycle";
      }

      if (
        /\b(guitar|gitar|stratocaster|telecaster|les paul|precision bass|jazz bass)\b/
          .test(s)
      ) {
        return "guitar";
      }

      if (
        /\bbirkenstock\b/.test(s)
      ) {
        return "footwear";
      }

      return "generic";
    }

    function buildStrictQueries(parsed) {
      const info =
        parsed?.item_info || {};

      const brand =
        compact(info.brand, 1);

      const rawModel =
        compact(info.model, 12);

      const serialNumber =
        infoText(info.serial_number, "");

      // Ikke la serienummer/prefix snike seg inn i markedssoeket.
      // Fender MN5178398 kan for eksempel bli feiltolket som
      // modellteksten "MN5". Det gir svaert daarlige eBay-soek.
      function removeSerialArtifacts(value, serial) {
        let out = String(value || "");
        const sn = String(serial || "")
          .replace(/[^\p{L}\p{N}]/gu, "")
          .toLowerCase();

        if (sn.length >= 4) {
          const compactValue = sn
            ? sn
            : "";

          out = out.replace(
            new RegExp("\\b" + compactValue + "\\b", "ig"),
            " "
          );

          // Fjern korte serienummerprefiks som AI kan ha lagt i modellfeltet.
          // Bare prefiks med minst 3 tegn og minst ett siffer fjernes.
          const prefixes = [];
          for (let len = 3; len <= Math.min(5, sn.length - 1); len++) {
            const prefix = sn.slice(0, len);
            if (/\d/.test(prefix)) prefixes.push(prefix);
          }

          for (const prefix of prefixes) {
            out = out.replace(
              new RegExp("\\b" + prefix + "\\b", "ig"),
              " "
            );
          }
        }

        return out
          .replace(/\s+/g, " ")
          .trim();
      }

      // V11.8: ekstra beskyttelse mot Fender-serienummerfragmenter
      // som AI av og til legger i modellfeltet, f.eks. "MN5" fra
      // serienummeret MN5178398. Slike tokens skal aldri bli eBay-søk.
      function removeSearchSerialTokens(value) {
        return String(value || "")
          .replace(/\b(?:MN|MZ|MX|US|AM|DZ|V|CN|CO|IC)\d{1,10}\b/gi, " ")
          .replace(/\b[A-Z]{2,4}\d{5,10}\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      // V11.8: kosmetiske egenskaper skal ikke styre markedssoeket.
      // Farge og gripebrett/materiale brukes som sekundære relevanssignaler
      // i stedet. Dette hindrer f.eks. "black rosewood" fra å låse søket
      // til et lite og ofte dyrere delmarked.
      function removeGuitarCosmeticSearchTerms(value) {
        return String(value || "")
          .replace(/\b(?:black|svart|sort|white|hvit|olympic\s+white|red|rød|blue|blå|sunburst|sun\s+burst|3[- ]tone\s+sunburst|3ts)\b/gi, " ")
          .replace(/\b(?:rosewood|palisander|maple|lønnet|ebony|pau\s+ferro|pauferro)\b/gi, " ")
          .replace(/\b(?:fingerboard|fretboard|gripebrett)\b/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      let model =
        removeSearchSerialTokens(
          removeSerialArtifacts(rawModel, serialNumber)
        );

      const type =
        compact(info.type, 2);

      const manufacturer =
        compact(info.manufacturer, 2);

      const material =
        compact(info.material, 1);

      const userText =
        compact(parsed._user_description, 6);

      const aiQuery =
        removeSearchSerialTokens(
          removeSerialArtifacts(
            compact(parsed.ebay_search_query, 6),
            serialNumber
          )
        );

      // V11.9: category må bestemmes før marketAiQuery brukes.
      // I v11.8 lå marketAiQuery foran category-deklarasjonen, som kunne
      // gi ReferenceError (Temporal Dead Zone) og stoppe hele analysen.
      const category =
        detectCategory(
          parsed.name,
          parsed.description,
          info.type,
          info.model,
          info.brand,
          parsed.ebay_search_query,
          userText
        );

      /* V12.7: løft en spesifikk nummerert sykkelvariant fra brukerens tekst. */
      let userSpecificModel = null;

      if (category === "bicycle" && brand && model && userText) {
        const baseModel = model.replace(/\s+/g, " ").trim();
        if (baseModel.length >= 3) {
          const escaped = baseModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const rx = new RegExp("\\b" + escaped + "\\b\\s+([0-9]+(?:[.,][0-9]+)?(?:[A-Za-z]+)?)", "i");
          const match = userText.match(rx);
          if (match && match[1]) {
            userSpecificModel = `${baseModel} ${match[1]}`.trim();
            model = userSpecificModel;
          }
        }
      }

      const marketAiQuery =
        category === "guitar"
          ? removeGuitarCosmeticSearchTerms(aiQuery)
          : aiQuery;

      const year =
        extractYear(info.year_or_period) ||
        extractYear(parsed.name) ||
        extractYear(parsed.description) ||
        extractYear(parsed.ebay_search_query) ||
        extractYear(userText);

      const country =
        extractCountry(info.year_or_period) ||
        extractCountry(info.manufacturer) ||
        extractCountry(parsed.name) ||
        extractCountry(parsed.description) ||
        extractCountry(userText);

      const ageGroup =
        extractAgeGroup(
          parsed.name,
          parsed.description,
          info.type,
          info.model,
          info.year_or_period,
          userText
        );

      const objectText = `${parsed.name || ""} ${parsed.description || ""} ${info.model || ""} ${info.type || ""} ${info.material || ""}`.toLowerCase();

      const targetFingerboard =
        /\b(rosewood|palisander)\b/.test(objectText)
          ? "rosewood"
          : /\b(maple|lønnet)\b.*\b(fingerboard|fretboard|gripebrett)\b/.test(objectText)
            ? "maple"
            : null;

      const targetColor =
        /\b(black|svart|sort)\b/.test(objectText)
          ? "black"
          : /\b(white|hvit)\b/.test(objectText)
            ? "white"
            : /\b(red|rød)\b/.test(objectText)
              ? "red"
              : /\b(blue|blå)\b/.test(objectText)
                ? "blue"
                : /\b(sunburst|sun burst)\b/.test(objectText)
                  ? "sunburst"
                  : /\b(olympic white)\b/.test(objectText)
                    ? "olympic_white"
                    : null;

      const targetSpecial =
        /\b(anniversary|50th ann|50th anniversary|special edition|62['’]? special)\b/.test(objectText);

      const hardYear =
        category === "guitar"
          ? year
          : null;

      const candidates = [];

      /*
       * BRUKERENS KONKRETE MODELL
       *
       * Hvis brukeren skriver f.eks.
       * "Haibike Trekking 4"
       * skal dette få høy prioritet.
       */
      const userModelHint =
        Boolean(
          brand &&
          model &&
          userText &&
          userText.toLowerCase().includes(brand.toLowerCase()) &&
          userText.toLowerCase().includes(model.toLowerCase())
        );

      if (userModelHint && userSpecificModel) {
        parsed.item_info.model = model;
        parsed.item_info.user_model_evidence =
          `Brukeren oppga ${model}. Bildet støtter merke/serie, men modellnummeret er ikke nødvendigvis lesbart i bildet.`;
        parsed.item_info.identification_basis =
          "Bilde + brukeroppgitt spesifikk modellvariant.";
      }

      if (
        category === "bicycle" &&
        brand &&
        model
      ) {
        candidates.push(
          `${brand} ${model}`
        );

        candidates.push(
          `${brand} ${model} e-bike`
        );

        candidates.push(
          `${brand} ${model} electric bike`
        );

        candidates.push(
          `${brand} ${model} complete e-bike`
        );

        if (country) {
          candidates.push(
            `${brand} ${model} ${country}`
          );
        }
      } else if (
        category === "bicycle" &&
        brand
      ) {
        candidates.push(
          `${brand} trekking e-bike`
        );

        candidates.push(
          `${brand} trekking electric bike`
        );

        candidates.push(
          `${brand} trekking bicycle`
        );
      }

      if (
        brand &&
        model &&
        country &&
        hardYear
      ) {
        candidates.push(
          `${brand} ${model} ${country} ${hardYear}`
        );
      }

      if (
        brand &&
        model &&
        hardYear
      ) {
        candidates.push(
          `${brand} ${model} ${hardYear}`
        );
      }

      if (
        brand &&
        model &&
        country
      ) {
        candidates.push(
          `${brand} ${model} ${country}`
        );
      }

      if (
        brand &&
        model
      ) {
        candidates.push(
          `${brand} ${model}`
        );
      }

      /*
       * GUITAR-FALLBACKS
       * Ikke stol på at AI sitt fritekst-søk alltid inneholder
       * de viktigste markedstermene. For Fender Stratocaster/MIM
       * lager vi derfor noen korte, robuste varianter. Dette skal
       * ikke endre relevansfilteret - bare øke sjansen for å finne
       * de samme relevante annonsene som på offentlig eBay-søk.
       */
      if (
        category === "guitar" &&
        brand &&
        model
      ) {
        const modelLower = model.toLowerCase();

        if (
          brand.toLowerCase() === "fender" &&
          /\bstratocaster\b/.test(modelLower)
        ) {
          if (hardYear) {
            candidates.push(
              `${brand} Standard Stratocaster ${hardYear}`
            );
            candidates.push(
              `${brand} Stratocaster ${hardYear} MIM`
            );
            candidates.push(
              `${brand} Stratocaster ${hardYear} Mexico`
            );
            candidates.push(
              `${brand} Standard Stratocaster Mexico ${hardYear}`
            );
          } else {
            candidates.push(
              `${brand} Standard Stratocaster MIM`
            );
            candidates.push(
              `${brand} Stratocaster Mexico`
            );
          }
        }
      }

      if (userModelHint) {
        candidates.push(userText);
      }

      if (
        category === "guitar" &&
        brand.toLowerCase() === "fender" &&
        /\bstratocaster\b/i.test(model) &&
        hardYear
      ) {
        // Disse skal alltid finnes, selv om AI har blandet serienummer
        // eller annen støy inn i modell-/soekefeltene.
        candidates.push(`Fender Standard Stratocaster ${hardYear}`);
        candidates.push(`Fender Stratocaster ${hardYear} MIM`);
        candidates.push(`Fender Stratocaster ${hardYear} Mexico`);
        candidates.push(`Fender Standard Stratocaster Mexico ${hardYear}`);
      }

      if (marketAiQuery) {
        candidates.push(marketAiQuery);
      }

      const out = [];
      const seen = new Set();

      for (const raw of candidates) {
        const normalizedRaw =
          category === "guitar"
            ? removeGuitarCosmeticSearchTerms(raw)
            : raw;

        const q = compact(normalizedRaw, 7);

        if (!q || q.length < 4) continue;

        const key =
          q.toLowerCase();

        if (seen.has(key)) continue;

        seen.add(key);
        out.push(q);

        if (out.length >= 6) break;
      }

      const variantUncertain =
        /cannot be confirmed|can't be confirmed|cannot be determined|exact variant|variant.*cannot|eksakt variant|variant.*ikke.*bekreft|kan ikke bekreftes/i
          .test(
            `${parsed.description || ""} ${info.uncertainties || ""}`
          );

      /*
       * V10.7 – SEPARAT DISCOVERY-SØK
       *
       * Når vi kjenner produksjonsåret, skal ikke selve søket være låst
       * til at årstallet må stå i tittelen. eBay kan ha år/variant som
       * strukturerte item-aspects. Derfor søker vi også bredt uten år,
       * henter detaljer på gode kandidater, og lar detaljene avgjøre året.
       */
      const discovery = [];
      const discoverySeen = new Set();

      function addDiscovery(value) {
        const normalizedValue =
          category === "guitar"
            ? removeGuitarCosmeticSearchTerms(value)
            : value;
        const q = compact(normalizedValue, 7);
        if (!q || q.length < 4) return;
        const key = q.toLowerCase();
        if (discoverySeen.has(key)) return;
        discoverySeen.add(key);
        discovery.push(q);
      }

      for (const q of out) {
        const withoutYear = hardYear
          ? q.replace(new RegExp(`\\b${hardYear}\\b`, "ig"), " ")
          : q;
        addDiscovery(withoutYear);
      }

      if (hardYear) {
        if (brand && model) addDiscovery(`${brand} ${model}`);
        if (brand && type) addDiscovery(`${brand} ${type}`);
        if (brand && country) addDiscovery(`${brand} ${model || type} ${country}`);

        if (category === "guitar" &&
            brand.toLowerCase() === "fender" &&
            /\bstratocaster\b/i.test(model)) {
          addDiscovery("Fender Standard Stratocaster Mexico");
          addDiscovery("Fender Stratocaster MIM");
          addDiscovery("Fender Stratocaster Made in Mexico");
        }
      }

      return {
        queries: out,
        discovery_queries: discovery.slice(0, 4),
        brand,
        model,
        type,
        manufacturer,
        material,
        year: hardYear,
        detected_year: year,
        country,
        ageGroup,
        category,
        target_fingerboard: targetFingerboard,
        target_color: targetColor,
        target_special: targetSpecial,
        user_model_hint: userModelHint,
        user_model_text: userSpecificModel || null,
        identification_basis:
          userModelHint && userSpecificModel
            ? "bilde + brukeroppgitt spesifikk modellvariant"
            : "bildeanalyse",
        variant_uncertain: variantUncertain
      };
    }

    /* ---------------------------------------------------------
       5. STRENG RELEVANSEFILTER
       --------------------------------------------------------- */

    function scoreListing(title, criteria) {
      const raw = String(title || "");
      const t = raw.toLowerCase();

      const brand =
        String(criteria.brand || "").toLowerCase();

      const model =
        String(criteria.model || "").toLowerCase();

      const type =
        String(criteria.type || "").toLowerCase();

      const country =
        criteria.country;

      const year =
        criteria.year;

      const material =
        String(criteria.material || "").toLowerCase();

      const variantUncertain =
        Boolean(criteria.variant_uncertain);

      const category =
        criteria.category || "generic";

      let score = 0;
      const reasons = [];

      const accessoryTerms = [
        "pedal",
        "effect pedal",
        "fuzz",
        "overdrive",
        "distortion",
        "tuner",
        "strap",
        "strings",
        "string set",
        "pick",
        "plectrum",
        "pickup",
        "pickguard",
        "bridge",
        "neck",
        "body only",
        "replacement body",
        "replacement neck",
        "case only",
        "gig bag",
        "gigbag",
        "hardcase",
        "flight case",
        "cable",
        "stand",
        "wall hanger",
        "capo",
        "knob",
        "potentiometer",
        "switch",
        "sticker",
        "decal",
        "parts",
        "part",
        "repair",
        "manual",
        "book",
        "poster",
        "shirt",
        "t-shirt",
        "cover only",
        "replacement part",
        "spare part",
        "repair service",
        "reparatur",
        "charger",
        "battery charger",
        "battery only",
        "akku only",
        "display only",
        "motor only",
        "engine only",
        "wheel only",
        "fork only",
        "gabel only",
        "saddle only",
        "sattel only",
        "keyring",
        "key ring",
        "keychain",
        "key chain",
        "key holder",
        "key charm",
        "miniature",
        "mini figure",
        "mini figurine",
        "figurine",
        "collectible figure",
        "shoe charm",
        "charm",
        "toy",
        "doll",
        "ornament",
        "plush",
        "shoelace",
        "shoe lace",
        "lace replacement",
        "replacement item",
        "replacement piece",
        "replacement part",
        "box only",
        "empty box",
        "packaging only",
        "manual only",
        "poster only",
        "sticker only",
        "decal only"
      ];

      if (
        accessoryTerms.some(term =>
          t.includes(term)
        )
      ) {
        return {
          score: -100,
          accepted: false,
          near_match: false,
          year_match: year
            ? "missing"
            : "not_required",
          reason: "tilbehør/del"
        };
      }

      /* -------------------------------------------------------
         GITAR – KOMPLETT GITAR VS. DELER
         ------------------------------------------------------- */

      if (category === "guitar") {
        // En markedsreferanse for gitar må være en faktisk komplett gitar.
        // eBay kan ellers tolke "Fender Stratocaster 1995" som relevante
        // treff selv om annonsen gjelder en arm, kropp, hals eller annen del.
        const guitarNonCompletePatterns = [
          /\btremolo\s+arm\b/,
          /\bvibrato\s+arm\b/,
          /\bwhammy\s+bar\b/,
          /\bneck\s+plate\b/,
          /\bbackplate\b/,
          /\bcontrol\s+plate\b/,
          /\bcontrol\s+knob\b/,
          /\bknob\b/,
          /\bstring\s+tree\b/,
          /\btruss\s+rod\b/,
          /\bcase\s+only\b/,
          /\bgig\s*bag\s+only\b/
        ];

        if (guitarNonCompletePatterns.some(pattern => pattern.test(t))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "gitar-del/tilbehør"
          };
        }

        const guitarObjectWords =
          /\b(guitar|guitars|electric\s+guitar|e[- ]?guitar|gitar|stratocaster|telecaster|les\s+paul|jazz\s+bass|precision\s+bass)\b/;

        if (!guitarObjectWords.test(t)) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "ikke komplett gitar"
          };
        }

        const guitarBadConditionPatterns = [
          /\bfor\s+parts\b/,
          /\bparts\s+only\b/,
          /\bnot\s+working\b/,
          /\bnon[- ]?working\b/,
          /\bbroken\b/,
          /\bneeds?\s+repair\b/,
          /\bfor\s+repair\b/,
          /\brepair\s+project\b/,
          /\bproject\s+guitar\b/,
          /\bas[- ]?is\b/,
          /\bincomplete\b/,
          /\bmissing\s+parts\b/,
          /\bdamaged\b/
        ];

        if (guitarBadConditionPatterns.some(pattern => pattern.test(t))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "skadet/defekt/prosjektgitar"
          };
        }

        const guitarPartPatterns = [
          /\bbody\s+(?:only|w\/?|with|and)\b/,
          /\bbody\s+w\/\s*hardware\b/,
          /\bbody\s+only\b/,
          /\bonly\s+body\b/,
          /\breplacement\s+body\b/,
          /\bneck\s+only\b/,
          /\bonly\s+neck\b/,
          /\breplacement\s+neck\b/,
          /\bpickup(?:s)?\s+only\b/,
          /\bpickguard\s+only\b/,
          /\bbridge\s+only\b/,
          /\bhardware\s+only\b/,
          /\bparts?\s+only\b/,
          /\bfor\s+parts\b/,
          /\bparts\s+and\s+hardware\b/,
          /\bbody\s+with\s+hardware\b/,
          /\bbody\s+w\/?\s*hardware\b/,
          /\bguitar\s+body\b/
        ];

        if (guitarPartPatterns.some(pattern => pattern.test(t))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "gitar-del/kun kropp/hals/hardware"
          };
        }
      }

      /* -------------------------------------------------------
         SYKKEL
         ------------------------------------------------------- */

      if (category === "bicycle") {
        /*
         * V12.9 – HARD BICYCLE LISTING GATE
         * ----------------------------------
         * A model query such as "Haibike Trekking 4" must never let a
         * Trekking 6 (or another numbered Trekking sibling) become an
         * exact comparable. We also reject bicycle components such as
         * headset bearings, replacement parts and non-working bikes.
         * These checks happen before normal relevance scoring so a high
         * textual score can never override them.
         */
        const bicyclePartTerms = [
          "akku schloss",
          "battery lock",
          "battery key",
          "akku schloss set",
          "lock set",
          "frame lock",
          "rahmenschloss",
          "battery cover",
          "akku deckel",
          "akkugehäuse",
          "akku gehause",
          "motor cover",
          "display",
          "controller",
          "sensor",
          "speed sensor",
          "chainring",
          "kassette",
          "derailleur",
          "schaltwerk",
          "brake rotor",
          "bremsrotor",
          "brake lever",
          "bremshebel",
          "headset",
          "headset bearing",
          "headset bearings",
          "steuersatz",
          "steuersatzlager",
          "steuerlager",
          "bearing",
          "bearings",
          "ersatzteil",
          "replacement part",
          "spare part",
          "parts only",
          "for parts",
          "non working",
          "non-working",
          "not working",
          "broken",
          "damaged",
          "repair project",
          "needs repair",
          "for repair",
          "charger",
          "ladegerät",
          "ladegerat",
          "key only",
          "schlüssel only",
          "schluessel only",
          "spare key",
          "ersatzschlüssel",
          "ersatzschluessel"
        ];

        if (
          bicyclePartTerms.some(term =>
            t.includes(term)
          )
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "sykkeldel/tilbehør"
          };
        }

        /*
         * V12.9 – HARD MODELL/VARIANT-GATE
         * ----------------------------------
         * V12.8 brukte `query` direkte her. `query` finnes ikke som lokal
         * variabel i scoreListing(), og kunne derfor gi ReferenceError.
         *
         * I tillegg skal ikke alle tall i hele eBay-søket tolkes som
         * modellnummer. Vi henter først variantnummer fra den faktiske
         * modellidentiteten (brukeroppgitt modell + AI-modell), og bruker
         * søkekonteksten bare som reserve. Årstall ignoreres.
         *
         * Resultat: Haibike Trekking 4 kan ikke få Trekking 6 som exact,
         * same_model eller prisgrunnlag. Samme regel kan brukes på andre
         * produkter med nummererte modeller.
         */
        const bicycleIdentityText =
          `${criteria.user_model_text || ""} ${criteria.model || ""}`
            .toLowerCase();

        const bicycleQueryContext =
          String(criteria.query_context || "").toLowerCase();

        function extractModelVariantNumbers(text) {
          return [
            ...new Set(
              (String(text || "").match(/\b\d+(?:[.,]\d+)?[a-z]*\b/g) || [])
                .map(x => x.toLowerCase())
                .filter(x => !/^19\d{2}$/.test(x))
                .filter(x => !/^20\d{2}$/.test(x))
            )
          ];
        }

        let targetVariantNumbers =
          extractModelVariantNumbers(bicycleIdentityText);

        // Hvis AI-modellen er normalisert for mye, bruk søkekonteksten
        // som reserve – men bare når identiteten ellers mangler nummer.
        if (!targetVariantNumbers.length) {
          targetVariantNumbers =
            extractModelVariantNumbers(bicycleQueryContext);
        }

        if (targetVariantNumbers.length) {
          const listingVariantNumbers =
            extractModelVariantNumbers(t);

          const missingTargetVariant =
            targetVariantNumbers.some(
              token => !listingVariantNumbers.includes(token)
            );

          if (missingTargetVariant) {
            return {
              score: -100,
              accepted: false,
              near_match: false,
              year_match: year ? "missing" : "not_required",
              reason: `annen modellvariant enn målet ${criteria.user_model_text || criteria.model || criteria.query_context}`
            };
          }
        }

        /*
         * Ekstra eksplisitt sibling-gate for nummererte Trekking-modeller.
         * Hvis målet er Trekking 4 og annonsen eksplisitt sier Trekking 6,
         * skal den ut selv om andre deler av tittelen gir høy relevansscore.
         */
        const targetTrekkingMatch =
          `${bicycleIdentityText} ${bicycleQueryContext}`
            .match(/\btrekking\s+(\d+(?:[.,]\d+)?[a-z]*)\b/i);

        if (targetTrekkingMatch) {
          const targetTrekkingVariant = targetTrekkingMatch[1].toLowerCase();
          const listingTrekkingMatches = [
            ...t.matchAll(/\btrekking\s+(\d+(?:[.,]\d+)?[a-z]*)\b/gi)
          ].map(m => m[1].toLowerCase());

          if (
            listingTrekkingMatches.length &&
            listingTrekkingMatches.some(v => v !== targetTrekkingVariant)
          ) {
            return {
              score: -100,
              accepted: false,
              near_match: false,
              year_match: year ? "missing" : "not_required",
              reason: `annen Haibike Trekking-variant enn ${targetTrekkingVariant}`
            };
          }

          if (
            listingTrekkingMatches.length &&
            !listingTrekkingMatches.includes(targetTrekkingVariant)
          ) {
            return {
              score: -100,
              accepted: false,
              near_match: false,
              year_match: year ? "missing" : "not_required",
              reason: `mangler riktig Haibike Trekking-variant ${targetTrekkingVariant}`
            };
          }
        }

        const bicycleBadConditionPatterns = [
          /\bnon[- ]?working\b/i,
          /\bnot\s+working\b/i,
          /\bbroken\b/i,
          /\bdamaged\b/i,
          /\bneeds?\s+repair\b/i,
          /\bfor\s+repair\b/i,
          /\brepair\s+project\b/i,
          /\bfor\s+parts\b/i,
          /\bparts\s+only\b/i,
          /\bincomplete\b/i
        ];

        if (bicycleBadConditionPatterns.some(rx => rx.test(t))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "defekt/skadet/til reparasjon"
          };
        }

        const completeBikeWords =
          /\b(bike|bicycle|e-bike|ebike|city bike|mountain bike|mtb|pedelec|fahrrad|elektrofahrrad|sykkel|trekkingrad|trekking e-bike|trekking bike|electric bike)\b/
            .test(t);

        const obviousPartWords =
          /\b(lock|schloss|key|battery|akku|charger|ladegerät|ladegerat|motor|display|sensor|fork|gabel|wheel|laufrad|vorderrad|hinterrad|frame|rahmen|sattel|saddle|seat|pedal|brake|bremse|derailleur|schaltwerk|kassette|abdeckung|deckung|cover|schutz|mudguard|schutzblech|fender|rack|gepäckträger|gepacktrager|kickstand|ständer|staender|chainring|kettenblatt|rotor|disc|laufrad)\b/
            .test(t);

        const batteryPartPattern =
          /\b(e[- ]?bike|ebike)?\s*(akku|battery|batterie)\b.*\b(für|fuer|for|replacement|ersatz|only|nur)\b/
            .test(t) ||
          /\b(akku|battery|batterie)\b.*\b(für|fuer|for)\s+haibike\b/
            .test(t) ||
          /\b(replacement|ersatz)\s+(battery|akku|batterie)\b/
            .test(t);

        if (batteryPartPattern) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "batteri/tilbehør"
          };
        }

        const hardPartTerms = [
          "abdeckung",
          "akku abdeckung",
          "battery cover",
          "battery lock",
          "akku schloss",
          "rahmenschloss",
          "frame lock",
          "cover",
          "gepäckträger",
          "gepacktrager",
          "rack",
          "laufrad",
          "vorderrad",
          "hinterrad",
          "wheel set",
          "wheel only",
          "motor cover",
          "display only",
          "charger",
          "ladegerät",
          "ladegerat",
          "akku only",
          "battery only",
          "akkugehäuse",
          "akku gehäuse",
          "akku gehause",
          "ersatzteil",
          "spare part",
          "replacement part",
          "schutzblech",
          "mudguard",
          "gabel only",
          "fork only",
          "sattel only",
          "saddle only",
          "pedal set",
          "kettenblatt",
          "chainring",
          "schaltwerk",
          "derailleur",
          "bremsrotor",
          "brake rotor",
          "bremsscheibe"
        ];

        if (
          hardPartTerms.some(term =>
            t.includes(term)
          )
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "tydelig sykkeldel/tilbehør"
          };
        }

        if (
          obviousPartWords &&
          !completeBikeWords
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "ikke komplett sykkel"
          };
        }

        if (
          !completeBikeWords &&
          /\b(rahmen|frame|abdeckung|deckung|cover|schutz|laufrad|vorderrad|hinterrad|wheel|gabel|fork|sattel|saddle|rack|gepäckträger|mudguard|schutzblech)\b/
            .test(t)
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "sykkeldel/ramme/hjul"
          };
        }
      }

      /* -------------------------------------------------------
         KONSOLL
         ------------------------------------------------------- */

      if (category === "console") {
        const consolePartTerms = [
          "disc drive",
          "disc-drive",
          "laufwerk",
          "disc reader",
          "controller only",
          "dualsense only",
          "gamepad only",
          "replacement",
          "repair",
          "defekt",
          "broken",
          "for parts",
          "parts only",
          "fan only",
          "power supply",
          "netzteil",
          "stand only",
          "vertical stand",
          "faceplate",
          "cover only"
        ];

        if (
          consolePartTerms.some(term =>
            t.includes(term)
          )
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "konsolldel/tilbehør"
          };
        }

        const targetSlim =
          /\bslim\b/.test(
            `${model} ${type} ${criteria.model}`
          );

        const targetPro =
          /\bpro\b/.test(
            `${model} ${type} ${criteria.model}`
          );

        const listingSlim =
          /\bslim\b/.test(t);

        const listingPro =
          /\bpro\b/.test(t);

        if (
          targetSlim &&
          listingPro
        ) {
          return {
            score: -100,
            accepted: false,
            reason: "PS5 Pro vs Slim"
          };
        }

        if (
          targetPro &&
          listingSlim
        ) {
          return {
            score: -100,
            accepted: false,
            reason: "PS5 Slim vs Pro"
          };
        }

        const targetDisc =
          /\b(disc|blu[ -]?ray|diskstasjon|disk)\b/
            .test(
              `${model} ${type} ${criteria.model}`
            );

        const targetDigital =
          /\b(digital|digital edition)\b/
            .test(
              `${model} ${type} ${criteria.model}`
            );

        const listingDisc =
          /\b(disc|blu[ -]?ray|diskstasjon|disk)\b/
            .test(t);

        const listingDigital =
          /\bdigital\b/.test(t);

        if (
          targetDisc &&
          listingDigital &&
          !listingDisc
        ) {
          return {
            score: -100,
            accepted: false,
            reason: "PS5 Digital vs Disc"
          };
        }

        if (
          targetDigital &&
          listingDisc
        ) {
          return {
            score: -100,
            accepted: false,
            reason: "PS5 Disc vs Digital"
          };
        }
      }

      if (
        /\b(nur|only|just)\b.{0,25}\b(gehäuse|gehause|korpus|body|chassis|case)\b/
          .test(t) ||
        /\b(gehäuse|gehause|korpus|body|chassis|case)\b.{0,25}\b(nur|only|just)\b/
          .test(t) ||
        /\b(ohne|without)\b.{0,25}\b(hals|neck|hardware|elektronik|electronics|pickup)\b/
          .test(t)
      ) {
        return {
          score: -100,
          accepted: false,
          reason: "kun del/hus"
        };
      }

      /* -------------------------------------------------------
         MERKE
         ------------------------------------------------------- */

      if (
        brand &&
        t.includes(brand)
      ) {
        score += 25;
        reasons.push("merke");
      } else if (brand) {
        score -= 30;
      }

      /* -------------------------------------------------------
         MODELL
         ------------------------------------------------------- */

      const modelWords =
        model
          .split(/\s+/)
          .map(w => w.trim())
          .filter(w => w.length >= 3);

      const genericVariantWords =
        new Set([
          "standard",
          "original",
          "classic",
          "vintage",
          "modern",
          "series",
          "serie",
          "model",
          "modell",
          "electric",
          "elektrisk"
        ]);

      const coreModelWords =
        modelWords.filter(
          word =>
            !genericVariantWords.has(
              word.toLowerCase()
            )
        );

      let modelMatches = 0;

      for (const word of coreModelWords) {
        if (
          t.includes(
            word.toLowerCase()
          )
        ) {
          modelMatches++;
        }
      }

      if (
        coreModelWords.length &&
        modelMatches ===
          coreModelWords.length
      ) {
        score += 50;
        reasons.push("kjerne-modell");
      } else if (
        coreModelWords.length &&
        modelMatches >=
          Math.max(
            1,
            Math.ceil(
              coreModelWords.length * 0.6
            )
          )
      ) {
        score += 25;
        reasons.push("delvis kjerne-modell");
      } else if (
        coreModelWords.length
      ) {
        score -= 35;
      }

      const variantWords =
        modelWords.filter(
          word =>
            genericVariantWords.has(
              word.toLowerCase()
            )
        );

      if (
        variantWords.some(word =>
          t.includes(
            word.toLowerCase()
          )
        )
      ) {
        score += 8;
        reasons.push("variant");
      }

      /*
       * V14.23 – GENERIC HARD MODEL/VARIANT GATE
       * -----------------------------------------
       * Prevents generic model scoring from allowing a different
       * product variant into exact comparisons.
       *
       * Distinctive target model anchors must all be present in the
       * listing title/type for generic categories. Existing specialized
       * guitar, bicycle and console gates remain authoritative.
       */
      if (
        category !== "guitar" &&
        category !== "bicycle" &&
        category !== "console"
      ) {
        const genericModelStopWords = new Set([
          "standard",
          "original",
          "classic",
          "vintage",
          "modern",
          "series",
          "serie",
          "model",
          "modell",
          "version",
          "edition",
          "item",
          "product",
          "low",
          "high",
          "mid",
          "shoe",
          "shoes",
          "sneaker",
          "sneakers",
          "trainer",
          "trainers",
          "boot",
          "boots",
          "size",
          "men",
          "mens",
          "women",
          "womens",
          "unisex",
          "new",
          "used",
          "authentic",
          "genuine",
          "special",
          "box"
        ]);

        const genericTypeWords = new Set(
          type
            .split(/\s+/)
            .map(w => w.trim().toLowerCase())
            .filter(w => w.length >= 3)
        );

        const targetModelWords = [
          ...new Set(
            model
              .replace(/&/g, " ")
              .replace(/[^\p{L}\p{N}'-]+/gu, " ")
              .split(/\s+/)
              .map(w => w.trim().toLowerCase())
              .filter(w => w.length >= 4)
              .filter(w => !genericModelStopWords.has(w))
              .filter(w => !genericTypeWords.has(w))
          )
        ];

        const listingTextForVariant =
          `${t} ${type}`.toLowerCase();

        if (!targetModelWords.length) {
          return {
            score: Math.max(0, score),
            accepted: false,
            near_match: true,
            year_match: year ? "missing" : "not_required",
            reason: "modellvariant ikke spesifisert nok",
            variant_match: "insufficient_target_variant"
          };
        }

        const missingDistinctiveTargetWords =
          targetModelWords.filter(word => {
            const escaped =
              word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

            return !new RegExp(
              `\\b${escaped}\\b`,
              "i"
            ).test(listingTextForVariant);
          });

        if (missingDistinctiveTargetWords.length) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason:
              `mangler spesifikk modell/variant: ${missingDistinctiveTargetWords.join(", ")}`,
            variant_match: "rejected_missing_anchor"
          };
        }
      }

      const typeWords =
        type
          .split(/\s+/)
          .filter(w => w.length >= 4);

      if (
        typeWords.some(w =>
          t.includes(w.toLowerCase())
        )
      ) {
        score += 10;
        reasons.push("type");
      }

      /* -------------------------------------------------------
         ALDER
         ------------------------------------------------------- */

      const listingIsKids =
        /\b(kids?|kid|children|child|junior|youth|infant|baby|toddler)\b/
          .test(t);

      const listingIsAdult =
        /\b(adult|adults|men|mens|women|womens|man|woman)\b/
          .test(t);

      if (
        criteria.ageGroup === "adult" &&
        listingIsKids
      ) {
        return {
          score: -100,
          accepted: false,
          reason: "barnemodell"
        };
      }

      if (
        criteria.ageGroup === "kids" &&
        listingIsAdult &&
        !listingIsKids
      ) {
        return {
          score: -100,
          accepted: false,
          reason: "voksenmodell"
        };
      }

      /* -------------------------------------------------------
         BIRKENSTOCK
         ------------------------------------------------------- */

      if (
        brand.includes("birkenstock") &&
        !model.toLowerCase().includes("papillio") &&
        /\bpapillio\b/.test(t)
      ) {
        return {
          score: -100,
          accepted: false,
          reason: "Papillio-linje"
        };
      }

      if (
        brand.includes("birkenstock")
      ) {
        const specialVariantTerms = [
          "big buckle",
          "big-buckle",
          "bigbuckle",
          "eva",
          "essentials",
          "essential",
          "platform",
          "split",
          "soft footbed",
          "soft-footbed",
          "shearling",
          "fur",
          "braided",
          "braid",
          "papillio",
          "kids",
          "kid",
          "junior",
          "youth",
          "microfiber",
          "synthetic"
        ];

        if (
          specialVariantTerms.some(term =>
            t.includes(term)
          )
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year
              ? "missing"
              : "not_required",
            reason: "annen Birkenstock-variant"
          };
        }

        if (variantUncertain) {
          return {
            score: Math.max(score, 50),
            accepted: false,
            near_match: true,
            year_match: "missing",
            reason: "variant ikke bekreftet"
          };
        }

        if (
          /leather|leder|leatherette|velourleder|suede/
            .test(material)
        ) {
          if (
            /\beva\b|synthetic|microfiber/
              .test(t)
          ) {
            return {
              score: -100,
              accepted: false,
              reason: "annet materiale"
            };
          }

          if (
            !/leather|leder|leatherette|velourleder|suede/
              .test(t)
          ) {
            return {
              score: Math.max(score, 50),
              accepted: false,
              near_match: true,
              year_match: year
                ? "missing"
                : "not_required",
              reason: "materiale ikke dokumentert"
            };
          }
        }
      }

      /* -------------------------------------------------------
         LAND / PRODUKSJON
         ------------------------------------------------------- */

      if (country === "mexico") {
        if (
          /\bmexic|\bmim\b|\bmex\b/.test(t)
        ) {
          score += 35;
          reasons.push("Mexico/MIM");
        }

        if (
          /\bamerican\b|\busa\b|\bmade in usa\b/.test(t)
        ) {
          return {
            score: -100,
            accepted: false,
            reason: "USA-modell"
          };
        }
      }

      if (country === "usa") {
        if (
          /\bamerican\b|\busa\b|\bmade in usa\b/.test(t)
        ) {
          score += 30;
          reasons.push("USA");
        }

        if (
          /\bmexic|\bmim\b/.test(t)
        ) {
          return {
            score: -100,
            accepted: false,
            reason: "Mexico-modell"
          };
        }
      }

      /* -------------------------------------------------------
         GITAR – STRENG VARIANTMATCHING V10.5
         -------------------------------------------------------
         År alene er ikke nok for en gitar. Tydelige forskjeller
         som gripebrett og spesial/anniversary-modell skal ikke
         havne i puljen for "eksakte" sammenligninger.
      */
      if (category === "guitar") {
        const listingFingerboard =
          /\b(rosewood|palisander)\b/.test(t)
            ? "rosewood"
            : /\b(maple|lønnet)\b\s*(fingerboard|fretboard|gripebrett)\b/.test(t)
              ? "maple"
              : /\b(fingerboard|fretboard|gripebrett)\b.*\b(maple|lønnet)\b/.test(t)
                ? "maple"
                : null;

        if (criteria.target_fingerboard && listingFingerboard) {
          if (criteria.target_fingerboard === listingFingerboard) {
            score += 8;
            reasons.push("samme gripebrett");
          } else {
            // V11.8: gripebrett/materiale er sekundært. Feil materiale
            // skal ikke kaste ut en ellers riktig modell og årgang.
            score -= 2;
            reasons.push("annet gripebrett");
          }
        }

        const listingSpecial =
          /\b(anniversary|50th ann|50th anniversary|special edition|62['’]? special)\b/.test(t);

        if (!criteria.target_special && listingSpecial) {
          return {
            score: Math.max(0, score - 20),
            accepted: false,
            near_match: true,
            year_match: year ? "missing" : "not_required",
            reason: "spesial/anniversary-variant"
          };
        }

        if (criteria.target_special && listingSpecial) {
          score += 15;
          reasons.push("samme spesialvariant");
        }

        const colorPatterns = {
          black: /\b(black|svart|sort)\b/,
          white: /\b(white|hvit|olympic white)\b/,
          red: /\b(red|rød|candy apple red)\b/,
          blue: /\b(blue|blå|ocean turquoise|lake placid blue)\b/,
          sunburst: /\b(sunburst|sun burst|3[- ]tone sunburst|3ts)\b/,
          olympic_white: /\bolympic white\b/
        };

        if (criteria.target_color) {
          const listingColor = Object.entries(colorPatterns)
            .find(([, pattern]) => pattern.test(t))?.[0] || null;

          if (listingColor && listingColor !== criteria.target_color) {
            // V11.8: farge er sekundær. En annen farge skal ikke
            // ekskludere en ellers korrekt modell/variant/årgang.
            score -= 1;
            reasons.push("annen farge");
          }

          if (listingColor === criteria.target_color) {
            score += 5;
            reasons.push("samme farge");
          }
        }
      }

      /* -------------------------------------------------------
         V11.6 – HARD FENDER-VARIANTGATE
         -------------------------------------------------------
         En vanlig Fender Standard Stratocaster skal aldri få
         prisgrunnlag fra 62/62 Special, Special Edition,
         Anniversary eller andre Fender-serier. Dette er en hard
         avvisning og ikke bare en score-straff.
      */
      if (
        category === "guitar" &&
        /\bfender\b/i.test(String(brand || "")) &&
        /\bstratocaster\b/i.test(String(model || "")) &&
        !targetDrivenFenderVariantAllowed(
          `${brand} ${model} ${criteria.manufacturer || ""} ${criteria.country || ""}`,
          t
        )
      ) {
        return {
          score: -100,
          accepted: false,
          near_match: false,
          year_match: year ? "missing" : "not_required",
          reason: "annen Fender-variant – ekskludert"
        };
      }

      /* -------------------------------------------------------
         ÅR – KRITISK V8-ENDRING
         ------------------------------------------------------- */

      const titleYears =
        extractYears(t);

      let yearMatch =
        "not_required";

      if (year) {
        const exact =
          titleYears.some(
            y => y === year
          );

        const otherYear =
          titleYears.some(
            y => y !== year
          );

        if (exact) {
          score += 40;
          reasons.push("samme år");
          yearMatch = "exact";
        } else if (otherYear) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: "wrong",
            reason: "annet år"
          };
        } else {
          /*
           * V8:
           * Manglende år gir IKKE lenger +5.
           * Det blir kun et nærtreff.
           */
          yearMatch = "missing";
        }
      }

      /* -------------------------------------------------------
         UFORENLIGE SERIER
         ------------------------------------------------------- */

      const incompatibleSeries = [
        "classic 60s",
        "60s",
        "classic series",
        "vintera",
        "player ii",
        "american professional",
        "american ultra",
        "american vintage",
        "performer",
        "elite",
        "deluxe",
        "anniversary",
        "reissue",
        "signature model",
        "jeff beck"
      ];

      for (
        const term of incompatibleSeries
      ) {
        if (
          t.includes(term) &&
          !model
            .toLowerCase()
            .includes(term)
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: yearMatch,
            reason: "annen serie/variant"
          };
        }
      }

      const wrongModelTerms = [
        "american standard",
        "american professional",
        "american ultra",
        "american vintage",
        "player",
        "player ii",
        "vintera",
        "performer",
        "elite",
        "ultra",
        "deluxe",
        "lead iii",
        "squier",
         "squire",
        "telecaster",
        "jazzmaster",
        "jaguar"
      ];

      for (
        const term of wrongModelTerms
      ) {
        if (!t.includes(term)) continue;

        if (
          term === "american standard" &&
          country === "mexico"
        ) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: yearMatch,
            reason: "American Standard"
          };
        }

        score -= 35;
      }

      /*
       * V9:
       * Når konkret år er kjent, skal et treff uten år IKKE være
       * eksakt. Men det kan brukes som sekundær markedsreferanse
       * dersom merke + modell ellers er sterkt nok.
       *
       * Dermed får vi:
       * - samme år = exact
       * - riktig modell, år mangler = same_model
       * - annet år = avvist
       */
      const accepted =
        score >= 45;

      return {
        score,
        accepted,
        near_match:
          yearMatch === "missing" &&
          accepted,
        same_model:
          yearMatch === "missing" &&
          accepted,
        year_match:
          yearMatch,
        reason:
          reasons.join(", ") ||
          "lav relevans",
        variant_match:
          (
            category === "guitar" ||
            category === "bicycle" ||
            category === "console"
          )
            ? "category_gate"
            : "exact"
      };
    }

    async function searchEbaySingle(query, marketplace) {
      const token =
        await getEbayToken();

      if (!token) {
        return {
          enabled: false,
          query,
          marketplace,
          sample_size: 0,
          listings: [],
          rawItems: [],
          reason:
            ebayDiagnosticError?.message ||
            "eBay-tilkobling er ikke tilgjengelig",
          diagnostic:
            ebayDiagnosticError
              ? {
                  stage: ebayDiagnosticError.stage,
                  status: ebayDiagnosticError.status,
                  code: ebayDiagnosticError.code
                }
              : null
        };
      }

      const url =
        "https://api.ebay.com/buy/browse/v1/item_summary/search" +
        `?q=${encodeURIComponent(query)}` +
        "&limit=50";

      const r = await fetchWithTimeout(url, {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${token}`,
          "Accept":
            "application/json",
          "X-EBAY-C-MARKETPLACE-ID":
            marketplace
        }
      }, EBAY_SEARCH_TIMEOUT_MS);

      const d =
        await r.json();

      if (!r.ok) {
        ebayDiagnosticError = {
          stage: "browse_search",
          status: r.status,
          code:
            d?.errors?.[0]?.errorId ||
            d?.errors?.[0]?.domain ||
            "browse_api_error",
          message:
            d?.errors?.[0]?.message ||
            "eBay Browse API-søk feilet."
        };

        return {
          enabled: false,
          query,
          marketplace,
          sample_size: 0,
          listings: [],
          rawItems: [],
          reason: ebayDiagnosticError.message,
          diagnostic: {
            stage: ebayDiagnosticError.stage,
            status: ebayDiagnosticError.status,
            code: ebayDiagnosticError.code
          }
        };
      }

      return {
        enabled: true,
        query,
        marketplace,
        rawItems:
          Array.isArray(d.itemSummaries)
            ? d.itemSummaries
            : []
      };
    }

    async function enrichEbayItem(item, marketplace) {
      const itemId = String(item?.itemId || "").trim();

      if (!itemId) return item;

      const token = await getEbayToken();
      if (!token) return item;

      const detailStartedAt = performance.now();
      let detailTraceRecorded = false;
      timings.ebay_item_details_calls += 1;

      try {
        const url =
          "https://api.ebay.com/buy/browse/v1/item/" +
          encodeURIComponent(itemId);

        const r = await fetchWithTimeout(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "X-EBAY-C-MARKETPLACE-ID": marketplace
          }
        }, EBAY_ITEM_DETAILS_TIMEOUT_MS);

        if (!r.ok) {
          timings.ebay_item_details_failed += 1;
          timings.ebay_item_details_trace.push({
            item_id: itemId,
            marketplace,
            ok: false,
            status: r.status,
            ms: Math.round(performance.now() - detailStartedAt)
          });
          detailTraceRecorded = true;
          return item;
        }

        const detail = await r.json();

        // Browse item-details kan inneholde strukturerte aspekter som
        // ikke følger med i item_summary. Disse er spesielt viktige for
        // år, farge, gripebrett og modellvariant. eBay dokumenterer at
        // getItem kan brukes for komplette item-detaljer/aspekter.
        const aspects = [
          ...(Array.isArray(detail?.localizedAspects)
            ? detail.localizedAspects
            : []),
          ...(Array.isArray(detail?.inferredLocalizedAspects)
            ? detail.inferredLocalizedAspects
            : [])
        ];

        const aspectText = [];
        const aspectMap = {};

        for (const aspect of aspects) {
          const name = String(aspect?.name || "").trim();
          const valueRaw = aspect?.value;
          const values = Array.isArray(valueRaw)
            ? valueRaw
            : [valueRaw];

          const cleanValues = values
            .map(v => String(v ?? "").trim())
            .filter(Boolean);

          if (!name || !cleanValues.length) continue;

          const key = name.toLowerCase();
          if (!aspectMap[key]) aspectMap[key] = [];
          aspectMap[key].push(...cleanValues);

          // Bare, selektiv aspekttekst. Vi tar ikke med alle aspekter
          // fordi f.eks. "Pickup" ellers kan bli feiltolket som en del.
          if (
            /year|manufactured|production|fretboard|fingerboard|\bboard\b|color|colour|finish|model|series|country|region|brand|type|body color|body colour/i.test(name)
          ) {
            aspectText.push(`${name}: ${cleanValues.join(", ")}`);
          }
        }

        const enriched = {
          ...item,
          _ebay_detail_loaded: true,
          _ebay_aspects: aspectMap,
          _ebay_aspect_text: aspectText.join(" | "),
          _ebay_description: String(detail?.description || detail?.shortDescription || "")
        };

        return enriched;
      } catch (error) {
        timings.ebay_item_details_failed += 1;
        timings.ebay_item_details_trace.push({
          item_id: itemId,
          marketplace,
          ok: false,
          status: null,
          error: String(error?.message || "item-details fetch failed").slice(0, 160),
          ms: Math.round(performance.now() - detailStartedAt)
        });
        detailTraceRecorded = true;
        return item;
      } finally {
        const elapsed = Math.round(performance.now() - detailStartedAt);
        timings.ebay_item_details_total_call_ms += elapsed;
        timings.ebay_item_details_slowest_ms = Math.max(
          timings.ebay_item_details_slowest_ms,
          elapsed
        );
        if (!detailTraceRecorded) {
          timings.ebay_item_details_trace.push({
            item_id: itemId,
            marketplace,
            ok: true,
            ms: elapsed
          });
        }
      }
    }

    function targetDrivenFenderVariantAllowed(targetText, listingText) {
      const target = String(targetText || "").toLowerCase();
      const listing = String(listingText || "").toLowerCase();
      if (!/\bfender\b/.test(target) || !/\bstratocaster\b/.test(target)) return true;
      const families = [
        [/\bsqu(?:ier|ire)(?:\s+by\s+fender)?(?:\s+series)?\b/, /\bsqu(?:ier|ire)/],
        [/\bfsr\b|\bfender\s+special\s+run\b|\bspecial\s+run\b/, /\bfsr\b|\bspecial\s+run\b/],
        [/\b62\s*(?:['’]s?|special)\b/, /\b62\s*(?:['’]s?|special)\b/],
        [/\b(?:50th\s+anniversary|anniversary)\b/, /\b(?:50th\s+anniversary|anniversary)\b/],
        [/\bspecial(?:\s+edition)?\b/, /\bspecial(?:\s+edition)?\b/],
        [/\blimited\s+edition\b/, /\blimited\s+edition\b/],
        [/\bvintage\s+reissue\b|\breissue\b/, /\bvintage\s+reissue\b|\breissue\b/],
        [/\bplayer\s*(?:ii|2)\b/, /\bplayer\s*(?:ii|2)\b/],
        [/\bplayer\b(?!\s*(?:ii|2)\b)/, /\bplayer\b(?!\s*(?:ii|2)\b)/],
        [/\bvintera\b/, /\bvintera\b/],
        [/\bclassic\s+series\b/, /\bclassic\s+series\b/],
        [/\b(?:60s|classic\s+60s)\b/, /\b(?:60s|classic\s+60s)\b/],
        [/\bsignature(?:\s+series|\s+model)?\b|\bjeff\s+beck\b/, /\bsignature(?:\s+series|\s+model)?\b|\bjeff\s+beck\b/],
        [/\bamerican\s+professional\s+ii\b|\bprofessional\s+ii\b/, /\bamerican\s+professional\s+ii\b|\bprofessional\s+ii\b/],
        [/\bamerican\s+professional\b(?!\s+ii\b)/, /\bamerican\s+professional\b(?!\s+ii\b)/],
        [/\bamerican\s+ultra\b|\bultra\b/, /\bamerican\s+ultra\b|\bultra\b/],
        [/\bamerican\s+standard\b/, /\bamerican\s+standard\b/],
        [/\bamerican\s+performer\b/, /\bamerican\s+performer\b/],
        [/\bamerican\s+(?:original|vintage)\b/, /\bamerican\s+(?:original|vintage)\b/]
      ];
      for (const [listingRx, targetRx] of families) {
        const listingHas = listingRx.test(listing);
        const targetHas = targetRx.test(target);
        if (listingHas !== targetHas) return false;
      }
      return true;
    }

    async function prepareListing(
      item,
      query,
      criteria
    ) {
      const originalPrice =
        Number(item?.price?.value);

      const currency =
        item?.price?.currency;

      if (
        !Number.isFinite(originalPrice) ||
        !currency
      ) {
        return null;
      }

      const title =
        item.title || "";

      // Bruk strukturerte eBay-aspekter i relevanskontrollen når de finnes.
      // Dette gjør at et "Year Manufactured = 1995" kan gi ekte årstreff
      // selv om 1995 ikke står i annonsetittelen.
      const scoringText =
        `${title} ${item._ebay_aspect_text || ""}`.trim();

      /*
       * V11.4: HARD CONDITION FILTER
       * -----------------------------
       * Some eBay results can slip through the normal relevance scorer
       * even when the title clearly says that the instrument is junk,
       * untested, broken or sold for repair. Such listings must NEVER
       * enter the valuation pool for a complete working object.
       */
      if (criteria.category === "guitar") {
        const hardBadConditionPatterns = [
          /\bjunk\b/i,
          /\buntested\b/i,
          /\bnot\s+tested\b/i,
          /\bno\s+testing\b/i,
          /\bno\s+test\b/i,
          /\bnot\s+working\b/i,
          /\bnon[- ]?working\b/i,
          /\bbroken\b/i,
          /\bneeds?\s+repair\b/i,
          /\bfor\s+repair\b/i,
          /\brepair\s+project\b/i,
          /\bproject\s+guitar\b/i,
          /\bfor\s+parts\b/i,
          /\bparts\s+only\b/i,
          /\bas[- ]?is\b/i,
          /\bincomplete\b/i,
          /\bmissing\s+parts\b/i,
          /\bdamaged\b/i,
          /\buntested\s+condition\b/i
        ];

        if (hardBadConditionPatterns.some(pattern => pattern.test(scoringText))) {
          return null;
        }
      }

      const relevance =
        scoreListing(
          scoringText,
          criteria
        );

      /*
       * V12.1 – ABSOLUTT FENDER STANDARD-GATE
       * ---------------------------------------
       * Siste sikkerhetsnett etter scoreListing().
       *
       * Problemet i tidligere versjoner var at AI/eBay noen ganger
       * ikke satte criteria.brand/model helt rent. Da kunne f.eks.
       * "Squier Series", "FSR" eller "62 Special" slippe gjennom
       * selv om målet var en vanlig Fender Standard Stratocaster MIM.
       *
       * Når målet tydelig er Fender Stratocaster Made in Mexico og
       * ikke selv er en spesialvariant, skal disse variantene fjernes
       * fullstendig – både fra exact, same_model og nærmeste referanser.
       */
      const targetIdentityText =
        `${criteria.brand || ""} ${criteria.manufacturer || ""} ${criteria.model || ""} ${criteria.type || ""} ${criteria.country || ""} ${criteria.user_model_hint || ""}`
          .toLowerCase();

      const targetIsFenderStratMim =
        /\bfender\b/.test(targetIdentityText) &&
        /\bstratocaster\b/.test(targetIdentityText) &&
        /\b(?:made in mexico|mexico|mim)\b/.test(targetIdentityText);

      if (
        criteria.category === "guitar" &&
        targetIsFenderStratMim &&
        !targetDrivenFenderVariantAllowed(
          targetIdentityText,
          scoringText
        )
      ) {
        return null;
      }

      // V15.3: årsevidens: title -> eBay aspects -> description.
      let exact_year_evidence = "unknown";
      let year_evidence_blocked = false;
      if (criteria.year) {
        const targetYear = Number(criteria.year);
        for (const source of [
          { level: "title_exact", text: title },
          { level: "aspect_exact", text: item._ebay_aspect_text || "" },
          { level: "description_exact", text: item._ebay_description || "" }
        ]) {
          const years = extractYears(source.text);
          if (years.includes(targetYear)) { exact_year_evidence = source.level; break; }
          if (years.length) { year_evidence_blocked = true; break; }
        }
      }

      // V15.3: målår kan dokumenteres i title, eBay aspects eller description.
      if (criteria.year) {
        if (year_evidence_blocked) return null;
        if (exact_year_evidence === "unknown") {
          relevance.year_match = "missing";
          relevance.accepted = relevance.accepted || relevance.near_match;
          relevance.near_match = relevance.accepted;
          relevance.same_model = relevance.accepted;
        } else {
          relevance.year_match = "exact";
        }
      }

      if (
        !relevance.accepted &&
        !relevance.near_match
      ) {
        return null;
      }

      /*
       * V11.4: STRATOCaster-VARIANTFILTER
       * --------------------------------
       * "Stratocaster" alene er for bredt. Player II, Vintera,
       * Special/Limited Edition, Squier osv. kan ellers bli telt som
       * eksakte treff selv om objektet er en eldre Standard MIM.
       */
      if (
        criteria.category === "guitar" &&
        /^fender$/i.test(String(criteria.brand || "")) &&
        /\bstratocaster\b/i.test(String(criteria.model || ""))
      ) {
        const lowerTitle = scoringText.toLowerCase();

        const incompatibleVariantPatterns = [
          /\bsqu(?:ier|ire)\b/,
          /\bplayer\s*(ii|2)\b/,
          /\bvintera\b/,
          /\bamerican\s+(professional|performer|ultra|standard|original)\b/,
          /\bamerican\s+stratocaster\b/,
          /\bamerican\s+professional\b/,
          /\bprofessional\s+ii\b/,
          /\bprofessional\b/,
          /\bultra\b/,
          /\bvintage\s+ii\b/,
          /\bspecial\s+edition\b/,
          /\blimited\s+edition\b/,
          /\bredline\b/,
          /\bsignature(?:\s+series|\s+model)?\b/,
          /\bdeluxe\s+stratocaster\b/,
          /\bclassic\s+vibe\b/,
          /\baffinity\s+strat\b/,
          /\bbullet\s+strat\b/,
          /\bjapan\b/,
          /\bmi[j]?\b.*\bstratocaster\b/
        ];

        if (
          incompatibleVariantPatterns.some(
            pattern => pattern.test(lowerTitle)
          )
        ) {
          return null;
        }

        const hasCompleteGuitarWord =
          /\b(electric\s+guitar|guitar|gitar|stratocaster)\b/
            .test(lowerTitle);

        if (!hasCompleteGuitarWord) {
          return null;
        }
      }

      const rate =
        await getExchangeRate(
          currency,
          "NOK"
        );

      if (!rate) return null;

      const nok =
        originalPrice * rate;

      if (
        !Number.isFinite(nok) ||
        nok <= 0
      ) {
        return null;
      }

      // Svært lave gitarpriser er ofte deler, tilbehør eller defekte
      // instrumenter som har sneket seg gjennom eBays søkerelevans.
      // De skal ikke få påvirke verdien av en komplett fungerende gitar.
      if (criteria.category === "guitar") {
        const isFenderStrat =
          /^fender$/i.test(String(criteria.brand || "")) &&
          /\bstratocaster\b/i.test(String(criteria.model || ""));

        const minimumGuitarComparable =
          isFenderStrat && criteria.year
            ? 2000
            : 1200;

        if (nok < minimumGuitarComparable) {
          return null;
        }
      }

      /*
       * V9:
       * Treff uten dokumentert år blir "same_model", ikke "exact".
       * De kan brukes som sekundært prisgrunnlag når år er kjent,
       * men får lavere vekt enn eksakte årstreff.
       */
      let matchTier = "near";
      let valuationTier = "near";

      if (relevance.accepted) {
        // V11.8 HARD TITLE-YEAR GATE:
        // Når målobjektet har et konkret år, kan en annonse bare være
        // "exact" dersom samme år faktisk finnes i annonsens tittel.
        // Manglende år er alltid same_model og skal aldri havne i
        // exact_listings eller i hovedverdigrunnlaget.
        if (criteria.year) {
          if (relevance.year_match === "exact") {
            matchTier = "exact";
            valuationTier = "exact";
          } else if (relevance.year_match === "missing") {
            matchTier = "same_model";
            valuationTier = "same_model";
          } else {
            matchTier = "near";
            valuationTier = "near";
          }
        } else {
          matchTier = "exact";
          valuationTier = "exact";
        }
      }

      // V12.4: dersom søket eksplisitt er Fender Stratocaster Made in Mexico,
      // skal kjente konkurrerende varianter aldri kunne passere som exact.
      // Dette er uavhengig av AI-klassifiseringen i criteria.
      const hardQueryText = String(query || "").toLowerCase();
      const hardTargetFromQuery =
        /\bfender\b/.test(hardQueryText) &&
        /\bstratocaster\b/.test(hardQueryText) &&
        /\b(?:mexico|mim|made in mexico)\b/.test(hardQueryText);

      if (hardTargetFromQuery && !targetDrivenFenderVariantAllowed(
        `${criteria.brand || ""} ${criteria.model || ""} ${criteria.manufacturer || ""} ${criteria.country || ""}`,
        String(title || "")
      )) {
        return null;
      }

      return {
        title,
        price: {
          value: originalPrice,
          currency
        },
        nok: Math.round(nok),
        url:
          item.itemWebUrl || "",
        item_id:
          item.itemId ||
          "",
        seller: String(item?.seller?.username || item?.seller?.sellerAccount || "").trim(),
        exact_year_evidence,
        query,
        marketplace: criteria.marketplace || "EBAY_UNKNOWN",
        relevance_score:
          relevance.score,
        relevance_reason:
          relevance.reason,
        year_match:
          relevance.year_match ||
          "not_required",
        variant_match:
          relevance.variant_match ||
          "exact",
        match_tier:
          matchTier,
        valuation_tier:
          valuationTier
      };
    }

    /* ---------------------------------------------------------
       V12.2 – FINAL FENDER COMPARABLE GATE
       ---------------------------------------------------------
       Dette filteret ligger helt etter eBay-resultatet og før annonsen
       får lov til å bli en markedsreferanse. Det er med vilje uavhengig
       av scoreListing(), slik at en feil eller uklar AI-klassifisering
       ikke kan slippe en Squier/FSR/Special inn i prisgrunnlaget.
    */
    function isHardIncompatibleFenderComparable(title, aspectText, criteria) {
      if (criteria?.category !== "guitar") return false;

      const identity =
        `${criteria?.brand || ""} ${criteria?.model || ""} ${criteria?.country || ""} ${criteria?.manufacturer || ""} ${criteria?.user_model_hint || ""}`
          .toLowerCase();
      const queryContext = String(criteria?.query_context || "").toLowerCase();
      const isFenderStratMim =
        (
          /\bfender\b/.test(identity) &&
          /\bstratocaster\b/.test(identity) &&
          /\b(?:mexico|mim|made in mexico)\b/.test(identity)
        ) ||
        (
          /\bfender\b/.test(queryContext) &&
          /\bstratocaster\b/.test(queryContext) &&
          /\b(?:mexico|mim|made in mexico)\b/.test(queryContext)
        );

      if (!isFenderStratMim) return false;

      const text = `${title || ""} ${aspectText || ""}`.toLowerCase();
      const targetText = `${identity} ${queryContext}`;
      return !targetDrivenFenderVariantAllowed(targetText, text);
    }

    async function searchEbay(parsed) {
      const built =
        buildStrictQueries(parsed);

      if (!built.queries.length) {
        return {
          enabled: false,
          reason:
            "Ingen egnet eBay-søkestreng",
          queries: [],
          successful_queries: []
        };
      }

      /*
       * V10.4: Søk i flere eBay-markeder.
       * EBAY_NO er viktig for norske priser, mens US/GB/DE
       * gir ekstra dekning når det er få norske treff.
       */
      /*
       * eBay Browse API støtter ikke EBAY_NO som Browse-marketplace.
       * Vi bruker derfor de støttede markedene DE/GB/US her. Norge kan
       * fortsatt dekkes av internasjonale annonser, og FINN blir senere
       * den norske kilden når legitim FINN/API-tilgang er på plass.
       */
      const marketplaces = [
        "EBAY_DE",
        "EBAY_GB",
        "EBAY_US"
      ];

      /*
       * V11.3: DETERMINISTISK MARKEDSSØK
       * --------------------------------
       * AI kan formulere litt forskjellige eBay-søk for samme objekt.
       * Det gjorde at identisk Fender-bilde kunne gi helt forskjellige
       * markedsutvalg. For kjente Fender Stratocaster/MIM-år bruker vi
       * derfor et fast sett med søk og kombinerer resultatene etterpå.
       */
      let searchQueries =
        built.discovery_queries?.length
          ? built.discovery_queries
          : built.queries;

      if (
        built.category === "guitar" &&
        /^fender$/i.test(String(built.brand || "")) &&
        /\bstratocaster\b/i.test(String(built.model || "")) &&
        built.year
      ) {
        searchQueries = [
          `Fender Standard Stratocaster Mexico ${built.year}`,
          `Fender Stratocaster ${built.year} Mexico`,
          `Fender Stratocaster MIM ${built.year}`,
          `Fender Stratocaster Made in Mexico ${built.year}`
        ];
      }

      searchQueries = [
        ...new Set(
          searchQueries
            .map(q => compact(q, 10))
            .filter(Boolean)
        )
      ].slice(0, 4);

      const searchJobs = [];

      for (const marketplace of marketplaces) {
        for (const q of searchQueries) {
          searchJobs.push({ marketplace, query: q });
        }
      }

      const ebaySearchStartedAt = performance.now();
      const results =
        await Promise.all(
          searchJobs.map(
            async job => {
              try {
                return await searchEbaySingle(
                  job.query,
                  job.marketplace
                );
              } catch (error) {
   const message =
     error?.message ||
     "Ukjent feil i eBay-søk.";

   ebayDiagnosticError = {
     stage: "search_exception",
     status: error?.status ?? null,
     code: error?.code || "search_exception",
     message: String(message).slice(0, 300)
   };

   return {
     enabled: false,
     query: job.query,
     marketplace: job.marketplace,
     rawItems: [],
     reason: ebayDiagnosticError.message,
     diagnostic: {
       stage: ebayDiagnosticError.stage,
       status: ebayDiagnosticError.status,
       code: ebayDiagnosticError.code
     }
   };
 }
            }
          )
        );
      timings.ebay_search_ms = Math.round(
        performance.now() - ebaySearchStartedAt
      );

      /*
       * eBay item_summary gir ikke alltid år/variant i selve søkeresultatet.
       * Før verdiberegningen henter vi derfor detaljer for de mest lovende
       * kandidatene per marked. Dette er spesielt viktig for eldre varer,
       * der "Year Manufactured" ofte ligger som et item aspect og ikke i tittelen.
       */
      const ebayItemDetailsStartedAt = performance.now();
      const preparedNested =
        await Promise.all(
          results.map(
            async result => {
              if (!result?.enabled) {
                return [];
              }

              const rawItems =
                Array.isArray(result.rawItems)
                  ? result.rawItems
                  : [];

              const ranked = rawItems
                .map(item => {
                  const title = String(item?.title || "");
                  const years = extractYears(title.toLowerCase());
                  const hasTargetYear = built.year
                    ? years.includes(built.year)
                    : false;
                  const hasWrongYear = built.year
                    ? years.some(y => y !== built.year)
                    : false;

                  let score = scoreListing(
                    title,
                    { ...built, marketplace: result.marketplace }
                  ).score;

                  // Kandidater uten år er verdifulle i v10.7 fordi år kan
                  // ligge i eBays strukturerte aspekter. Gi dem derfor nok
                  // prioritet til at getItem faktisk får sjansen til å finne år.
                  if (built.year && !hasTargetYear && !hasWrongYear) {
                    score += 15;
                  }

                  return { item, score, hasTargetYear, hasWrongYear };
                })
                .filter(x => !x.hasWrongYear)
                .sort((a, b) => {
                  if (b.hasTargetYear !== a.hasTargetYear) {
                    return Number(b.hasTargetYear) - Number(a.hasTargetYear);
                  }
                  return b.score - a.score;
                });

              // V10.7: hent detaljer bredere enn før. Vi trenger ikke bare
              // de 10 beste titlene; vi må også undersøke kandidater der
              // produksjonsåret mangler i tittelen.
              const detailIds = new Set(
                ranked
                  .filter(x => x.item?.itemId && x.score >= 20)
                  .slice(0, 15)
                  .map(x => String(x.item.itemId))
              );

              const enrichedItems =
                await Promise.all(
                  rawItems.map(async item => {
                    if (!detailIds.has(String(item?.itemId || ""))) {
                      return item;
                    }
                    return enrichEbayItem(
                      item,
                      result.marketplace
                    );
                  })
                );

              const list = [];

              for (const item of enrichedItems) {
                const prepared =
                  await prepareListing(
                    item,
                    result.query,
                    { ...built, marketplace: result.marketplace }
                  );

                if (prepared) {
                  // V12.2: siste, uavhengige sikkerhetsnett.
                  // Squier/FSR/Special/62 osv. skal ikke eksistere i
                  // exact, same-model eller nærtreff når målet er en
                  // vanlig Fender Stratocaster Made in Mexico.
                  if (isHardIncompatibleFenderComparable(
                    prepared.title,
                    item?._ebay_aspect_text || "",
                    { ...built, marketplace: result.marketplace, query_context: result.query }
                  )) {
                    continue;
                  }

                  list.push(prepared);
                }
              }

              return list;
            }
          )
        );
      timings.ebay_item_details_ms = Math.round(
        performance.now() - ebayItemDetailsStartedAt
      );

      const all = [];
      const seen = new Set();

      for (
        const list of preparedNested
      ) {
        for (
          const item of list
        ) {
          const key =
            String(
              item.item_id ||
              item.url ||
              `${String(item.title || "").trim()}|${Math.round(Number(item.nok) || 0)}|${String(item.seller || "").trim()}`
            )
              .trim()
              .toLowerCase();

          if (
            !key ||
            seen.has(key)
          ) {
            continue;
          }

          seen.add(key);

          // V12.2: siste sikkerhetsnett før noen markedsdata kan brukes.
          if (isHardIncompatibleFenderComparable(
            item.title,
            item._ebay_aspect_text || "",
            { ...built, query_context: built.queries.join(" | ") }
          )) {
            continue;
          }

          all.push(item);
        }
      }

      all.sort(
        (a, b) => {
          if (
            b.relevance_score !==
            a.relevance_score
          ) {
            return (
              b.relevance_score -
              a.relevance_score
            );
          }

          return a.nok - b.nok;
        }
      );

      /*
       * V8:
       *
       * exact = komplett godkjent treff
       * near  = nyttig visning, men IKKE prisgrunnlag
       *
       * Hvis år finnes:
       * exact må ha year_match === exact.
       *
       * Hvis år ikke finnes:
       * exact kan brukes.
       */

      // V12.5: ABSOLUTT SISTE FENDER-GATE.
      // Eksakte referanser skal aldri kunne vise en inkompatibel Fender-variant.
      // Denne filtreringen skjer direkte på `all`, rett før exactPool bygges.
      const builtQueryText =
        Array.isArray(built.queries)
          ? built.queries.join(" | ")
          : String(built.queries || "");

      /*
       * V14.13 – DETERMINISTISK FENDER MIM TARGET-GATE
       * ------------------------------------------------
       * Når selve eBay-søkestrengen entydig beskriver Fender +
       * Stratocaster + Mexico/MIM + år, skal den harde Fender-variantgaten
       * aktiveres uavhengig av hvordan AI-en fylte de strukturerte feltene.
       * Dette er viktig fordi et manglende "Mexico" i ett AI-felt tidligere
       * kunne deaktivere gaten og la Squier slippe inn i exactPool.
       *
       * Søket er kun et sikkerhetssignal for MÅLIDENTITETEN. Det brukes ikke
       * til å gjøre en annen variant tillatt.
       */
      const deterministicFenderMimTarget =
        /\bfender\b/i.test(builtQueryText) &&
        /\bstratocaster\b/i.test(builtQueryText) &&
        /\b(?:mexico|mim|made\s+in\s+mexico)\b/i.test(builtQueryText) &&
        /\b(?:19|20)\d{2}\b/.test(builtQueryText);

      /*
       * V14.14 – FIX INITIALIZATION ORDER
       * ----------------------------------
       * V14.13 brukte normalFenderMimQuery før const-variabelen var
       * initialisert. Det ga ReferenceError / Temporal Dead Zone og
       * stoppet hele eBay-søket. Vi beregner derfor hardFenderMimTarget
       * først etter at normalFenderMimQuery er opprettet nedenfor.
       */

      // V12.5: Ikke stol på søketeksten alene. En Fender MIM Stratocaster
      // med kjent år skal ha samme harde variantgate selv om AI/eBay-
      // metadata mangler "Mexico" i ett av feltene.
      // V12.6: bruk selve markedssøket som siste sikkerhetssignal.
      // Tidligere var denne gaten avhengig av built.category/brand/model.
      // Hvis AI-en satte category feil eller feltene var tomme, kunne Squier
      // derfor slippe gjennom selv om søket tydelig var Fender Stratocaster
      // Mexico. Query-teksten er nå tilstrekkelig til å aktivere hardgaten.
      /*
       * V14.9:
       * Den tidligere gaten var avhengig av built.queries. Det er feil
       * lag å bruke som identitetsgrunnlag fordi discovery-/søketeksten
       * kan være annerledes enn de strukturerte målobjektfeltene.
       *
       * Bruk de strukturerte feltene som allerede ble brukt til å bygge
       * markedssøket: brand + model + year + country.
       */
      const structuredTargetText =
        String(
          [
            built.brand,
            built.model,
            built.type,
            built.manufacturer,
            parsed.name,
            info.year_or_period
          ]
            .filter(Boolean)
            .join(" ")
        ).toLowerCase();

      const structuredTargetYear =
        Number(built.year || built.detected_year || 0);

      const structuredTargetCountry =
        String(
          [
            built.country,
            info.year_or_period,
            info.manufacturer,
            parsed.name
          ]
            .filter(Boolean)
            .join(" ")
        ).toLowerCase();

      const targetIsSquier =
        /\bsqu(?:ier|ire)(?:\s+series)?\b/i.test(structuredTargetText);

      /*
       * V14.12: normal Fender MIM-target skal identifiseres robust.
       * Tidligere brukte vi /^fender$/ på brand-feltet. Hvis AI-en svarte
       * f.eks. "Fender Musical Instruments", ble hardgaten deaktivert og
       * et Squier-treff kunne slippe gjennom. Brand-feltet er nå tokenbasert,
       * mens identiteten fortsatt krever Stratocaster + år + Mexico/MIM.
       */
      const targetIsFender =
        /\bfender\b/i.test(String(built.brand || "")) &&
        !targetIsSquier;

      const normalFenderMimQuery =
        targetIsFender &&
        /\bstratocaster\b/i.test(structuredTargetText) &&
        structuredTargetYear >= 1900 &&
        structuredTargetYear <= 2100 &&
        /\b(?:mexico|mim|made\s+in\s+mexico)\b/i.test(
          `${structuredTargetText} ${structuredTargetCountry}`
        );

      const hardFenderMimTarget =
        Boolean(normalFenderMimQuery || deterministicFenderMimTarget);


      /*
       * V14.18 – FELLES FENDER/SQUIER BRAND-GATE
       * -----------------------------------------
       * Fender og Squier deler produktnavn som Stratocaster og Telecaster,
       * men skal aldri behandles som samme merke i markedsverdien.
       *
       * Denne gaten skal brukes på ALLE markeds-pooler, ikke bare
       * normalFenderMimQuery. Den er bevisst basert på målidentiteten
       * og selve annonsedataene, slik at en Squier-annonse ikke kan
       * påvirke exact, same-model, valuation eller kuppberegning.
       */
      const targetBrandText = String(
        [
          built.brand,
          built.manufacturer,
          itemInfo?.brand,
          itemInfo?.manufacturer,
          parsed?.name
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();

      const targetIsSquierBrand =
        /\bsqu(?:ier|ire)(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(targetBrandText);

      const targetIsFenderBrand =
        /\bfender\b/i.test(targetBrandText) &&
        !targetIsSquierBrand;

      function passesFenderSquierBrandGate(item) {
        // V14.19: Produktmerke skal bestemmes fra strukturerte
        // brand/manufacturer-felter og selve tittelen. Fritekst/aspekter
        // kan inneholde omtaler som "not Squier" eller "Squier comparison"
        // og skal derfor ikke alene gjøre en ekte Fender til Squier.
        const structuredBrandText = String(
          [item?.brand, item?.manufacturer]
            .filter(Boolean)
            .join(" ")
        );

        const titleText = String(item?.title || "");

        const structuredIsSquier =
          /\bsqu(?:ier|ire)(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(structuredBrandText);
        const structuredIsFender =
          /\bfender\b/i.test(structuredBrandText) &&
          !structuredIsSquier;

        // Tittelen brukes som produktidentitet når metadata mangler.
        // Negative/omtaleformuleringer skal ikke telle som merke.
        const positiveSquierTitle =
          /\bsqu(?:ier|ire)(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(titleText) &&
          !/\b(?:not|no|without|ikke|versus|vs\.?|comparison|compare|replacement|compatible|for)\s+squ(?:ier|ire)\b/i.test(titleText);

        const positiveFenderTitle =
          /\bfender\b/i.test(titleText) &&
          !/\b(?:not|no|without|ikke|versus|vs\.?|comparison|compare|replacement|compatible|for)\s+fender\b/i.test(titleText);

        const listingIsSquier =
          structuredIsSquier || (!structuredIsFender && positiveSquierTitle);
        const listingIsFender =
          structuredIsFender || (!structuredIsSquier && positiveFenderTitle);

        if (targetIsFenderBrand && listingIsSquier) return false;
        if (targetIsSquierBrand && listingIsFender) return false;

        return true;
      }


      if (normalFenderMimQuery) {
        for (let i = all.length - 1; i >= 0; i--) {
          const listingTitle = String(all[i]?.title || "");
          const listingAspects = String(all[i]?._ebay_aspect_text || "");
          if (!targetDrivenFenderVariantAllowed(structuredTargetText, `${listingTitle} ${listingAspects}`)) {
            all.splice(i, 1);
          }
        }
      }

      // V14.19: brand-gate gjelder uansett om MIM-gaten er aktiv.
      // Dette er første felles sikkerhetsnett mot Fender <-> Squier-miks.
      for (let i = all.length - 1; i >= 0; i--) {
        if (!passesFenderSquierBrandGate(all[i])) {
          all.splice(i, 1);
        }
      }

      const rawExactPool =
        all.filter(
          x =>
            passesFenderSquierBrandGate(x) &&
            x.match_tier === "exact" &&
            // V12.5: Siste uavhengige tittelkontroll før prisgrunnlaget.
            // Denne kjører selv om en tidligere AI-score skulle ha feilklassifisert treffet.
            !(
              hardFenderMimTarget &&
              !targetDrivenFenderVariantAllowed(structuredTargetText, `${String(x.title || "")} ${String(x._ebay_aspect_text || "")}`)
            ) &&
            x.relevance_score >= 45 &&
            // V11.8 HARD TITLE-YEAR GATE: kjent år krever dokumentert
            // samme år i annonsen. Ingen fallback til manglende år.
            (!built.year || x.year_match === "exact")
        );

      // Ekstra sikkerhetskontroll før prisberegning og visning.
      // Dette gjør at en annonse uten år aldri kan bli med i exactPool
      // selv om et senere steg skulle endre match_tier.
      /*
       * V13.6 – HARD MODELLNUMMER-GATE
       * -------------------------------
       * Når Kistefunn kjenner en spesifikk modellreferanse, f.eks.
       * Patek Philippe 5308G-001, er merke + serie ikke nok.
       *
       * 5308G-001 skal ikke sammenlignes med 5304/301R-001,
       * 5204/1R-001, 5905/1A001 osv.
       *
       * Vi normaliserer bindestrek, skråstrek og mellomrom slik at
       * 5308G-001 / 5308G 001 / 5308G001 behandles som samme referanse.
       * Hvis modellen ikke har en tydelig spesifikk modellkode, brukes
       * den eksisterende exact-logikken uendret.
       */
      function normalizeModelCode(value) {
        return String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
      }

      const targetModelCandidates = [
        built.model,
        built.user_model_hint,
        built.model_number,
        built.reference,
        parsed?.model
      ]
        .map(v => String(v || "").trim())
        .filter(Boolean);

      const targetModelCode =
        targetModelCandidates
          .map(normalizeModelCode)
          .find(code =>
            code.length >= 4 &&
            /[a-z]/i.test(code) &&
            /\d/.test(code)
          ) || "";

      const modelCodeExactPool =
        targetModelCode
          ? rawExactPool.filter(x => {
              const listingText =
                normalizeModelCode(
                  `${x.title || ""} ${x._ebay_aspect_text || ""}`
                );
              return listingText.includes(targetModelCode);
            })
          : rawExactPool;

      const strictExactPool =
        built.year
          ? modelCodeExactPool.filter(x =>
              x.year_match === "exact" &&
              ["title_exact", "aspect_exact", "description_exact"].includes(String(x.exact_year_evidence || ""))
            )
          : modelCodeExactPool;

      /*
       * V11.1: stabiliser eksakte markedsreferanser.
       * eBay kan returnere svært ulike resultater fra samme søk mellom
       * kjøringer, og enkelte aktive annonser kan ha åpenbare prisavvik.
       * Vi bruker derfor et konservativt IQR-filter på eksakte treff når
       * vi har nok observasjoner. Ved færre enn 7 treff beholder vi alle
       * treff slik at vi ikke kaster bort verdifulle små utvalg.
       */
      /*
       * V11.3: BALANSERING MELLOM SØK
       * ------------------------------
       * Ett eBay-søk kan noen ganger returnere svært mange treff mens
       * et annet søk gir få. Uten balansering kan ett søk dermed dominere
       * medianen. Vi tar derfor maks 6 sterke eksakte treff per søk.
       */
      function balanceByQuery(items, maxPerQuery = 6) {
        const groups = new Map();

        for (const item of items) {
          const key =
            String(item.query || "")
              .trim()
              .toLowerCase();

          if (!groups.has(key)) {
            groups.set(key, []);
          }

          groups.get(key).push(item);
        }

        const balanced = [];

        for (const group of groups.values()) {
          group
            .sort(
              (a, b) =>
                (b.relevance_score || 0) -
                (a.relevance_score || 0)
            )
            .slice(0, maxPerQuery)
            .forEach(item => balanced.push(item));
        }

        return balanced;
      }

      const balancedRawExactPool =
        balanceByQuery(strictExactPool, 6);

      /*
       * V14.5 – FINAL EXACT-REFERENCE SANITIZER
       * ----------------------------------------
       * Vi har allerede en hard Fender-gate tidligere i eBay-pipelinen.
       * Denne siste kontrollen ligger likevel etter exactPool-byggingen.
       * Grunnen er at eBay kan levere rådata gjennom flere veier, og
       * frontend skal aldri kunne få et treff merket "exact" som en
       * inkompatibel variant.
       *
       * Viktig: denne listen brukes både til visning OG verdiberegning.
       * Dermed kan en Squier/Player/Special ikke påvirke medianen samtidig
       * som den vises som eksakt sammenligning.
       */
      function isFinalExactReferenceSafe(item) {
        if (!passesFenderSquierBrandGate(item)) {
          return false;
        }

        const title =
          String(
            `${item?.title || ""} ${item?._ebay_aspect_text || ""}`
          ).toLowerCase();

        /*
         * V14.7:
         * Variant-unntak skal bestemmes av målobjektets identifikasjon,
         * ikke av søkestrengene. Søkemotoren kan bruke Squier/Player/etc.
         * som negative søkeord eller hjelpeord, og det skal aldri gjøre at
         * et slikt treff blir godkjent som "exact".
         */
        /*
         * V14.8:
         * Beskrivelsen skal IKKE brukes til å avgjøre hvilken variant
         * målobjektet er. AI-beskrivelsen kan omtale alternative modeller
         * eller søketreff og kunne derfor feilaktig gjøre "Squier" til en
         * tillatt variant.
         *
         * Variantidentiteten bygges kun fra strukturerte identitetsfelt.
         */
        const targetIdentity =
          String(
            [
              itemInfo?.brand,
              itemInfo?.model,
              itemInfo?.manufacturer,
              itemInfo?.type,
              itemInfo?.year_or_period,
              parsed?.name
            ]
              .filter(Boolean)
              .join(" ")
          )
            .toLowerCase();

        const isFenderMimStrat =
          /\bfender\b/.test(targetIdentity) &&
          /\bstratocaster\b/.test(targetIdentity) &&
          /\b(?:mexico|mim|made in mexico)\b/.test(targetIdentity);

        /*
         * V14.21 – EKSAKT GITAR: BUNDLE/PAKKE-GATE
         * -------------------------------------------
         * Et treff kan ha riktig merke + serie + modell, men fortsatt være
         * en annen varetype, f.eks. "Squier Affinity Stratocaster Mustang
         * Micro Pack". Dette skal ikke være en eksakt sammenligning med
         * selve gitaren.
         *
         * Vi bruker bare tydelige pakkeord. "set" alene brukes IKKE fordi
         * det kan forekomme i legitime gitarbeskrivelser (f.eks. pickup set).
         * Dersom målobjektet selv er en pakke/bundle, aktiveres ikke gaten.
         */
        const targetIsBundleOrPackage =
          /\b(?:bundle|pack(?:age)?|starter\s+(?:set|pack)|beginner\s+(?:set|pack)|guitar\s+(?:set|package|bundle)|instrument\s+(?:set|package|bundle)|mustang\s+micro)\b/.test(targetIdentity);

        const listingIsBundleOrPackage =
          /\b(?:bundle|pack(?:age)?|starter\s+(?:set|pack)|beginner\s+(?:set|pack)|guitar\s+(?:set|package|bundle)|instrument\s+(?:set|package|bundle)|mustang\s+micro)\b/.test(title);

        if (
          !targetIsBundleOrPackage &&
          listingIsBundleOrPackage
        ) {
          return false;
        }

        if (!isFenderMimStrat) {
          return true;
        }

        /*
         * En variant får bare være tillatt dersom MÅLOBJEKTET faktisk
         * er identifisert som denne varianten.
         *
         * Det er med vilje ingen sjekk mot built.queries her.
         * built.queries kan inneholde søkehjelp/negative termer og er
         * derfor ikke en sikker beskrivelse av objektet.
         */
        const targetIsSquier =
          /\bsqu(?:ier|ire)(?:\s+series)?\b/.test(targetIdentity);

        const targetIsFsr =
          /\bfsr\b/.test(targetIdentity) ||
          /\bfender\s+special\s+run\b/.test(targetIdentity) ||
          /\bspecial\s+run\b/.test(targetIdentity);

        const targetIs62 =
          /\b62\s*(?:['’]s?|special)\b/.test(targetIdentity) ||
          /\b62\s*reissue\b/.test(targetIdentity);

        const targetIsAnniversary =
          /\b(?:50th|anniversary)\b/.test(targetIdentity);

        const targetIsSpecial =
          /\bspecial(?:\s+edition)?\b/.test(targetIdentity);

        const targetIsPlayer =
          /\bplayer(?:\s+(?:ii|2))?\b/.test(targetIdentity);

        const targetIsVintera =
          /\bvintera\b/.test(targetIdentity);

        const targetIsClassic =
          /\bclassic\s+(?:series|vibe)\b/.test(targetIdentity);

        const targetIs60s =
          /\b(?:60s|classic\s+60s)\b/.test(targetIdentity);

        const targetIsSignature =
          /\bsignature(?:\s+series|\s+model)?\b/.test(targetIdentity) ||
          /\bjeff\s+beck\b/.test(targetIdentity);

        const targetIsAmerican =
          /\bamerican\s+(?:standard|professional|performer|ultra|original|vintage)\b/.test(targetIdentity) ||
          /\bprofessional\s+ii\b/.test(targetIdentity);

        const targetIsReissue =
          /\b(?:vintage\s+reissue|reissue)\b/.test(targetIdentity);

        const targetIsLimited =
          /\blimited\s+edition\b/.test(targetIdentity);

        /*
         * Hvis målobjektet ikke er en spesialvariant, er disse ordene
         * harde stoppord. Det gjelder både exact-visning og verdigrunnlag.
         */
        if (
          /\bsqu(?:ier|ire)(?:\s+series)?\b/.test(title) &&
          !targetIsSquier
        ) return false;

        if (
          (/\bfsr\b/.test(title) ||
            /\bfender\s+special\s+run\b/.test(title) ||
            /\bspecial\s+run\b/.test(title)) &&
          !targetIsFsr
        ) return false;

        if (
          /\b62\s*(?:['’]s?|special)\b/.test(title) &&
          !targetIs62
        ) return false;

        if (
          /\b50th\s+anniversary\b/.test(title) ||
          /\banniversary\b/.test(title)
        ) {
          if (!targetIsAnniversary) return false;
        }

        if (
          /\bspecial(?:\s+edition)?\b/.test(title) &&
          !targetIsSpecial &&
          !targetIsFsr
        ) return false;

        if (
          /\blimited\s+edition\b/.test(title) &&
          !targetIsLimited
        ) return false;

        if (
          /\bvintage\s+reissue\b/.test(title) ||
          /\breissue\b/.test(title)
        ) {
          if (!targetIsReissue && !targetIs62) return false;
        }

        if (
          /\bplayer(?:\s+(?:ii|2))?\b/.test(title) &&
          !targetIsPlayer
        ) return false;

        if (
          /\bvintera\b/.test(title) &&
          !targetIsVintera
        ) return false;

        if (
          /\bclassic\s+(?:series|vibe)\b/.test(title) &&
          !targetIsClassic
        ) return false;

        if (
          /\b(?:60s|classic\s+60s)\b/.test(title) &&
          !targetIs60s
        ) return false;

        if (
          /\bsignature(?:\s+series|\s+model)?\b/.test(title) &&
          !targetIsSignature
        ) return false;

        if (
          /\bjeff\s+beck\b/.test(title) &&
          !targetIsSignature
        ) return false;

        if (
          /\bamerican\s+(?:standard|professional|performer|ultra|original|vintage)\b/.test(title) ||
          /\bprofessional\s+ii\b/.test(title)
        ) {
          if (!targetIsAmerican) return false;
        }

        return true;
      }

      const sanitizedExactPool =
        removeOutliers(balancedRawExactPool)
          .filter(isFinalExactReferenceSafe);

      /*
       * V14.9 – FINAL EXACT TITLE GATE
       * -------------------------------
       * Dette er siste kontroll før exactPool sendes videre til både
       * verdiberegning og frontend. For en identifisert normal Fender MIM
       * Stratocaster skal et Squier/Player/etc.-treff ikke kunne overleve
       * via en alternativ kodevei.
       */
      /*
       * V14.16 – ABSOLUTT VARIANTFILTER PÅ FRONTEND-DATAGRUNNLAGET
       * -------------------------------------------------------------
       * V14.15 filtrerte inkompatible varianter når hardFenderMimTarget
       * var aktiv. Squier kunne likevel overleve dersom målidentiteten
       * ikke aktiverte akkurat denne gaten, selv om søket tydelig gjaldt
       * Fender Stratocaster.
       *
       * For en normal Fender Stratocaster skal Squier/FSR/Special/Player/
       * Vintera/American osv. aldri sendes i exact_listings.
       * Dette er kun en tittelbasert sluttgate og påvirker ikke et faktisk
       * Squier-mål, fordi targetIsSquier må være false.
       */
      /*
       * V14.17 – DETERMINISTISK SØKESTRENG-GATE
       * --------------------------------------------
       * Hvis Kistefunn faktisk søker etter Fender + Stratocaster +
       * Mexico/MIM + år, er dette et sikkert signal om målobjektet.
       * Vi skal ikke la en uklar AI-identitet deaktivere variantfilteret.
       * Dette er spesielt viktig for Squier Series, som ellers kan bli
       * klassifisert som "Fender Stratocaster" av eBay/AI.
       */
      const deterministicNormalFenderStratTarget =
        /\bfender\b/i.test(builtQueryText) &&
        /\bstratocaster\b/i.test(builtQueryText) &&
        /\b(?:mexico|mim|made\s+in\s+mexico)\b/i.test(builtQueryText) &&
        /\b(?:19|20)\d{2}\b/.test(builtQueryText) &&
        !/\bsqu(?:ier|ire)(?:\s+series)?\b/i.test(builtQueryText) &&
        !/\b(?:fsr|special|anniversary|player|vintera|60s|classic\s+60s|signature(?:\s+series|\s+model)?|jeff\s+beck)\b/i.test(builtQueryText);

      const strictFenderStratComparableTarget =
        deterministicNormalFenderStratTarget ||
        (
          !targetIsSquier &&
          (
            targetIsFender &&
            /\bstratocaster\b/i.test(structuredTargetText)
            ||
            deterministicFenderMimTarget
          )
        );

      const finalExactPool = sanitizedExactPool;

      /*
       * V14.14 – ABSOLUTT SLUTTGATE FOR FENDER MIM
       * ----------------------------------------------
       * Selv om en tidligere gate av en eller annen grunn ikke aktiveres,
       * skal en inkompatibel Fender-variant aldri kunne sendes til frontend
       * når målet er en normal Fender Stratocaster MIM med kjent år.
       * Dette er bevisst kun en tittelbasert sikkerhetsventil.
       */
      const finalExactPoolV1413 = finalExactPool;

      const exactPool =
        finalExactPoolV1413;

      /*
       * Same-model treff:
       * riktig modell/variant, men annonsen oppgir ikke år.
       * Disse er lovlige sekundære sammenligninger når målobjektet
       * har kjent år, men skal ikke behandles som eksakte treff.
       */
      const rawSameModelPool =
        all.filter(
          x =>
            passesFenderSquierBrandGate(x) &&
            x.match_tier === "same_model" &&
            x.relevance_score >= 50 &&
            (
              !built.year ||
              x.year_match === "missing"
            )
        );

      const sameModelPool =
        balanceByQuery(rawSameModelPool, 4);

      /*
       * Verdigrunnlag:
       * - Har vi minst 2 eksakte årstreff, bruker vi dem som hovedgrunnlag.
       * - Same-model brukes som støtte, men kan ikke dominere.
       * - Har vi ingen eksakte årstreff, kan same-model brukes alene.
       */
      let valuationPool = [];

      if (built.year) {
        // V11.8: kjent år = kun annonser med samme år i tittelen kan påvirke verdien
        // kan påvirke selve verdien. Same-model uten år beholdes som
        // støtte/visning, men får 0 % innflytelse på prisberegningen.
        valuationPool = exactPool;
      } else {
        valuationPool = [
          ...exactPool,
          ...sameModelPool
        ];
      }

      const filteredPool =
        removeOutliers(
          valuationPool
        );

      const valuationFilterApplied =
        filteredPool.length >= 2;

      const finalPool =
        valuationFilterApplied
          ? filteredPool
          : valuationPool;

      /*
       * V13.0: SKILL MELLOM SAMMENLIGNBAR OG VERDIBERETTIGET
       * ------------------------------------------------------
       * En annonse kan være en ekte, god modellmatch og derfor vises som
       * "eksakt markedsreferanse", samtidig som et senere prisfilter
       * vurderer den som et statistisk avvik. Tidligere kunne UI-et vise
       * en slik annonse som eksakt uten å forklare at den ikke påvirket
       * verdien.
       *
       * Vi skiller derfor eksplisitt mellom:
       * 1) exactPool = godkjente sammenlignbare annonser
       * 2) finalPool = annonser som faktisk påvirker verdien
       * 3) valuationExcluded = godkjente sammenligninger som ble filtrert
       *    bort fra selve verdiberegningen.
       */
      const finalPoolKeys = new Set(
        finalPool.map(
          x =>
            `${String(x.title || "").toLowerCase().trim()}|${Math.round(Number(x.nok) || 0)}|${String(x.url || "")}`
        )
      );

      const valuationExcluded =
        valuationFilterApplied
          ? valuationPool.filter(x => {
              const key =
                `${String(x.title || "").toLowerCase().trim()}|${Math.round(Number(x.nok) || 0)}|${String(x.url || "")}`;
              return !finalPoolKeys.has(key);
            })
          : [];

      const nearMatches =
        all
          .filter(
            x =>
              x.match_tier === "near"
          )
          .slice(0, 8);

      const exactPrices =
        exactPool
          .map(
            x => Number(x.nok)
          )
          .filter(Number.isFinite)
          .filter(x => x > 0);

      const sameModelPrices =
        sameModelPool
          .map(
            x => Number(x.nok)
          )
          .filter(Number.isFinite)
          .filter(x => x > 0);

      const prices =
        finalPool
          .map(
            x => Number(x.nok)
          )
          .filter(Number.isFinite)
          .filter(x => x > 0);

      /*
       * V9 markedsmedian:
       * Eksakte årstreff har hovedvekten.
       * Same-model uten år får kun støttevekt.
       */
      const exactMedian =
        median(exactPrices);

      const sameModelMedian =
        median(sameModelPrices);

      let marketMedian = null;

      if (
        built.year &&
        Number.isFinite(exactMedian)
      ) {
        // V11.8: same-model uten år påvirker ikke medianen når år er kjent.
        marketMedian = Math.round(exactMedian);
      } else if (
        Number.isFinite(exactMedian)
      ) {
        marketMedian =
          Math.round(exactMedian);
      } else if (
        Number.isFinite(sameModelMedian)
      ) {
        marketMedian =
          Math.round(sameModelMedian);
      }

      /*
       * V13.5 – SIKRERE KUPP-FILTER
       * ----------------------------
       * Et ekstremt lavt enkeltfunn skal ikke automatisk bli kalt et kupp.
       *
       * Vi bruker fortsatt KUN exactPool, men legger på et robust
       * distribusjonsfilter:
       *   - minst 4 eksakte sammenligninger før "mulig kupp"
       *   - minst 5 eksakte sammenligninger før "sterkt mulig kupp"
       *   - svært ekstreme avvik flagges som "pris som bør undersøkes"
       *   - et slikt avvik påvirker ikke markedsverdien
       *
       * Dette beskytter mot f.eks. én feilregistrert annonse, en
       * mistenkelig pris eller en ufullstendig vare som har passert
       * tittel-/modellfilteret.
       */
      const bargainReferenceMedian =
        Number.isFinite(exactMedian)
          ? exactMedian
          : (Number.isFinite(marketMedian) ? marketMedian : null);

      const exactPositiveItems =
        exactPool
          .map(item => ({
            item,
            price: Number(item.nok)
          }))
          .filter(x => Number.isFinite(x.price) && x.price > 0);

      const exactPositivePrices =
        exactPositiveItems.map(x => x.price);

      const exactQ1 =
        percentile(exactPositivePrices, 0.25);

      const exactQ3 =
        percentile(exactPositivePrices, 0.75);

      const exactIqr =
        Number.isFinite(exactQ1) && Number.isFinite(exactQ3)
          ? Math.max(0, exactQ3 - exactQ1)
          : null;

      const robustLowFence =
        Number.isFinite(exactQ1) && Number.isFinite(exactIqr)
          ? Math.max(0, exactQ1 - 1.5 * exactIqr)
          : null;

      priceInvestigations = [];

      buy_opportunities =
        Number.isFinite(bargainReferenceMedian) &&
        bargainReferenceMedian > 0 &&
        exactPositiveItems.length >= 4
          ? exactPositiveItems
              .map(({ item, price }) => {
                const ratio = price / bargainReferenceMedian;
                const discountPercent = Math.round((1 - ratio) * 100);

                if (ratio > 0.80) return null;

                /*
                 * Ekstremt avvik:
                 * - minst 50 % under median, eller
                 * - under robust IQR-nedre grense.
                 *
                 * Dette skal ikke presenteres som et sikkert kupp.
                 */
                const extremeByMedian =
                  ratio < 0.50;

                const extremeByIqr =
                  Number.isFinite(robustLowFence) &&
                  price < robustLowFence;

                const isolatedExtreme =
                  (extremeByMedian || extremeByIqr) &&
                  exactPositiveItems.length < 6;

                if (isolatedExtreme) {
                  priceInvestigations.push({
                    title: item.title || "Ukjent annonse",
                    price_nok: Math.round(price),
                    market_median_nok: Math.round(bargainReferenceMedian),
                    discount_percent: Math.max(0, discountPercent),
                    marketplace: item.marketplace || "eBay",
                    url: item.url || "",
                    query: item.query || "",
                    reason:
                      "Prisen er et uvanlig stort avvik fra de øvrige eksakte sammenligningene. Kistefunn kaller derfor ikke dette et kupp uten mer dokumentasjon."
                  });
                  return null;
                }

                /*
                 * "Sterkt mulig kupp" krever både større datagrunnlag
                 * og at prisen ikke er et ekstremt isolert avvik.
                 */
                const strongBargain =
                  ratio <= 0.70 &&
                  exactPositiveItems.length >= 5;

                return {
                  title: item.title || "Ukjent annonse",
                  price_nok: Math.round(price),
                  market_median_nok: Math.round(bargainReferenceMedian),
                  discount_percent: Math.max(0, discountPercent),
                  potential_saving_nok:
                    Math.max(
                      0,
                      Math.round(
                        bargainReferenceMedian - price
                      )
                    ),
                  level:
                    strongBargain
                      ? "sterkt_mulig_kupp"
                      : "mulig_kupp",
                  marketplace: item.marketplace || "eBay",
                  url: item.url || "",
                  query: item.query || "",
                  reason:
                    "Godkjent eksakt sammenligning som ligger betydelig under markedsmedianen og ikke er et ekstremt isolert prisavvik."
                };
              })
              .filter(Boolean)
              .sort(
                (a, b) =>
                  b.discount_percent -
                  a.discount_percent
              )
              .slice(0, 8)
          : [];

      /*
       * Et svært lavt funn kan fortsatt være interessant for brukeren,
       * men skal vises separat som noe som bør undersøkes.
       */
      priceInvestigations
        .sort(
          (a, b) =>
            b.discount_percent -
            a.discount_percent
        );

      /*
       * Frontend kan bruke denne listen senere. Den er bevisst separat
       * fra buy_opportunities slik at "pris som bør undersøkes" aldri
       * blir presentert som et kupp.
       */


      const successfulQueries =
        [
          ...new Set(
            exactPool.map(
              x => x.query
            )
          )
        ];

      const exact_model_code_gate =
        targetModelCode || null;

      const successfulMarketplaces =
        [
          ...new Set(
            finalPool
              .map(x => x.marketplace)
              .filter(Boolean)
          )
        ];

      const nearMatchQueries =
        [
          ...new Set(
            nearMatches.map(
              x => x.query
            )
          )
        ];

      const medianNok =
        median(prices);

      const lowNok =
        percentile(
          prices,
          0.15
        );

      const highNok =
        percentile(
          prices,
          0.85
        );

      /*
       * Uavhengige markedsobservasjoner.
       */
      const distinctValuationKeys =
        new Set(
          finalPool.map(
            x =>
              `${String(
                x.title || ""
              )
                .toLowerCase()
                .trim()}|${Math.round(
                Number(x.nok) || 0
              )}`
          )
        );

      const sameTitleKeys =
        new Set(
          finalPool.map(
            x =>
              String(
                x.title || ""
              )
                .toLowerCase()
                .trim()
          )
        );

      return {
        enabled: true,
        marketplaces,
        successful_marketplaces:
          successfulMarketplaces,
        query:
          built.queries[0],
        queries:
          built.queries,
        discovery_queries:
          searchQueries,
        successful_queries:
          successfulQueries,
        near_match_queries:
          nearMatchQueries,

        total_candidates:
          all.length,

        detail_enriched_count:
          all.filter(x => x._ebay_detail_loaded).length,

        sample_size:
          finalPool.length,

        exact_match_count:
          exactPool.length,

        exact_prices_nok:
          exactPool.map(x => Number(x.nok)).filter(Number.isFinite),

        raw_exact_match_count:
          rawExactPool.length,

        balanced_exact_match_count:
          balancedRawExactPool.length,

        exact_price_filter_removed:
          Math.max(0, balancedRawExactPool.length - exactPool.length),

        valuation_filter_applied:
          valuationFilterApplied,

        valuation_excluded_count:
          valuationExcluded.length,

        same_model_match_count:
          sameModelPool.length,

        distinct_valuation_count:
          distinctValuationKeys.size,

        same_title_count:
          sameTitleKeys.size,

        near_match_count:
          nearMatches.length,

        median_nok:
          Number.isFinite(
            marketMedian
          )
            ? Math.round(marketMedian)
            : null,

        exact_median_nok:
          Number.isFinite(exactMedian)
            ? Math.round(exactMedian)
            : null,

        same_model_median_nok:
          Number.isFinite(sameModelMedian)
            ? Math.round(sameModelMedian)
            : null,

        low_nok:
          Number.isFinite(
            lowNok
          )
            ? Math.round(lowNok)
            : null,

        high_nok:
          Number.isFinite(
            highNok
          )
            ? Math.round(highNok)
            : null,

        filtering: {
          strict: true,

          fender_squier_brand_gate:
            true,

          fender_squier_gate_target_brand:
            targetIsSquierBrand
              ? "Squier"
              : (targetIsFenderBrand ? "Fender" : "other"),

          minimum_relevance_score:
            45,

          exact_year_required_for_valuation:
            Boolean(built.year),

          hard_year_gate:
            Boolean(built.year),

          exact_requires_title_year_match:
            Boolean(built.year),

          year_missing_excluded_from_exact_valuation:
            Boolean(built.year),

          year_missing_allowed_as_secondary:
            Boolean(built.year),

          valuation_uses_same_model_when_year_not_required:
            !built.year,

          user_model_hint:
            Boolean(
              built.user_model_hint
            ),

          user_model_text:
            built.user_model_text || null,

          identification_basis:
            built.identification_basis || "bildeanalyse",

          detected_year:
            built.detected_year,

          valuation_year:
            built.year,

          market_basis_label:
            built.category ===
              "bicycle" &&
            built.model
              ? (
                  built.user_model_hint
                    ? "modell oppgitt av bruker + bilde"
                    : "modell identifisert fra bilde"
                )
              : null,

          valuation_minimum_relevance_score:
            built.year
              ? 60
              : 50
        },

        listings:
          (strictFenderStratComparableTarget
            ? all.filter(item =>
                targetDrivenFenderVariantAllowed(
                  structuredTargetText,
                  `${String(item?.title || "")} ${String(item?._ebay_aspect_text || "")}`
                )
              )
            : all
          )
            .slice(0, 12)
            .map(
              item => ({
                title:
                  item.title,
                price:
                  item.price,
                price_nok:
                  item.nok,
                url:
                  item.url,
                query:
                  item.query,
                marketplace:
                  item.marketplace,
                relevance_score:
                  item.relevance_score,
                match_tier:
                  item.match_tier,
                year_match:
                  item.year_match
              })
            ),

        // V12.6: exactPool er allerede hard-filtrert mot Squier/FSR/Special osv.
        exact_listings:
          exactPool
            .slice(0, 12)
            .map(
              item => ({
                title:
                  item.title,
                price:
                  item.price,
                price_nok:
                  item.nok,
                url:
                  item.url,
                query:
                  item.query,
                marketplace:
                  item.marketplace,
                relevance_score:
                  item.relevance_score,
                match_tier:
                  "exact",
                year_match:
                  item.year_match,
                valuation_included:
                  finalPoolKeys.has(
                    `${String(item.title || "").toLowerCase().trim()}|${Math.round(Number(item.nok) || 0)}|${String(item.url || "")}`
                  ),
                valuation_exclusion_reason:
                  valuationExcluded.some(x => x === item)
                    ? "prisavvik filtrert fra verdiberegningen"
                    : null,
                exact_year_verified:
                  !built.year ||
                  (item.year_match === "exact" &&
                    extractYears(String(item.title || "").toLowerCase()).includes(Number(built.year)))
              })
            ),

        valuation_excluded_listings:
          valuationExcluded
            .slice(0, 12)
            .map(
              item => ({
                title:
                  item.title,
                price:
                  item.price,
                price_nok:
                  item.nok,
                url:
                  item.url,
                query:
                  item.query,
                marketplace:
                  item.marketplace,
                relevance_score:
                  item.relevance_score,
                match_tier:
                  item.match_tier,
                year_match:
                  item.year_match,
                reason:
                  "prisavvik filtrert fra verdiberegningen"
              })
            ),

        near_listings:
          nearMatches.map(
            item => ({
              title:
                item.title,
              price:
                item.price,
              price_nok:
                item.nok,
              url:
                item.url,
              query:
                item.query,
              relevance_score:
                item.relevance_score,
              match_tier:
                "near",
              year_match:
                item.year_match
            })
          )
      };
    }

    /* ---------------------------------------------------------
       6. KJØR eBAY
       --------------------------------------------------------- */

    let ebay = {
      enabled: false,
      reason:
        "eBay-søk ikke utført",
      queries: [],
      successful_queries: []
    };

    try {
      const ebayTotalStartedAt = performance.now();
      ebay =
        await searchEbay(parsed);
      timings.ebay_total_ms = Math.round(
        performance.now() - ebayTotalStartedAt
      );
    } catch (error) {
      if (!Number.isFinite(timings.ebay_total_ms)) {
        // Be robust if the exception occurred before the normal completion path.
        timings.ebay_total_ms = null;
      }
      const message =
        error?.message ||
        ebayDiagnosticError?.message ||
        "Ukjent feil i eBay-søket.";

      ebay = {
        enabled: false,
        reason: String(message).slice(0, 300),
        diagnostic:
          ebayDiagnosticError
            ? {
                stage: ebayDiagnosticError.stage,
                status: ebayDiagnosticError.status,
                code: ebayDiagnosticError.code
              }
            : {
                stage: "search_exception",
                status: error?.status ?? null,
                code: error?.code || "search_exception"
              },
        queries: [],
        successful_queries: []
      };
    }

    // V12.7: vis og bruk den spesifikke modellen brukeren oppga når
    // bildet støtter samme merke/serie.
    if (ebay?.filtering?.user_model_hint && ebay?.filtering?.user_model_text) {
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
        const webReferenceStartedAt = performance.now();
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

        const r = await fetchWithTimeout("https://api.openai.com/v1/responses", {
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
        }, WEB_REFERENCE_TIMEOUT_MS);

        const webFetchMs = Math.round(performance.now() - webReferenceStartedAt);
        const webRequestId =
          r.headers.get("x-request-id") ||
          r.headers.get("x-openai-request-id") ||
          null;
        timings.web_reference_fetch_ms = webFetchMs;

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
            references: [],
            diagnostic: {
              fetch_ms: webFetchMs,
              request_id: webRequestId,
              http_status: r.status,
              usage: null,
              output_item_count: 0,
              reference_count: 0
            }
          };
        }

        const data = await r.json();
        const outputText = String(data?.output_text || "").trim();
        const webUsage = data?.usage || {};
        const webDiagnostic = {
          fetch_ms: webFetchMs,
          request_id: webRequestId,
          http_status: r.status,
          usage: {
            input_tokens: Number.isFinite(Number(webUsage.input_tokens)) ? Number(webUsage.input_tokens) : null,
            output_tokens: Number.isFinite(Number(webUsage.output_tokens)) ? Number(webUsage.output_tokens) : null,
            total_tokens: Number.isFinite(Number(webUsage.total_tokens)) ? Number(webUsage.total_tokens) : null
          },
          output_item_count: Array.isArray(data?.output) ? data.output.length : 0,
          reference_count: 0
        };

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
        const webFxStartedAt = performance.now();
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
        timings.web_reference_fx_ms = Math.round(performance.now() - webFxStartedAt);
        webDiagnostic.reference_count = references.length;
        webDiagnostic.converted_reference_count = converted.length;
        webDiagnostic.currencies = [...new Set(references.map(x => x.currency).filter(Boolean))];

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

        // V15.4 TEST: En ekstern web-verdi skal ikke kalles robust på bare
        // 1–2 referanser. Minst 3 distinkte, stabile priser kreves.
        // Dette er spesielt viktig når aktive butikk-/forhandlerpriser
        // ligger langt over et sterkere eBay-marked.
        const valuationDistinctCount = new Set(valuationValues.map(v => Math.round(v))).size;
        const valuationStable =
          valuationValues.length >= 3 &&
          valuationDistinctCount >= 3 &&
          Number.isFinite(valuationMedian) &&
          valuationValues.every(v => Math.abs(v - valuationMedian) / valuationMedian <= 0.20);

        const referencesWithValuation = unique.map((item, index) => ({
          ...item,
          valuation_included: valuationStable && !outlierIndexes.has(index),
          valuation_exclusion_reason: !valuationStable
            ? "For få/stabile nok eksterne referanser – beholdes som markedsreferanse, men brukes ikke som robust verdigrunnlag."
            : outlierIndexes.has(index)
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
            references: [],
            diagnostic: webDiagnostic
          };
        }

        return {
          enabled: true,
          status: valuationStable ? "ok" : "reference_only",
          reason: !valuationStable
            ? "Eksterne referanser funnet, men for få eller for ustabile til å brukes som robust markedsverdi."
            : outlierIndexes.size
              ? `Eksakte referansepriser funnet. ${outlierIndexes.size} ekstremt prisavvik er ikke brukt i markedsverdien.`
              : "Eksakte referansepriser funnet via web-søk.",
          exact_match_count: values.length,
          distinct_count: new Set(values.map(v => Math.round(v))).size,
          value_nok: valuationStable ? Math.round(valuationMedian) : null,
          low_nok: valuationStable ? Math.round(valuationLow) : null,
          high_nok: valuationStable ? Math.round(valuationHigh) : null,
          valuation_reference_count: valuationStable ? valuationValues.length : 0,
          outlier_count: outlierIndexes.size,
          references: referencesWithValuation.slice(0, 8),
          diagnostic: webDiagnostic
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
          references: [],
          diagnostic: {
            fetch_ms: timings.web_reference_fetch_ms,
            request_id: null,
            http_status: null,
            usage: null,
            output_item_count: 0,
            reference_count: 0,
            error: error?.message || "Ukjent web-søkfeil."
          }
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

    const stableExactMarketForWebSkip = (() => {
      const values = Array.isArray(ebay?.exact_prices_nok)
        ? ebay.exact_prices_nok.filter(v => Number.isFinite(Number(v)) && Number(v) > 0).map(Number)
        : [];
      if (values.length < 3) return false;
      const med = median(values);
      if (!Number.isFinite(med) || med <= 0) return false;
      return values.every(v => Math.abs(v - med) / med <= 0.20) &&
        Number(ebay?.distinct_valuation_count || 0) >= 3;
    })();

    const webReferenceStartedAt = performance.now();
    const webReferenceSearch =
      webTargetModelCode && !stableExactMarketForWebSkip
        ? await searchExactReferenceWeb(webTargetModelCode, itemInfo.brand, itemInfo.model || parsed.name)
        : { enabled: false, status: "not_needed", reason: stableExactMarketForWebSkip ? "eBay har minst 3 stabile eksakte referanser." : "Ingen spesifikk modellreferanse.", exact_match_count: 0, distinct_count: 0, value_nok: null, low_nok: null, high_nok: null, references: [] };
    timings.web_reference_openai_ms = Math.round(
      performance.now() - webReferenceStartedAt
    );
    timings.web_reference_fx_ms = Number(webReferenceSearch?.diagnostic?.fx_ms || timings.web_reference_fx_ms || 0);

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

    const aiConfidence = String(parsed.confidence || "lav").toLowerCase();
    const confidenceRank = { lav: 0, middels: 1, høy: 2 };
    if (confidenceRank[market.confidence] > confidenceRank[aiConfidence]) {
      market.confidence = aiConfidence;
    }

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

    const ebayItemDetailsTrace = Array.isArray(timings.ebay_item_details_trace)
      ? timings.ebay_item_details_trace.slice(0, 50)
      : [];

    const diagnosticDetail = {
      fx: {
        calls: Number(timings.frankfurter_fx_calls || 0),
        cumulative_ms: Number(timings.frankfurter_fx_ms || 0),
        wall_ms: Number(timings.frankfurter_fx_wall_ms || 0),
        currencies: Array.isArray(timings.frankfurter_fx_currencies)
          ? timings.frankfurter_fx_currencies
          : []
      },
      web_reference: {
        elapsed_ms: Number(timings.web_reference_openai_ms || 0),
        fetch_ms: Number(timings.web_reference_fetch_ms || 0),
        fx_ms: Number(timings.web_reference_fx_ms || 0),
        diagnostic: webReferenceSearch?.diagnostic || null
      },
      ebay_item_details: {
        calls: Number(timings.ebay_item_details_calls || 0),
        total_call_ms: Number(timings.ebay_item_details_total_call_ms || 0),
        slowest_ms: Number(timings.ebay_item_details_slowest_ms || 0),
        failed: Number(timings.ebay_item_details_failed || 0),
        trace: ebayItemDetailsTrace
      }
    };

    /* ---------------------------------------------------------
       8. RETURNER
       --------------------------------------------------------- */

    return res.status(200).json({
      version: "v15.3",
      timings,
      diagnostic_detail: diagnosticDetail,
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
        "Ukjent feil",
      error_code: e?.error_code || null,
      error_type: e?.error_type || null,
      request_id: e?.request_id || null,
      status: 500,
      version: "v15.3"
    });
  }
}
