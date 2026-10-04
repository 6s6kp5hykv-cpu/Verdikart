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
Bruk dette som ekstra informasjon, men stol ikke blindt på opplysningene hvis bildet viser noe annet.`
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
Du er ekspert på identifisering og verdivurdering av fysiske gjenstander.

Identifiser gjenstanden på bildet så presist som mulig.

${contextText}

Vurder spesielt:
- merke
- modell
- produsent
- type
- alder/produksjonsperiode, men oppgi konkret år bare når det kan bekreftes fra bildet, serienummer eller annen tydelig dokumentasjon
- materiale
- serienummer hvis synlig
- spesielle kjennetegn
- modifikasjoner
- tilstand
- samlerverdi

Gi realistiske priser i norske kroner:
estimated_value_nok, low_value_nok, high_value_nok.

Prisene skal være NUMERISKE verdier uten kr, punktum eller mellomrom som tusenskiller.

Vær forsiktig dersom identifikasjonen er usikker.

VIKTIG OM eBay:
Lag et kort produktorientert eBay-søk, men IKKE skriv hele beskrivelsen inn i søket.
Bruk helst merke + modell + produksjonsvariant/land/år dersom dette er sikkert.
Eksempel:
"Fender Standard Stratocaster Mexico 1995"
eller
"Sony Walkman WM-3".

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
      return res.status(500).json({ error: "AI returnerte ikke noe svar" });
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
      itemInfo.identifying_features = [String(parsed.description).trim()];
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

      s = s.replace(/\s/g, "").replace(/[^\d,.-]/g, "");

      if (s.includes(",") && s.includes(".")) {
        const lc = s.lastIndexOf(",");
        const ld = s.lastIndexOf(".");
        if (lc > ld) s = s.replace(/\./g, "").replace(",", ".");
        else s = s.replace(/,/g, "");
      } else if (s.includes(",")) {
        const parts = s.split(",");
        s = parts.length === 2 && parts[1].length <= 2
          ? parts[0] + "." + parts[1]
          : parts.join("");
      } else if (s.includes(".")) {
        const parts = s.split(".");
        s = parts.length === 2 && parts[1].length <= 2
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
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }

    function percentile(values, p) {
      if (!values.length) return null;
      const a = [...values].sort((x, y) => x - y);
      const index = (a.length - 1) * p;
      const lo = Math.floor(index);
      const hi = Math.ceil(index);
      if (lo === hi) return a[lo];
      return a[lo] + (a[hi] - a[lo]) * (index - lo);
    }

    function removeOutliers(items) {
      if (items.length < 5) return items;

      const prices = items.map(x => Number(x.nok)).filter(Number.isFinite);
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

    if (!Number.isFinite(aiEstimated) &&
        Number.isFinite(aiLow) &&
        Number.isFinite(aiHigh)) {
      aiEstimated = Math.round((aiLow + aiHigh) / 2);
    }

    if (Number.isFinite(aiEstimated)) {
      if (!Number.isFinite(aiLow)) aiLow = Math.round(aiEstimated * 0.7);
      if (!Number.isFinite(aiHigh)) aiHigh = Math.round(aiEstimated * 1.3);
      aiLow = Math.min(aiLow, aiEstimated);
      aiHigh = Math.max(aiHigh, aiEstimated);
    }

    /* ---------------------------------------------------------
       4. eBAY
       --------------------------------------------------------- */

    async function getEbayToken() {
      const clientId = process.env.EBAY_CLIENT_ID;
      const clientSecret = process.env.EBAY_CLIENT_SECRET;

      if (!clientId || !clientSecret) return null;

      const credentials = Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString("base64");

      const r = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${credentials}`
          },
          body:
            "grant_type=client_credentials" +
            "&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope"
        }
      );

      const d = await r.json();
      return r.ok ? (d.access_token || null) : null;
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
        "sannsynligvis", "muligens", "trolig", "ukjent", "unknown",
        "eller", "med", "og", "av", "for", "fra", "som", "mulig",
        "antatt", "probably", "likely", "possibly", "treverk", "lakkert",
        "kropp", "gripebrett", "metallhardware", "plastplekterbrett",
        "plast", "produksjon", "produced", "made"
      ]);

      return uniqueWords(value)
        .filter(w => !stop.has(w.toLowerCase()))
        .map(w => w.replace(/[^\p{L}\p{N}.]/gu, ""))
        .filter(Boolean)
        .slice(0, maxWords)
        .join(" ");
    }

    function extractYear(value) {
      const m = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
      return m ? Number(m[1]) : null;
    }

    function extractYears(value) {
      const matches = String(value || "").match(/\b(19\d{2}|20\d{2})\b/g) || [];
      return [...new Set(matches.map(Number))];
    }

    function extractCountry(value) {
      const s = String(value || "").toLowerCase();
      if (/\bmexic/.test(s) || /\bmim\b/.test(s)) return "mexico";
      if (/\busa\b|\bamerican\b|\bmade in usa\b/.test(s)) return "usa";
      if (/\bjapan\b|\bjapanese\b/.test(s)) return "japan";
      if (/\bkorea\b|\bkorean\b/.test(s)) return "korea";
      if (/\bindonesia\b|\bindonesian\b/.test(s)) return "indonesia";
      if (/\bchina\b|\bchinese\b/.test(s)) return "china";
      return null;
    }

    function extractAgeGroup(...values) {
      const s = values
        .map(v => String(v || ""))
        .join(" ")
        .toLowerCase();

      if (/\b(kids?|kid|children|child|junior|youth|infant|baby|toddler)\b/.test(s)) {
        return "kids";
      }

      if (/\b(adult|adults|men|mens|women|womens|man|woman)\b/.test(s)) {
        return "adult";
      }

      return null;
    }

    function detectCategory(...values) {
      const s = values
        .map(v => String(v || ""))
        .join(" ")
        .toLowerCase();

      if (/\b(playstation|ps5|xbox|nintendo switch|console|konsoll)\b/.test(s)) {
        return "console";
      }

      if (/\b(bicycle|bike|sykkel|el-sykkel|elsykkel|e-bike|ebike|trekking bike|pedelec)\b/.test(s)) {
        return "bicycle";
      }

      if (/\b(guitar|gitar|stratocaster|telecaster|les paul|precision bass|jazz bass)\b/.test(s)) {
        return "guitar";
      }

      if (/\bbirkenstock\b/.test(s)) {
        return "footwear";
      }

      return "generic";
    }

    function buildStrictQueries(parsed) {
      const info = parsed?.item_info || {};

      const brand = compact(info.brand, 1);
      const model = compact(info.model, 3);
      const type = compact(info.type, 2);
      const manufacturer = compact(info.manufacturer, 2);
      const material = compact(info.material, 1);
      const aiQuery = compact(parsed.ebay_search_query, 5);

      // Finn konkret år fra all identifikasjonsinformasjon.
      // Dette er viktig når AI-en skriver 1995 i navn/beskrivelse,
      // men ikke legger det i year_or_period.
      const year =
        extractYear(info.year_or_period) ||
        extractYear(parsed.name) ||
        extractYear(parsed.description) ||
        extractYear(parsed.ebay_search_query);

      const country =
        extractCountry(info.year_or_period) ||
        extractCountry(info.manufacturer) ||
        extractCountry(parsed.name) ||
        extractCountry(parsed.description);

      const ageGroup = extractAgeGroup(
        parsed.name,
        parsed.description,
        info.type,
        info.model,
        info.year_or_period
      );

      const category = detectCategory(
        parsed.name,
        parsed.description,
        info.type,
        info.model,
        info.brand,
        parsed.ebay_search_query
      );

      // Bare/assumed bicycle years are not hard filters.
      const hardYear = category === "guitar" ? year : null;

      const candidates = [];

      // Førstevalg: mest presise identifikasjon med konkret år når vi kjenner det.
      if (brand && model && country && hardYear) {
        candidates.push(`${brand} ${model} ${country} ${hardYear}`);
      }

      if (brand && model && hardYear) {
        candidates.push(`${brand} ${model} ${hardYear}`);
      }

      // Land uten år brukes fortsatt som søkestøtte, men treff uten
      // dokumentert år blir ikke godkjent som prisreferanser når year finnes.
      if (brand && model && country) {
        candidates.push(`${brand} ${model} ${country}`);
      }

      if (brand && model) {
        candidates.push(`${brand} ${model}`);
      }

      // AI-søket brukes kun hvis det allerede er kort og produktorientert.
      if (aiQuery) {
        candidates.push(aiQuery);
      }

      const out = [];
      const seen = new Set();

      for (const raw of candidates) {
        const q = compact(raw, 6);
        if (!q || q.length < 4) continue;

        const key = q.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(q);

        if (out.length >= 5) break;
      }

      return {
        queries: out,
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
        variant_uncertain: /cannot be confirmed|can't be confirmed|cannot be determined|exact variant|variant.*cannot|eksakt variant|variant.*ikke.*bekreft|kan ikke bekreftes/i.test(
          `${parsed.description || ""} ${info.uncertainties || ""} ${info.model || ""}`
        )
      };
    }

    /*
     * ---------------------------------------------------------
     * VIKTIG: STRENG RELEVANSEFILTER
     * ---------------------------------------------------------
     *
     * Vi skal ikke bare søke bredt og ta medianen av alt.
     * Hver eBay-annonse får en relevansscore.
     *
     * Eksempel:
     * Mexican Standard Stratocaster -> høy score
     * American Standard Stratocaster -> avvises
     * gitarpedal -> avvises
     * tuner -> avvises
     * gitarcase -> avvises
     */

    function scoreListing(title, criteria) {
      const raw = String(title || "");
      const t = raw.toLowerCase();

      const brand = String(criteria.brand || "").toLowerCase();
      const model = String(criteria.model || "").toLowerCase();
      const type = String(criteria.type || "").toLowerCase();
      const country = criteria.country;
      const year = criteria.year;
      const material = String(criteria.material || "").toLowerCase();
      const variantUncertain = Boolean(criteria.variant_uncertain);
      const category = criteria.category || "generic";

      let score = 0;
      const reasons = [];

      const accessoryTerms = [
        "pedal", "effect pedal", "fuzz", "overdrive", "distortion",
        "tuner", "strap", "strings", "string set", "pick", "plectrum",
        "pickup", "pickguard", "bridge", "neck", "body only", "body",
        "replacement body", "replacement neck", "case only", "gig bag",
        "gigbag", "hardcase", "flight case", "cable", "stand",
        "wall hanger", "capo", "knob", "potentiometer", "switch",
        "sticker", "decal", "parts", "part", "repair", "manual",
        "book", "poster", "shirt", "t-shirt", "cover", "cover only",
        "nur gehäuse", "nur gehause", "nur korpus", "nur body",
        "nur hals", "nur neck", "nur chassis", "gehäuse only",
        "gehause only", "bodyteil", "korpus", "chassis",
        "ersatzteil", "ersatzteile", "spare part", "replacement part",
        "ohne hals", "ohne neck", "ohne hardware", "ohne elektronik",
        "ohne pickup",
        "ladegerät", "ladegerat", "charger", "akku ladegerät",
        "akku ladegerat", "battery charger", "battery only", "akku only",
        "display only", "motor only", "engine only", "wheel only",
        "laufrad only", "fork only", "gabel only", "saddle only",
        "sattel only", "pedal set", "disc drive only", "disc drive",
        "laufwerk only", "laufwerk", "repair service", "reparatur"
      ];

      const wrongModelTerms = [
        "american standard", "american professional", "american ultra",
        "american vintage", "player", "player ii", "vintera",
        "performer", "elite", "ultra", "deluxe", "lead iii",
        "squier", "telecaster", "jazzmaster", "jaguar"
      ];

      // Direkte avvisning av tilbehør/deler.
      if (accessoryTerms.some(term => t.includes(term))) {
        return { score: -100, accepted: false, reason: "tilbehør/del" };
      }

      // SYKKEL: batterilåser, låser, nøkler og andre smådeler skal ikke
      // kunne bli "eksakte" treff bare fordi merke + modell står i tittelen.
      if (category === "bicycle") {
        const bicyclePartTerms = [
          "akku schloss", "battery lock", "battery key", "akku schloss set",
          "lock set", "frame lock", "rahmenschloss", "battery cover",
          "akku deckel", "akkugehäuse", "akku gehause", "motor cover",
          "display", "controller", "sensor", "speed sensor", "chainring",
          "kassette", "derailleur", "schaltwerk", "brake rotor",
          "bremsrotor", "brake lever", "bremshebel", "charger",
          "ladegerät", "ladegerat", "key only", "schlüssel only",
          "schluessel only", "spare key", "ersatzschlüssel", "ersatzschluessel"
        ];

        if (bicyclePartTerms.some(term => t.includes(term))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "sykkeldel/tilbehør"
          };
        }

        // En ren del-/tilbehørstittel uten tydelig komplett sykkelord skal
        // aldri få høy score bare fra merke + modell.
        const completeBikeWords = /\b(bike|bicycle|e-bike|ebike|trekking|city bike|mountain bike|mtb|pedelec|fahrrad|elektrofahrrad|sykkel|trekkingrad|trekking e-bike)\b/.test(t);
        const obviousPartWords = /\b(lock|schloss|key|battery|akku|charger|ladegerät|ladegerat|motor|display|sensor|fork|gabel|wheel|laufrad|vorderrad|hinterrad|frame|rahmen|sattel|saddle|seat|pedal|brake|bremse|derailleur|schaltwerk|kassette|abdeckung|deckung|cover|schutz|mudguard|schutzblech|fender|rack|gepäckträger|gepacktrager|kickstand|ständer|staender|chainring|kettenblatt|rotor|disc|laufrad)\b/.test(t);

        if (obviousPartWords && !completeBikeWords) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "ikke komplett sykkel"
          };
        }

        // Titler som eksplisitt beskriver en ramme/deksel/hjul/skjerm osv.
        // skal avvises selv om merke og modell står i tittelen.
        if (!completeBikeWords && /\b(rahmen|frame|abdeckung|deckung|cover|schutz|laufrad|vorderrad|hinterrad|wheel|gabel|fork|sattel|saddle|rack|gepäckträger|mudguard|schutzblech)\b/.test(t)) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "sykkeldel/ramme/hjul"
          };
        }
      }

      // KONSOLL: en PS5-disc-stasjon, fjernkontroll eller reparasjonsobjekt
      // er ikke en sammenlignbar komplett konsoll.
      if (category === "console") {
        const consolePartTerms = [
          "disc drive", "disc-drive", "laufwerk", "disc reader",
          "controller only", "dualsense only", "gamepad only",
          "replacement", "repair", "defekt", "broken", "for parts",
          "parts only", "fan only", "power supply", "netzteil",
          "stand only", "vertical stand", "faceplate", "cover only"
        ];

        if (consolePartTerms.some(term => t.includes(term))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "konsolldel/tilbehør"
          };
        }

        // Variantseparasjon for PS5: Slim, Pro og standard må ikke blandes.
        const targetSlim = /\bslim\b/.test(model + " " + type + " " + criteria.model);
        const targetPro = /\bpro\b/.test(model + " " + type + " " + criteria.model);
        const listingSlim = /\bslim\b/.test(t);
        const listingPro = /\bpro\b/.test(t);

        if (targetSlim && listingPro) {
          return { score: -100, accepted: false, reason: "PS5 Pro vs Slim" };
        }
        if (targetPro && listingSlim) {
          return { score: -100, accepted: false, reason: "PS5 Slim vs Pro" };
        }

        const targetDisc = /\b(disc|blu[ -]?ray|diskstasjon|disk)\b/.test(
          `${model} ${type} ${criteria.model}`
        );
        const targetDigital = /\b(digital|digital edition)\b/.test(
          `${model} ${type} ${criteria.model}`
        );
        const listingDisc = /\b(disc|blu[ -]?ray|diskstasjon|disk)\b/.test(t);
        const listingDigital = /\bdigital\b/.test(t);

        if (targetDisc && listingDigital && !listingDisc) {
          return { score: -100, accepted: false, reason: "PS5 Digital vs Disc" };
        }
        if (targetDigital && listingDisc) {
          return { score: -100, accepted: false, reason: "PS5 Disc vs Digital" };
        }
      }

      if (
        /\b(nur|only|just)\b.{0,25}\b(gehäuse|gehause|korpus|body|chassis|case)\b/.test(t) ||
        /\b(gehäuse|gehause|korpus|body|chassis|case)\b.{0,25}\b(nur|only|just)\b/.test(t) ||
        /\b(ohne|without)\b.{0,25}\b(hals|neck|hardware|elektronik|electronics|pickup)\b/.test(t)
      ) {
        return { score: -100, accepted: false, reason: "kun del/hus" };
      }

      if (brand && t.includes(brand)) {
        score += 25;
        reasons.push("merke");
      } else if (brand) {
        score -= 30;
      }

      // Modell: skill mellom selve modellnavnet og variantord.
      // Eksempel: "Standard Stratocaster" skal kunne matche
      // "Fender Mexico Stratocaster 1995" selv om "Standard" mangler.
      const modelWords = model
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 3);

      const genericVariantWords = new Set([
        "standard", "original", "classic", "vintage", "modern",
        "series", "serie", "model", "modell", "electric", "elektrisk"
      ]);

      const coreModelWords = modelWords.filter(
        word => !genericVariantWords.has(word)
      );

      let modelMatches = 0;
      for (const word of coreModelWords) {
        if (t.includes(word)) modelMatches++;
      }

      // Vi krever kjerne-modellen, men ikke nødvendigvis hvert variantord.
      if (
        coreModelWords.length &&
        modelMatches === coreModelWords.length
      ) {
        score += 50;
        reasons.push("kjerne-modell");
      } else if (
        coreModelWords.length &&
        modelMatches >= Math.max(1, Math.ceil(coreModelWords.length * 0.6))
      ) {
        score += 25;
        reasons.push("delvis kjerne-modell");
      } else if (coreModelWords.length) {
        score -= 35;
      }

      // Variantord som er viktige kan gi bonus, men skal normalt ikke
      // være absolutte krav når kjerne-modellen er identisk.
      const variantWords = modelWords.filter(
        word => genericVariantWords.has(word)
      );

      if (variantWords.some(word => t.includes(word))) {
        score += 8;
        reasons.push("variant");
      }

      // Type er støtte, ikke hovedkrav.
      const typeWords = type
        .split(/\s+/)
        .filter(w => w.length >= 4);

      if (typeWords.some(w => t.includes(w))) {
        score += 10;
        reasons.push("type");
      }

      // Aldersgruppe er viktig. Hvis AI-en har identifisert en voksenmodell,
      // skal Kids/Junior/Youth ikke brukes som sammenligningsgrunnlag.
      const listingIsKids =
        /\b(kids?|kid|children|child|junior|youth|infant|baby|toddler)\b/.test(t);

      const listingIsAdult =
        /\b(adult|adults|men|mens|women|womens|man|woman)\b/.test(t);

      if (criteria.ageGroup === "adult" && listingIsKids) {
        return { score: -100, accepted: false, reason: "barnemodell" };
      }

      if (criteria.ageGroup === "kids" && listingIsAdult && !listingIsKids) {
        return { score: -100, accepted: false, reason: "voksenmodell" };
      }

      // Birkenstock: Papillio er en egen produktlinje og skal ikke blandes
      // inn når målet er vanlig Birkenstock Arizona.
      if (
        brand.includes("birkenstock") &&
        !model.toLowerCase().includes("papillio") &&
        /\bpapillio\b/.test(t)
      ) {
        return { score: -100, accepted: false, reason: "Papillio-linje" };
      }

      // Birkenstock-varianter må ikke blandes bare fordi hovedmodellen
      // heter det samme. Dette er spesielt viktig for Arizona.
      if (brand.includes("birkenstock")) {
        const specialVariantTerms = [
          "big buckle", "big-buckle", "bigbuckle",
          "eva", "essentials", "essential", "platform",
          "split", "soft footbed", "soft-footbed", "shearling",
          "fur", "braided", "braid", "papillio", "kids",
          "kid", "junior", "youth", "microfiber", "synthetic"
        ];

        if (specialVariantTerms.some(term => t.includes(term))) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: year ? "missing" : "not_required",
            reason: "annen Birkenstock-variant"
          };
        }

        // Hvis AI-en uttrykkelig sier at variant/materiale ikke kan
        // bekreftes, skal et vanlig Arizona-treff ikke kalles eksakt.
        // Det kan fortsatt vises som nærtreff.
        if (variantUncertain) {
          return {
            score: Math.max(score, 50),
            accepted: false,
            near_match: true,
            year_match: "missing",
            reason: "variant ikke bekreftet"
          };
        }

        // Når materialet er kjent, krev at annonsen faktisk viser samme
        // materialfamilie. Leather/leder-varianter får ikke blandes med EVA.
        if (/leather|leder|leatherette|velourleder|suede/.test(material)) {
          if (/\beva\b|synthetic|microfiber/.test(t)) {
            return { score: -100, accepted: false, reason: "annet materiale" };
          }
          if (!/leather|leder|leatherette|velourleder|suede/.test(t)) {
            return {
              score: Math.max(score, 50),
              accepted: false,
              near_match: true,
              year_match: year ? "missing" : "not_required",
              reason: "materiale ikke dokumentert"
            };
          }
        }
      }

      // Country/produksjonsvariant er svært viktig.
      if (country === "mexico") {
        if (/\bmexic|\bmim\b|\bmex\b/.test(t)) {
          score += 35;
          reasons.push("Mexico/MIM");
        }

        if (/\bamerican\b|\busa\b|\bmade in usa\b/.test(t)) {
          return { score: -100, accepted: false, reason: "USA-modell" };
        }
      }

      if (country === "usa") {
        if (/\bamerican\b|\busa\b|\bmade in usa\b/.test(t)) {
          score += 30;
          reasons.push("USA");
        }

        if (/\bmexic|\bmim\b/.test(t)) {
          return { score: -100, accepted: false, reason: "Mexico-modell" };
        }
      }

      // År: når Kistefunn kjenner et konkret produksjonsår,
      // skal prisreferansen dokumentere samme år i selve annonsen.
      // Dette hindrer f.eks. en 1996/1997-gitar eller en udatert
      // modell fra å påvirke verdien av en dokumentert 1995-modell.
      const titleYears = extractYears(t);

      let yearMatch = "not_required";

      if (year) {
        const exact = titleYears.some(y => y === year);
        const otherYear = titleYears.some(y => y !== year);

        if (exact) {
          score += 30;
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
          score += 5;
          reasons.push("år ikke oppgitt");
          yearMatch = "missing";
        }
      }

      // Klare modell-/serievarianter skal ikke blandes med målmodellen.
      // Dette må gjøres FØR vi returnerer relevansresultatet.
      const incompatibleSeries = [
        "classic 60s", "classic series", "vintera", "player ii",
        "american professional", "american ultra", "american vintage",
        "performer", "elite", "deluxe", "anniversary", "reissue"
      ];

      for (const term of incompatibleSeries) {
        if (t.includes(term) && !model.includes(term)) {
          return {
            score: -100,
            accepted: false,
            near_match: false,
            year_match: yearMatch,
            reason: "annen serie/variant"
          };
        }
      }

      // Sterke feilord.
      for (const term of wrongModelTerms) {
        if (!t.includes(term)) continue;

        if (term === "american standard" && country === "mexico") {
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

      const accepted = score >= 45;

      return {
        score,
        accepted,
        near_match: yearMatch === "missing" && accepted,
        year_match: yearMatch,
        reason: reasons.join(", ") || "lav relevans"
      };
    }

    async function searchEbaySingle(query) {
      const token = await getEbayToken();

      if (!token) {
        return {
          enabled: false,
          query,
          sample_size: 0,
          listings: [],
          reason: "eBay-tilkobling er ikke tilgjengelig"
        };
      }

      const url =
        "https://api.ebay.com/buy/browse/v1/item_summary/search" +
        `?q=${encodeURIComponent(query)}` +
        "&limit=50";

      const r = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json",
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_DE"
        }
      });

      const d = await r.json();

      if (!r.ok) {
        return {
          enabled: false,
          query,
          sample_size: 0,
          listings: [],
          reason: d?.errors?.[0]?.message || "eBay-søk feilet"
        };
      }

      const rawItems = Array.isArray(d.itemSummaries)
        ? d.itemSummaries
        : [];

      return {
        enabled: true,
        query,
        rawItems
      };
    }

    async function prepareListing(item, query, criteria) {
      const originalPrice = Number(item?.price?.value);
      const currency = item?.price?.currency;

      if (!Number.isFinite(originalPrice) || !currency) return null;

      const title = item.title || "";
      const relevance = scoreListing(title, criteria);

      // Eksakte treff og gode nærtreff går videre til visning.
      // Nærtreff brukes aldri automatisk i verdiberegningen.
      if (!relevance.accepted && !relevance.near_match) return null;

      const rate = await getExchangeRate(currency, "NOK");
      if (!rate) return null;

      const nok = originalPrice * rate;
      if (!Number.isFinite(nok) || nok <= 0) return null;

      return {
        title,
        price: {
          value: originalPrice,
          currency
        },
        nok: Math.round(nok),
        url: item.itemWebUrl || "",
        query,
        relevance_score: relevance.score,
        relevance_reason: relevance.reason,
        year_match: relevance.year_match || "not_required",
        match_tier: relevance.near_match ? "near" : "exact",
        valuation_tier:
          relevance.near_match
            ? (
                // Same model + same material is useful market evidence
                // when the object itself has no concrete year requirement.
                (criteria.year ? "near" : "same_model")
              )
            : "exact"
      };
    }

    async function searchEbay(parsed) {
      const built = buildStrictQueries(parsed);

      if (!built.queries.length) {
        return {
          enabled: false,
          reason: "Ingen egnet eBay-søkestreng",
          queries: [],
          successful_queries: []
        };
      }

      const results = await Promise.all(
        built.queries.map(async q => {
          try {
            return await searchEbaySingle(q);
          } catch {
            return {
              enabled: false,
              query: q,
              rawItems: []
            };
          }
        })
      );

      const preparedNested = await Promise.all(
        results.map(async result => {
          if (!result?.enabled) return [];

          const list = [];
          for (const item of result.rawItems || []) {
            const prepared = await prepareListing(
              item,
              result.query,
              built
            );
            if (prepared) list.push(prepared);
          }
          return list;
        })
      );

      const all = [];
      const seen = new Set();

      for (const list of preparedNested) {
        for (const item of list) {
          const key = String(item.url || item.title)
            .trim()
            .toLowerCase();

          if (!key || seen.has(key)) continue;

          seen.add(key);
          all.push(item);
        }
      }

      // Høyest relevans først.
      all.sort((a, b) => {
        if (b.relevance_score !== a.relevance_score) {
          return b.relevance_score - a.relevance_score;
        }
        return a.nok - b.nok;
      });

      // Tre nivåer:
      // 1) exact       = samme dokumenterte variant + år når år er kjent
      // 2) same_model  = samme modell/materialfamilie, men enkelte detaljer
      //                  som farge/størrelse/år er ikke bekreftet
      // 3) near         = nyttig som visning, men ikke verdigrunnlag
      //
      // Hvis objektet har et konkret år (f.eks. Fender 1995), skal
      // year-missing treff IKKE påvirke verdien.
      // Hvis objektet ikke har et konkret år (f.eks. en sandal), kan
      // same_model brukes sammen med exact.
      const exactPool = all.filter(
        x => x.match_tier === "exact" && x.relevance_score >= 45
      );

      const sameModelPool = all.filter(
        x =>
          x.valuation_tier === "same_model" &&
          x.relevance_score >= 50
      );

      const valuationPool = built.year
        ? all.filter(
            x => x.match_tier === "exact" && x.relevance_score >= 60
          )
        : all.filter(
            x =>
              (
                x.match_tier === "exact" ||
                x.valuation_tier === "same_model"
              ) &&
              x.relevance_score >= 50
          );

      const pool =
        valuationPool.length >= 3
          ? valuationPool
          : (
              built.year
                ? exactPool
                : (
                    sameModelPool.length
                      ? [...exactPool, ...sameModelPool]
                      : exactPool
                  )
            );

      const filteredPool = removeOutliers(pool);

      const finalPool =
        filteredPool.length >= 2
          ? filteredPool
          : pool;

      const nearMatches = all
        .filter(x => x.match_tier === "near")
        .slice(0, 8);

      const sameModelMatches = all
        .filter(x => x.valuation_tier === "same_model")
        .slice(0, 8);

      const prices = finalPool
        .map(x => Number(x.nok))
        .filter(Number.isFinite)
        .filter(x => x > 0);

      const successfulQueries = [
        ...new Set(
          all
            .filter(x => x.match_tier === "exact" && x.relevance_score >= 45)
            .map(x => x.query)
        )
      ];

      const nearMatchQueries = [
        ...new Set(
          nearMatches.map(x => x.query)
        )
      ];

      const medianNok = median(prices);
      const lowNok = percentile(prices, 0.15);
      const highNok = percentile(prices, 0.85);

      // Samme annonsetekst til samme pris er ikke to uavhengige
      // markedsobservasjoner. Dette hindrer duplikater fra å øke vekten.
      const distinctValuationKeys = new Set(
        finalPool.map(x => `${String(x.title || "").toLowerCase().trim()}|${Math.round(Number(x.nok) || 0)}`)
      );

      return {
        enabled: true,
        marketplace: "EBAY_DE",
        query: built.queries[0],
        queries: built.queries,
        successful_queries: successfulQueries,
        near_match_queries: nearMatchQueries,
        total_candidates: all.length,
        sample_size: finalPool.length,
        exact_match_count: exactPool.length,
        distinct_valuation_count: distinctValuationKeys.size,
        same_model_match_count: sameModelMatches.length,
        near_match_count: nearMatches.length,
        median_nok: Number.isFinite(medianNok)
          ? Math.round(medianNok)
          : null,
        low_nok: Number.isFinite(lowNok)
          ? Math.round(lowNok)
          : null,
        high_nok: Number.isFinite(highNok)
          ? Math.round(highNok)
          : null,
        filtering: {
          strict: true,
          minimum_relevance_score: 45,
          exact_year_required_for_valuation: Boolean(built.year),
          valuation_uses_same_model_when_year_not_required: !built.year,
          valuation_minimum_relevance_score:
            valuationPool.length >= 3 ? 60 : 50
        },
        listings: all.slice(0, 12).map(item => ({
          title: item.title,
          price: item.price,
          price_nok: item.nok,
          url: item.url,
          query: item.query,
          relevance_score: item.relevance_score,
          match_tier: item.match_tier,
          year_match: item.year_match
        })),
        exact_listings: all
          .filter(item => item.match_tier === "exact")
          .slice(0, 12)
          .map(item => ({
            title: item.title,
            price: item.price,
            price_nok: item.nok,
            url: item.url,
            query: item.query,
            relevance_score: item.relevance_score,
            match_tier: "exact",
            year_match: item.year_match
          })),
        same_model_listings: sameModelMatches.map(item => ({
          title: item.title,
          price: item.price,
          price_nok: item.nok,
          url: item.url,
          query: item.query,
          relevance_score: item.relevance_score,
          match_tier: "same_model",
          year_match: item.year_match
        })),
        near_listings: nearMatches.map(item => ({
          title: item.title,
          price: item.price,
          price_nok: item.nok,
          url: item.url,
          query: item.query,
          relevance_score: item.relevance_score,
          match_tier: "near",
          year_match: item.year_match
        }))
      };
    }

    /* ---------------------------------------------------------
       5. KJØR eBAY
       --------------------------------------------------------- */

    let ebay = {
      enabled: false,
      reason: "eBay-søk ikke utført",
      queries: [],
      successful_queries: []
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

    /* ---------------------------------------------------------
       6. KOMBINER AI + eBAY
       --------------------------------------------------------- */

    let finalEstimated = aiEstimated;
    let finalLow = aiLow;
    let finalHigh = aiHigh;
    let ebayWeight = 0;
    let valuationMethod = "AI-estimat uten eBay-grunnlag";

    const ebaySampleSize =
      ebay?.enabled && Number.isFinite(Number(ebay.sample_size))
        ? Number(ebay.sample_size)
        : 0;

    if (
      ebaySampleSize > 0 &&
      Number.isFinite(ebay.median_nok)
    ) {
      const exactCount = Number(ebay.exact_match_count || 0);
      const distinctCount = Number(ebay.distinct_valuation_count || ebaySampleSize || 0);
      const sameModelCount = Number(ebay.same_model_match_count || 0);
      const hasYear = Boolean(ebay?.filtering?.exact_year_required_for_valuation);

      // eBay skal ha betydelig større vekt når vi faktisk har gode,
      // uavhengige sammenligninger. Men ett enkelt aktivt treff skal
      // fortsatt ikke overstyre AI-estimatet fullstendig.
      if (hasYear && exactCount >= 5 && distinctCount >= 4) ebayWeight = 0.75;
      else if (hasYear && exactCount >= 3 && distinctCount >= 3) ebayWeight = 0.65;
      else if (hasYear && exactCount >= 2 && distinctCount >= 2) ebayWeight = 0.55;
      else if (hasYear && exactCount >= 1) ebayWeight = 0.40;
      else if (!hasYear && sameModelCount >= 8 && distinctCount >= 6) ebayWeight = 0.60;
      else if (!hasYear && sameModelCount >= 4 && distinctCount >= 3) ebayWeight = 0.50;
      else if (!hasYear && (sameModelCount >= 2 || exactCount >= 2)) ebayWeight = 0.40;
      else ebayWeight = 0.25;

      const aiWeight = 1 - ebayWeight;

      if (Number.isFinite(aiEstimated)) {
        finalEstimated = Math.round(
          aiEstimated * aiWeight +
          ebay.median_nok * ebayWeight
        );
      } else {
        finalEstimated = Math.round(ebay.median_nok);
      }

      if (Number.isFinite(aiLow) && Number.isFinite(ebay.low_nok)) {
        finalLow = Math.round(
          aiLow * aiWeight +
          ebay.low_nok * ebayWeight
        );
      }

      if (Number.isFinite(aiHigh) && Number.isFinite(ebay.high_nok)) {
        finalHigh = Math.round(
          aiHigh * aiWeight +
          ebay.high_nok * ebayWeight
        );
      }

      const valuationBasis =
        ebay?.filtering?.exact_year_required_for_valuation
          ? "eksakte treff"
          : "samme modell/materiale";

      valuationMethod =
        `AI + eBay-markedsdata (${Math.round(ebayWeight * 100)} % eBay-vekt, ${ebaySampleSize} treff / ${Number(ebay.distinct_valuation_count || ebaySampleSize)} unike ${valuationBasis})`;
    }

    if (Number.isFinite(finalEstimated)) {
      if (!Number.isFinite(finalLow)) {
        finalLow = Math.round(finalEstimated * 0.7);
      }

      if (!Number.isFinite(finalHigh)) {
        finalHigh = Math.round(finalEstimated * 1.3);
      }

      finalLow = Math.min(finalLow, finalEstimated);
      finalHigh = Math.max(finalHigh, finalEstimated);
    }

    /* ---------------------------------------------------------
       7. RETURNER
       --------------------------------------------------------- */

    return res.status(200).json({
      name: parsed.name || "Ukjent",
      description: parsed.description || "",

      estimated_value_nok:
        Number.isFinite(finalEstimated) ? finalEstimated : null,
      low_value_nok:
        Number.isFinite(finalLow) ? finalLow : null,
      high_value_nok:
        Number.isFinite(finalHigh) ? finalHigh : null,

      ai_estimated_value_nok:
        Number.isFinite(aiEstimated) ? aiEstimated : null,
      ai_low_value_nok:
        Number.isFinite(aiLow) ? aiLow : null,
      ai_high_value_nok:
        Number.isFinite(aiHigh) ? aiHigh : null,

      confidence: parsed.confidence || "lav",
      condition: parsed.condition || "",

      brand: itemInfo.brand,
      model: itemInfo.model,
      manufacturer: itemInfo.manufacturer,
      type: itemInfo.type,
      year_or_period: itemInfo.year_or_period,
      material: itemInfo.material,
      serial_number: itemInfo.serial_number,

      identifying_features: itemInfo.identifying_features,
      modifications: itemInfo.modifications,
      condition_details: itemInfo.condition_details,
      value_factors: itemInfo.value_factors,
      uncertainties: itemInfo.uncertainties,
      item_info: itemInfo,

      ebay_search_query: parsed.ebay_search_query || "",
      ebay,

      valuation_method: valuationMethod,
      ebay_weight_percent: Math.round(ebayWeight * 100)
    });

  } catch (e) {
    return res.status(500).json({
      error: e?.message || "Ukjent feil"
    });
  }
}
