// Kistefunn analysebackend v11.8
// Strengere identifikasjon + hardere markedsfilter + multi-source markedsmotor
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { image, description } = req.body || {};

    if (!image || typeof image !== "string") {
      return res.status(400).json({ error: "Mangler bilde" });
    }

    if (!image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Ugyldig bildeformat" });
    }

    const userDescription =
      typeof description === "string" ? description.trim() : "";

    const contextText = userDescription
      ? `Brukeren har også skrevet følgende informasjon om gjenstanden:
"${userDescription}"
Bruk dette som ekstra identifikasjonssignal. Hvis brukeren oppgir en konkret modell, skal du kontrollere om bildet støtter den. Ikke avvis modellen bare fordi modellnavnet ikke kan leses i bildet, men ikke bruk den ukritisk dersom bildet viser et annet merke eller en tydelig annen modell.`
      : "Brukeren har ikke gitt noen ekstra informasjon om gjenstanden.";

    /* ---------------------------------------------------------
       1. IDENTIFISER MED OPENAI
       --------------------------------------------------------- */

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
- modellnavn/dekal
- motorprodusent
- motorplassering
- batteritype og plassering
- rammeform
- hjulstørrelse
- synlige komponenter
- eventuelt produksjonsår

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
        return null;
      }

      ebayTokenPromise = (async () => {
        const credentials = Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64");

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

        if (!r.ok) {
          return null;
        }

        ebayTokenCache =
          d.access_token || null;

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
        const r = await fetch(
          `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );

        if (!r.ok) return null;

        const d = await r.json();

        return d?.rates?.[to] || null;
      } catch {
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
        compact(info.model, 4);

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

      const model =
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

      // V11.8: konkret Fender Standard-variant og produksjonsland.
      const targetStandard =
        category === "guitar" &&
        /^fender$/i.test(String(brand || "")) &&
        /\bstratocaster\b/i.test(String(model || "")) &&
        /\bstandard\b/i.test(String(model || ""));

      const targetMexico =
        category === "guitar" &&
        /^fender$/i.test(String(brand || "")) &&
        /\bstratocaster\b/i.test(String(model || "")) &&
        country === "mexico";

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
          userText.toLowerCase().includes(
            brand.toLowerCase()
          ) &&
          userText.toLowerCase().includes(
            model.toLowerCase()
          )
        );

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

      if (aiQuery) {
        candidates.push(aiQuery);
      }

      const out = [];
      const seen = new Set();

      for (const raw of candidates) {
        const q = compact(raw, 7);

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
        const q = compact(value, 7);
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
        target_standard: targetStandard,
        target_mexico: targetMexico,
        user_model_hint: userModelHint,
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

      // V11.8: exact-variant gate.
      // true betyr at annonsen dokumenterer samme variant/produksjonsland.
      // false betyr at treffet kan være relevant, men ikke er godt nok til
      // å få status "exact" eller påvirke hovedverdien for et kjent år.
      let strictVariantMatch = true;

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
        "sattel only"
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
          if (criteria.target_fingerboard !== listingFingerboard) {
            return {
              score: Math.max(0, score - 20),
              accepted: false,
              near_match: true,
              year_match: year ? "missing" : "not_required",
              reason: "annet gripebrett"
            };
          }
          score += 15;
          reasons.push("samme gripebrett");
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
            return {
              score: Math.max(0, score - 15),
              accepted: false,
              near_match: true,
              year_match: year ? "missing" : "not_required",
              reason: "annen farge"
            };
          }

          if (listingColor === criteria.target_color) {
            score += 8;
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
          /\bsquier\b/i
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
         V11.9 – FENDER STANDARD + MEXICO EXACTNESS GATE
         -------------------------------------------------------
         En Fender Standard Stratocaster MIM skal ikke få "exact"
         bare fordi annonsen sier Fender Stratocaster + riktig år.
         "Standard" og produksjonsland Mexico må være dokumentert i
         annonsetittelen for at treffet skal kunne brukes som eksakt
         prisreferanse.
      */
      if (
        category === "guitar" &&
        brand === "fender" &&
        /\bstratocaster\\b/i.test(model)
      ) {
        const listingSaysStandard =
          /\bstandard\\b/.test(t) &&
          /\bstratocaster\\b/.test(t);

        const listingSaysMexico =
          /\bmexic(?:o|an)\\b/.test(t) ||
          /\bmade\\s+in\\s+mexico\\b/.test(t) ||
          /\bmim\\b/.test(t);

        if (criteria.target_standard && !listingSaysStandard) {
          strictVariantMatch = false;
          reasons.push("Standard ikke dokumentert");
        }

        if (criteria.target_mexico && !listingSaysMexico) {
          strictVariantMatch = false;
          reasons.push("Mexico ikke dokumentert");
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
        "reissue"
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
        variant_match:
          strictVariantMatch ? "exact" : "partial",
        year_match:
          yearMatch,
        reason:
          reasons.join(", ") ||
          "lav relevans"
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
            "eBay-tilkobling er ikke tilgjengelig"
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
        return {
          enabled: false,
          query,
          marketplace,
          sample_size: 0,
          listings: [],
          rawItems: [],
          reason:
            d?.errors?.[0]?.message ||
            "eBay-søk feilet"
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
            /year|manufactured|production|fretboard|fingerboard|board|color|colour|finish|model|series|country|region|brand|type|body color|body colour/i.test(name)
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
          /\bsquier\b/,
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
          /\bsignature\s+series\b/,
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
          if (
            relevance.year_match === "exact" &&
            relevance.variant_match === "exact"
          ) {
            matchTier = "exact";
            valuationTier = "exact";
          } else if (
            relevance.year_match === "missing" &&
            relevance.variant_match === "exact"
          ) {
            matchTier = "same_model";
            valuationTier = "same_model";
          } else {
            matchTier = "near";
            valuationTier = "near";
          }
        } else {
          if (relevance.variant_match === "exact") {
            matchTier = "exact";
            valuationTier = "exact";
          } else {
            matchTier = "near";
            valuationTier = "near";
          }
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

      const results =
        await Promise.all(
          searchJobs.map(
            async job => {
              try {
                return await searchEbaySingle(
                  job.query,
                  job.marketplace
                );
              } catch {
                return {
                  enabled: false,
                  query: job.query,
                  marketplace: job.marketplace,
                  rawItems: []
                };
              }
            }
          )
        );

      /*
       * eBay item_summary gir ikke alltid år/variant i selve søkeresultatet.
       * Før verdiberegningen henter vi derfor detaljer for de mest lovende
       * kandidatene per marked. Dette er spesielt viktig for eldre varer,
       * der "Year Manufactured" ofte ligger som et item aspect og ikke i tittelen.
       */
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
                  list.push(prepared);
                }
              }

              return list;
            }
          )
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

      const rawExactPool =
        all.filter(
          x =>
            x.match_tier === "exact" &&
            x.relevance_score >= 45 &&
            // V11.8 HARD TITLE-YEAR GATE: kjent år krever dokumentert
            // samme år i annonsen. Ingen fallback til manglende år.
            (!built.year || x.year_match === "exact")
        );

      // Ekstra sikkerhetskontroll før prisberegning og visning.
      // Dette gjør at en annonse uten år aldri kan bli med i exactPool
      // selv om et senere steg skulle endre match_tier.
      const strictExactPool =
        built.year
          ? rawExactPool.filter(x => {
              const titleText = String(x.title || "").toLowerCase();
              const titleYears = extractYears(titleText);

              const strictFenderStandard =
                built.target_standard &&
                /^fender$/i.test(String(built.brand || "")) &&
                /\bstratocaster\\b/i.test(String(built.model || ""));

              const standardOk =
                !strictFenderStandard ||
                (/\bstandard\\b/.test(titleText) &&
                 /\bstratocaster\\b/.test(titleText));

              const mexicoOk =
                !built.target_mexico ||
                /\bmexic(?:o|an)\\b/.test(titleText) ||
                /\bmade\\s+in\\s+mexico\\b/.test(titleText) ||
                /\bmim\\b/.test(titleText);

              return x.year_match === "exact" &&
                x.variant_match === "exact" &&
                titleYears.includes(Number(built.year)) &&
                standardOk &&
                mexicoOk;
            })
          : rawExactPool;

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

      const exactPool =
        removeOutliers(balancedRawExactPool);

      /*
       * Same-model treff:
       * riktig modell/variant, men annonsen oppgir ikke år.
       * Disse er lovlige sekundære sammenligninger når målobjektet
       * har kjent år, men skal ikke behandles som eksakte treff.
       */
      const rawSameModelPool =
        all.filter(
          x =>
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

      const finalPool =
        filteredPool.length >= 2
          ? filteredPool
          : valuationPool;

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

      const successfulQueries =
        [
          ...new Set(
            exactPool.map(
              x => x.query
            )
          )
        ];

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

        raw_exact_match_count:
          rawExactPool.length,

        balanced_exact_match_count:
          balancedRawExactPool.length,

        exact_price_filter_removed:
          Math.max(0, balancedRawExactPool.length - exactPool.length),

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
          all
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
                variant_match:
                  item.variant_match
              })
            ),

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
                exact_year_verified:
                  !built.year ||
                  (item.year_match === "exact" &&
                    item.variant_match === "exact" &&
                    extractYears(String(item.title || "").toLowerCase()).includes(Number(built.year)))
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
                item.year_match,
              variant_match:
                item.variant_match
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
      ebay =
        await searchEbay(parsed);
    } catch {
      ebay = {
        enabled: false,
        reason:
          "eBay-søk kunne ikke gjennomføres",
        queries: [],
        successful_queries: []
      };
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

      const ebayQuality =
        calculateEbayQuality(sources.ebay);

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

      /*
       * AI får basisvekt 1. Markedskilder får sin kvalitetspoeng.
       * Dersom flere markedsplasser er tilgjengelige, normaliseres
       * markedsvektene først og AI beholdes som et eget ankerelement.
       */
      const marketCandidates = candidates.filter(
        x => x.source !== "ai"
      );

      const aiCandidate = candidates.find(
        x => x.source === "ai"
      );

      let marketWeight = 0;

      if (marketCandidates.length) {
        const totalQuality = marketCandidates.reduce(
          (sum, x) => sum + x.quality_weight,
          0
        );

        /*
         * V11.0: Når vi har mange eksakte markedsreferanser skal
         * faktisk markedsdata være hovedankeret. AI brukes fortsatt
         * som kontroll, men skal ikke trekke en godt dokumentert
         * markedspris unødvendig langt ned eller opp.
         *
         * Én sterk markedskilde kan få opptil 90 %. Flere uavhengige
         * markedsplasser kan få samlet opptil 95 %.
         */
        marketWeight = Math.min(
          0.90,
          0.45 + Math.min(0.45, totalQuality * 0.35)
        );

        if (marketCandidates.length >= 2) {
          marketWeight = Math.min(
            0.95,
            marketWeight + 0.05
          );
        }
      }

      const aiWeight = aiCandidate
        ? 1 - marketWeight
        : 0;

      let estimated = 0;
      let low = 0;
      let high = 0;

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
          const share =
            marketWeight *
            (item.quality_weight / totalQuality);

          estimated += item.value * share;

          if (Number.isFinite(item.low)) {
            low += item.low * share;
          }

          if (Number.isFinite(item.high)) {
            high += item.high * share;
          }
        }
      }

      const enabledMarketSources = marketCandidates.length;
      const exactMarketCount = marketCandidates.reduce(
        (sum, x) => {
          if (x.source === "ebay") {
            return sum + (sources.ebay.exact_match_count || 0);
          }
          if (x.source === "finn") {
            return sum + (sources.finn.exact_match_count || 0);
          }
          return sum;
        },
        0
      );

      let confidence = "middels";
      if (enabledMarketSources >= 2 && exactMarketCount >= 3) {
        confidence = "høy";
      } else if (enabledMarketSources === 1 && exactMarketCount >= 4) {
        confidence = "høy";
      } else if (!marketCandidates.length) {
        confidence = "lav";
      }

      const sourceWeights = [
        ...(aiCandidate
          ? [{ source: "ai", percent: Math.round(aiWeight * 100) }]
          : []),
        ...marketCandidates.map(item => ({
          source: item.source,
          percent: Math.round(
            marketWeight *
            (item.quality_weight /
              marketCandidates.reduce(
                (sum, x) => sum + x.quality_weight,
                0
              )) *
            100
          )
        }))
      ];

      const names = marketCandidates.map(x =>
        x.source === "ebay" ? "eBay" : "FINN"
      );

      return {
        estimated_nok: Math.round(estimated),
        low_nok: Number.isFinite(low) && low > 0
          ? Math.round(low)
          : null,
        high_nok: Number.isFinite(high) && high > 0
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
      `V11.3 markedsmotor: ${market.basis}`;

    /* ---------------------------------------------------------
       8. RETURNER
       --------------------------------------------------------- */

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

      brand_evidence:
        itemInfo.brand_evidence,

      model_evidence:
        itemInfo.model_evidence,

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

      market_engine_version: "v11.0-finn-ready",
      market_sources: marketSources,

      market_engine_version:
        "v11.8-market-first-pricing",

      market_filter_version:
        "v11.8-hard-title-year-variant-validation",

      market_variant_gate:
        "v11.8-fender-standard-mexico-exactness"
    });

  } catch (e) {
    return res.status(500).json({
      error:
        e?.message ||
        "Ukjent feil"
    });
  }
}
