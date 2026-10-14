# Kistefunn Test 7.34 – isolerte aspektverdier

Backendversjon: `v15.5.65-test7.34-isolated-aspect-signals`

## Endring

Aspektverdier vurderes nå enkeltvis og deles i klausuler ved vanlige skilletegn og engelske/norske/tyske konjunksjoner. Negativ evidens for én utstyrstype kan dermed ikke sette signalet for en annen type til `false`.

Signalregelen er: bare negativ evidens for en type gir `false`; bare ikke-negativ omtale i et gjenkjent innholdsfelt gir `true`; ingen treff eller motstridende positive og negative treff for samme type gir `null`. Motstrid rapporteres som `conflicting_evidence`. Rekkefølgen på verdiene påvirker ikke resultatet.

Ingen endringer er gjort i `classifyNintendoSwitchOledListing`, Nintendo-godkjenningsreglene, eBay-detaljoppslag, prisberegning, intervall eller markedsvekter.

## Filer

Test 7.34 bevarer de ni lokale Test 7.33-filene og legger til denne README-en og `scripts/test-test7.34-isolated-aspect-signals.mjs`. Backend/sanitizer og relevante historiske versjonsassertions oppdateres; Test 7.25 og 7.26 forblir uendret.

## Testresultater

Kjørt lokalt 2026-10-14. Ingen live-analyse eller eksterne API-kall ble utført.

| Kommando | Resultat |
| --- | --- |
| `node --check api/analyze.js` | BESTÅTT |
| `node --check api/_diagnostics.js` | BESTÅTT |
| `node --check scripts/test-test7.33-ebay-aspect-diagnostics.mjs` | BESTÅTT |
| `node --check scripts/test-test7.34-isolated-aspect-signals.mjs` | BESTÅTT |
| `node scripts/test-test7.34-isolated-aspect-signals.mjs` | BESTÅTT |
| `node scripts/test-test7.33-ebay-aspect-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.22-ebay-throttle-control.mjs` | BESTÅTT |
| `node scripts/test-test7.23-ebay-error-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.29-nintendo-search-fix.mjs` | BESTÅTT |
| `node scripts/test-test7.30-analysis-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.32-ebay-detail-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.25-package-gate.mjs` | FEILET før funksjonsassertions: forventer foreldet `v15.5.58-test7.25-switch-package-valuation-gate` |
| `node scripts/test-test7.26-fail-closed-package-valuation.mjs` | FEILET før funksjonsassertions: forventer foreldet `v15.5.59-test7.26-fail-closed-package-valuation-gate` |
| `git diff --check` | BESTÅTT (Git viste kun linjesluttvarsler) |

Test 7.25 og 7.26 er uendret. De eldre versjonskontrollene stopper kjøringen før funksjonsassertions.
