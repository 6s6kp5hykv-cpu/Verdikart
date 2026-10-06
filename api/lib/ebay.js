// Kistefunn eBay-engine v14.26
// Flyttet ut fra analyze.js v14.25. Ingen endring i eBay-søke-/filterlogikk.

import { median, percentile, removeOutliers } from "./valuation-utils.js";

export function createEbayEngine({ parsed, itemInfo, timings, state }) {
  let buy_opportunities = Array.isArray(state?.buy_opportunities) ? state.buy_opportunities : [];
  let priceInvestigations = Array.isArray(state?.priceInvestigations) ? state.priceInvestigations : [];

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
        const r = await fetch(
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

    async function getExchangeRate(from, to = "NOK") {
      if (from === to) return 1;

      try {
        const fxStartedAt = performance.now();
        const r = await fetch(
          `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );

        if (!r.ok) {
          timings.frankfurter_fx_ms += Math.round(performance.now() - fxStartedAt);
          return null;
        }

        const d = await r.json();
        timings.frankfurter_fx_ms += Math.round(performance.now() - fxStartedAt);

        return d?.rates?.[to] || null;
      } catch {
        timings.frankfurter_fx_ms += Math.round(performance.now() - fxStartedAt);
        return null;
      }
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
        brand === "fender" &&
        /\bstratocaster\b/i.test(model) &&
        criteria.target_special !== true
      ) {
        const wrongFenderVariantTerms = [
          /\b62\s*(?:['’]s?)?\b/i,
          /\b62\s*special\b/i,
          /\bspecial(?:\s+edition)?\b/i,
          /\b50th\s+anniversary\b/i,
          /\banniversary\b/i,
          /\bvintage\s+reissue\b/i,
          /\breissue\b/i,
          /\bamerican\s+standard\b/i,
          /\bamerican\s+professional(?:\s+ii)?\b/i,
          /\bamerican\s+ultra\b/i,
          /\bplayer(?:\s+ii)?\b/i,
          /\bvintera\b/i,
          /\bclassic(?:\s+series|\s+60s)?\b/i,
          /\bperformer\b/i,
          /\bdeluxe\b/i,
          /\belite\b/i,
          /\bsqu(?:ier|ire)\b/i
        ];

        if (wrongFenderVariantTerms.some(rx => rx.test(t))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "Fender feil variant – ekskludert"
          };
        }
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

      const r = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization":
            `Bearer ${token}`,
          "Accept":
            "application/json",
          "X-EBAY-C-MARKETPLACE-ID":
            marketplace
        }
      });

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

      try {
        const url =
          "https://api.ebay.com/buy/browse/v1/item/" +
          encodeURIComponent(itemId);

        const r = await fetch(url, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            "X-EBAY-C-MARKETPLACE-ID": marketplace
          }
        });

        if (!r.ok) return item;

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
          _ebay_aspect_text: aspectText.join(" | ")
        };

        return enriched;
      } catch {
        return item;
      }
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
        criteria.target_special !== true
      ) {
        const incompatibleFenderVariantPatterns = [
          /\bsqu(?:ier|ire)\b/,
          /\bsqu(?:ier|ire)\s+series\b/,
          /\bfsr\b/,
          /\bfender\s+special\s+run\b/,
          /\bspecial\s+run\b/,
          /\b62\s*(?:['’]s?|special)?\b/,
          /\b50th\s+anniversary\b/,
          /\banniversary\b/,
          /\bspecial(?:\s+edition)?\b/,
          /\blimited\s+edition\b/,
          /\bvintage\s+reissue\b/,
          /\breissue\b/,
          /\bplayer(?:\s+ii|\s+2)?\b/,
          /\bvintera\b/,
          /\bclassic\s+series\b/,
          /\b(?:60s|classic\s+60s)\b/,
          /\bclassic\s+player\b/,
          /\broad\s+worn\b/,
          /\broad\s+worn\b/,
          /\bamerican\s+(?:standard|professional|performer|ultra|original)\b/,
          /\bprofessional\s+ii\b/,
          /\bdeluxe\b/,
          /\belite\b/,
          /\bsignature(?:\s+series|\s+model)?\b/,
          /\bjeff\s+beck\b/
        ];

        if (incompatibleFenderVariantPatterns.some(rx => rx.test(scoringText.toLowerCase()))) {
          return null;
        }
      }

      // V11.8: HARD TITLE-YEAR GATE
      // Når målobjektet har kjent år, er år i selve annonsetittelen
      // det eneste som kan gjøre treffet eksakt. eBay-aspekter kan
      // fortsatt brukes til støtteinformasjon, men de kan ikke løfte
      // en tittel uten år inn i exact_listings.
      const titleYears = extractYears(title.toLowerCase());
      const titleHasTargetYear = criteria.year
        ? titleYears.includes(Number(criteria.year))
        : true;
      const titleHasWrongYear = criteria.year
        ? titleYears.some(y => y !== Number(criteria.year))
        : false;

      if (criteria.year) {
        if (titleHasWrongYear && !titleHasTargetYear) {
          return null;
        }

        if (!titleHasTargetYear) {
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
        /\b(?:mexico|mim|made in mexico)\b/.test(hardQueryText) &&
        criteria?.target_special !== true;

      if (hardTargetFromQuery) {
        const hardForbidden = [
          /\bsqu(?:ier|ire)(?:\s+series)?\b/i,
          /\bfsr\b/i,
          /\b62\s*(?:['’]s?|special)\b/i,
          /\b50th\s+anniversary\b/i,
          /\banniversary\b/i,
          /\bspecial(?:\s+edition)?\b/i,
          /\blimited\s+edition\b/i,
          /\bvintage\s+reissue\b/i,
          /\breissue\b/i,
          /\bplayer(?:\s+ii|\s+2)?\b/i,
          /\bvintera\b/i,
          /\bclassic\s+series\b/i,
          /\b(?:60s|classic\s+60s)\b/i,
          /\bamerican\s+(?:standard|professional|performer|ultra|original|vintage)\b/i,
          /\bprofessional\s+ii\b/i,
          /\bsignature(?:\s+series|\s+model)?\b/i,
          /\bjeff\s+beck\b/i
        ];
        if (hardForbidden.some(rx => rx.test(String(title || "")))) {
          return null;
        }
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

      // V12.4: bruk også selve søkestrengen som sikkerhetsnett.
      // AI-en kan i enkelte kjøringer fylle criteria.country/model ufullstendig,
      // selv om buildStrictQueries allerede har laget et eksplisitt
      // "Fender ... Stratocaster ... Mexico"-søk.
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

      // Hvis søket eksplisitt er laget for en vanlig Fender MIM Stratocaster,
      // skal vi IKKE stole på et feilaktig target_special-flagg fra AI.
      // Special/62/anniversary må være eksplisitt en del av selve søket for
      // at slike varianter skal tillates.
      const queryRequestsSpecial =
        /\b(?:62\s*(?:['’]s?|special)|special|anniversary|fsr|squ(?:ier|ire)|60s|classic\s+60s|signature(?:\s+series|\s+model)?|jeff\s+beck)\b/i.test(queryContext);

      if (!isFenderStratMim || queryRequestsSpecial) {
        return false;
      }

      const text = `${title || ""} ${aspectText || ""}`.toLowerCase();

      const forbidden = [
        /\bsqu(?:ier|ire)(?:\s+series)?\b/,
        /\bfsr\b/,
        /\bfender\s+special\s+run\b/,
        /\bspecial\s+run\b/,
        /\b62\s*(?:['’]s?|special)\b/,
        /\b50th\s+anniversary\b/,
        /\banniversary\b/,
        /\bspecial(?:\s+edition)?\b/,
        /\blimited\s+edition\b/,
        /\bvintage\s+reissue\b/,
        /\breissue\b/,
        /\bplayer(?:\s+ii|\s+2)?\b/,
        /\bvintera\b/,
        /\bclassic\s+series\b/,
        /\bclassic\s+vibe\b/,
        /\bamerican\s+(?:standard|professional|performer|ultra|original|vintage)\b/,
        /\bprofessional\s+ii\b/,
        /\bdeluxe\b/,
        /\belite\b/,
        /\bsignature(?:\s+series|\s+model)?\b/,
        /\bmi[j]\b/
      ];

      return forbidden.some(rx => rx.test(text));
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
              `${item.title}|${item.nok}`
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

      const finalForbiddenFenderVariants = [
          /\bsqu(?:ier|ire)(?:\s+series)?\b/i,
          /\bfsr\b/i,
          /\b62\s*(?:['’]s?|special)\b/i,
          /\b50th\s+anniversary\b/i,
          /\banniversary\b/i,
          /\bspecial(?:\s+edition)?\b/i,
          /\blimited\s+edition\b/i,
          /\bvintage\s+reissue\b/i,
          /\breissue\b/i,
          /\bplayer(?:\s+ii|\s+2)?\b/i,
          /\bvintera\b/i,
          /\bclassic\s+series\b/i,
          /\b(?:60s|classic\s+60s)\b/i,
          /\bamerican\s+(?:standard|professional|performer|ultra|original|vintage)\b/i,
          /\bprofessional\s+ii\b/i,
          /\bsignature(?:\s+series|\s+model)?\b/i,
          /\bjeff\s+beck\b/i
        ];

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

          if (
            finalForbiddenFenderVariants.some(rx =>
              rx.test(listingTitle)
            )
          ) {
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
              /\b(?:squ(?:ier|ire)(?:\s+series)?|fsr|62\s*(?:['’]s?|special)|50th\s+anniversary|anniversary|special(?:\s+edition)?|limited\s+edition|vintage\s+reissue|reissue|player(?:\s+ii|\s+2)?|vintera|classic\s+series|american\s+(?:standard|professional|performer|ultra|original|vintage)|professional\s+ii|signature(?:\s+series|\s+model)?|jeff\s+beck|60s|classic\s+60s)\b/i.test(String(x.title || ""))
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
          ? modelCodeExactPool.filter(x => {
              const titleYears = extractYears(String(x.title || "").toLowerCase());
              return x.year_match === "exact" &&
                titleYears.includes(Number(built.year));
            })
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

      const finalExactPool =
        strictFenderStratComparableTarget
          ? sanitizedExactPool.filter(item => {
              const title = String(item?.title || "");
              return !finalForbiddenFenderVariants.some(rx =>
                rx.test(title)
              );
            })
          : sanitizedExactPool;

      /*
       * V14.14 – ABSOLUTT SLUTTGATE FOR FENDER MIM
       * ----------------------------------------------
       * Selv om en tidligere gate av en eller annen grunn ikke aktiveres,
       * skal en inkompatibel Fender-variant aldri kunne sendes til frontend
       * når målet er en normal Fender Stratocaster MIM med kjent år.
       * Dette er bevisst kun en tittelbasert sikkerhetsventil.
       */
      const finalExactPoolV1413 =
        strictFenderStratComparableTarget
          ? finalExactPool.filter(item => {
              const title = String(item?.title || "");
              return !finalForbiddenFenderVariants.some(rx =>
                rx.test(title)
              );
            })
          : finalExactPool;

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

      state.buy_opportunities = buy_opportunities;
      state.priceInvestigations = priceInvestigations;

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
            ? all.filter(item => {
                const title = String(item?.title || "");
                return !finalForbiddenFenderVariants.some(rx =>
                  rx.test(title)
                );
              })
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


  return {
    searchEbay,
    getDiagnosticError: () => ebayDiagnosticError
  };
}
