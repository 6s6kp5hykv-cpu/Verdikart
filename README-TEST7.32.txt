# Kistefunn Test 7.32 – eBay-detaljdata og aggregert diagnostikk

Backendversjon: `v15.5.63-test7.32-ebay-detail-diagnostics`

## Endringer

- `api/analyze.js`: `prepareListing` viderefører nå bare de interne feltene `_ebay_detail_loaded` og `_ebay_aspects` fra den berikede eBay-annonsen. Søkeresultater, rangering, pakkefilter, verdiberegning og markedsvekting er ikke endret. Detaljvelgeren og detaljberikeren bruker produksjonslogikk som eksporterte, testbare funksjoner. Diagnostikken legges ved som aggregerte tellere.
- `api/_diagnostics.js`: strikt allowlist for aggregater og forhåndsdefinerte årsakskategorier; ukjente felt og rå verdier forkastes. Sanitizeren utelater også `_ebay_aspects` og `_ebay_detail_loaded` på alle nivåer.
- `scripts/test-test7.32-ebay-detail-diagnostics.mjs`: dekker detaljdata gjennom `prepareListing`, kandidatdiagnostikkens objekt, utvalg, manglende ID/token, vellykkede svar med/uten aspekter, HTTP-feil, ugyldig JSON, cache og sanitizering.
- `scripts/test-test7.29-nintendo-search-fix.mjs`: versjonsassertion peker på aktuell backend; Nintendo-funksjonsassertions er beholdt.
- `scripts/test-test7.30-analysis-diagnostics.mjs`: bekrefter at item-ID ikke lagres i annonseaudit.
- `scripts/test-test7.22-ebay-throttle-control.mjs` og `scripts/test-test7.23-ebay-error-diagnostics.mjs`: historiske funksjonskontroller beholdes, mens kun foreldede backendversjonsassertions er flyttet til gjeldende backendversjon.

## Tellere

- `eligible`: antall rangerte kandidatobservasjoner med score minst 20 før item-ID- og kapasitetsbegrensning.
- `attempted`: faktiske HTTP-detaljforespørsler etter at et token er tilgjengelig.
- `succeeded` / `failed`: gjensidig utelukkende utfall for faktiske forsøk; summen skal være `attempted`.
- `aspects_returned` / `aspects_empty`: deler vellykkede svar i svar med minst ett parsebart aspektfelt og svar uten slike felt; summen skal være `succeeded`.
- `skipped`: kvalifiserte observasjoner som ikke førte til en forespørsel, fordelt på `missing_item_id`, `missing_token` og `not_selected`.
- `cache_reused`: detaljberikingskall som brukte en allerede utført forespørsel i samme analyse. Dette er separat fra HTTP-forsøk og `skipped`; samme eBay-ID kan forekomme flere ganger, og berikingen går over råresultater mens `eligible` beregnes fra den rangerte listen. Derfor skal disse tellerne ikke summeres på tvers som om de var samme populasjon.
- Feil fordeles på faste kategorier `http_error`, `request_exception` og `invalid_json`. Ingen rå feilmeldinger, ID-er, titler, URL-er, aspektverdier, selgerdata eller tokens inngår i den lagrede rapporten.

`eligible` teller rangerte kandidatobservasjoner per søk. `attempted`, `succeeded`, `failed` og aspektutfall gjelder faktiske HTTP-kall. `skipped` registrerer eksplisitte utvalg/token/ID-grunner; cache-gjenbruk er en egen dimensjon. `succeeded + failed = attempted`, og `aspects_returned + aspects_empty = succeeded`.

## Tester kjørt lokalt

Alle kommandoer nedenfor ble kjørt 2026-10-13. Resultatene er fra den lokale arbeidskopien; ingen live-analyse eller eksterne eBay/OpenAI-kall ble utført.

| Kommando | Resultat |
| --- | --- |
| `node --check api/analyze.js` | BESTÅTT |
| `node --check api/_diagnostics.js` | BESTÅTT |
| `node --check api/admin-diagnostics.js` | BESTÅTT |
| `node --check scripts/test-test7.32-ebay-detail-diagnostics.mjs` | BESTÅTT |
| `node --check scripts/test-test7.30-analysis-diagnostics.mjs` | BESTÅTT |
| `node --check scripts/test-test7.29-nintendo-search-fix.mjs` | BESTÅTT |
| `node --check scripts/test-test7.22-ebay-throttle-control.mjs` | BESTÅTT |
| `node --check scripts/test-test7.23-ebay-error-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.32-ebay-detail-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.30-analysis-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.29-nintendo-search-fix.mjs` | BESTÅTT |
| `node scripts/test-test7.22-ebay-throttle-control.mjs` | BESTÅTT |
| `node scripts/test-test7.23-ebay-error-diagnostics.mjs` | BESTÅTT |
| `git diff --check` | BESTÅTT |

Test 7.22 og 7.23 feilet tidligere utelukkende på historiske versjonsstrenger. I denne kandidaten ble bare versjonsassertionene oppdatert; eksisterende throttle- og feildiagnostikkassertions kjører fortsatt og består. Ingen forventninger til funksjonsatferd ble svekket.

## Begrensning og neste steg

Dette beviser lokal dataflyt og sanitizering, ikke at eBay-detaljforespørsler lykkes i Vercel Preview. Etter separat gjennomgang og Preview-deploy kan én kontrollert analyse brukes til å lese `outcome_counts`. Ikke konkluder med Preview-atferd før rapporten fra den kjørende deploymenten er hentet.
