# Kistefunn Test 7.33 – eBay-aspektdiagnostikk

Backendversjon: `v15.5.64-test7.33-ebay-aspect-diagnostics`

## Formål og endringer

Test 7.33 skiller mellom manglende aspektkart, tomt kart, bare ukjente feltnavn og gjenkjente innholdsfelt. Per kandidat rapporteres bare antall gjenkjente/ukjente felt, faste evidenskategorier for dock, Joy-Con/kontroller og strømforsyning, og de eksisterende boolske/null signalene. Feltnavn, aspektverdier, titler, item-ID-er, URL-er og vilkårlige leverandørdata lagres eller returneres ikke.

`classifyNintendoSwitchOledListing`, pakkefilterets regler og rekkefølge, søketerskler, prisberegning og verdsettingsvekter er uendret. Aspektdiagnostikken er observasjon og påvirker ikke godkjenning. Manglende bevis forblir `null`.

## Endrede filer

- `api/analyze.js`: Test 7.33-versjon og diagnostiske aspektkarttilstander/evidenskategorier.
- `api/_diagnostics.js`: streng allowlist for de nye enum- og tellingsfeltene.
- `scripts/test-test7.22-ebay-throttle-control.mjs`, `scripts/test-test7.23-ebay-error-diagnostics.mjs`, `scripts/test-test7.29-nintendo-search-fix.mjs`, `scripts/test-test7.32-ebay-detail-diagnostics.mjs`: kun forventet backendversjon oppdatert.
- `scripts/test-test7.30-analysis-diagnostics.mjs`: streng forventning oppdatert med Test 7.33-feltene; eksisterende allowlist- og personvernassertions beholdt.
- `scripts/test-test7.33-ebay-aspect-diagnostics.mjs`: syntetiske positive, negative, manglende/ukjente aspektdata og lekkasjetester.
- Denne README-filen.

## Statuskoder

- `aspect_map_state`: `missing_map`, `empty_map`, `unknown_fields_only` eller `recognized_fields`.
- `aspect_evidence` per utstyrstype: `matched`, `negative_match`, `no_value_match` eller `no_recognized_field`.
- `aspect_signals` beholder `true`/`false`/`null`; fravær av felt eller match blir ikke til et negativt signal.
- Feltantall er begrenset og sanitizeren returnerer bare eksplisitt tillatte felt og enumverdier.

## Tester

Kjørt lokalt 2026-10-14. Ingen live-analyse eller eksterne eBay/OpenAI-kall ble utført.

| Kommando | Resultat |
| --- | --- |
| `node --check api/analyze.js` | BESTÅTT |
| `node --check api/_diagnostics.js` | BESTÅTT |
| `node --check scripts/test-test7.30-analysis-diagnostics.mjs` | BESTÅTT |
| `node --check scripts/test-test7.33-ebay-aspect-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.33-ebay-aspect-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.30-analysis-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.29-nintendo-search-fix.mjs` | BESTÅTT |
| `node scripts/test-test7.32-ebay-detail-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.22-ebay-throttle-control.mjs` | BESTÅTT |
| `node scripts/test-test7.23-ebay-error-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.25-package-gate.mjs` | FEILET før funksjonsassertions: forventer foreldet `v15.5.58-test7.25-switch-package-valuation-gate` |
| `node scripts/test-test7.26-fail-closed-package-valuation.mjs` | FEILET før funksjonsassertions: forventer foreldet `v15.5.59-test7.26-fail-closed-package-valuation-gate` |
| `git diff --check` | BESTÅTT (kun Git CRLF-varsler) |

Test 7.25 og 7.26 er ikke endret. Feilene er versjonsassertions mot den forventede Test 7.33-versjonen; funksjonsassertions i disse to testene ble derfor ikke kjørt.
