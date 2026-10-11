KISTEFUNN TEST 7.5 – AUTOMATISK TESTPAKKE (KANDIDAT)
Dato: 2026-10-11
Base: Kistefunn Test 7.4 candidate
Backend: v15.5.39-test7.4-console-search-fallback (uendret)

NY FIL
- test-runner.html: enkel testside med knapper for Nintendo Switch OLED, Squier-regresjon eller begge.
- Bruker eksisterende POST /api/analyze med tekstbeskrivelse, og samler backend-versjon, verdifelt, timings, diagnostic_detail og eventuelle feil i én rapport.
- Rapport kan kopieres eller lastes ned som JSON.

VIKTIG
- Ingen automatisk testkjøring ved åpning. Bruker må trykke en knapp.
- Dette sender reelle analyseforespørsler og kan bruke OpenAI/eBay-kvoter. Kjør bare på Test-7, ikke produksjon.
- Tekstbaserte testinput, ikke bildebaserte tester. Dette er et første trinn for å slippe skjermbilder; det erstatter ikke alle bilde-/UI-tester.
- Runneren viser bare diagnostikk som API-et returnerer. Den kan ikke hente server-side logger som ikke returneres av /api/analyze.
- Backend er uendret. Ingen deploy er utført.

LOKALE KONTROLLER
Kjør ZIP-integritet, JavaScript-syntaks for backend/biblioteker og inline scripts. Live Preview/eBay/OpenAI/Supabase er ikke verifisert av disse lokale kontrollene.
