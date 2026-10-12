Kistefunn Test 7.23 – v15.5.56 – eBay error diagnostics

Bygger på Test 7.22 fra den opplastede Testrunner-ZIP-en. Preview-only; ikke godkjent for produksjon.

Endret fil:
- api/analyze.js: versjonsnummer oppdatert til v15.5.56-test7.23-ebay-error-diagnostics.
- Ved mislykket eBay Browse API-søk logges nå begrensede diagnostikkfelt: status, retry count, Retry-After, utvalgte rate-limit/request-ID/content-type-headere og inntil tre strukturerte API-feil med avkortede meldinger/parametere.
- Ingen Authorization-header, access-token, client secret eller andre legitimasjonsverdier logges.
- Søke- og verdilogikk ellers uendret fra Test 7.22.

Teststatus:
- Kildekontroll og Node.js syntakskontroll kjøres lokalt.
- Ikke kjørt live Preview-test i denne ZIP-byggingen.
- Må deployes kun til Testrunner Preview og testes med én Nintendo Switch OLED-analyse.
- Sammenlign diagnostikkfelt ved fortsatt HTTP 429; ikke bruk AI-estimat som om det var markedsverifisert.
