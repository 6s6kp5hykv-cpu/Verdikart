KISTEFUNN – TEST 7.8 SCOPE-FIX CANDIDATE
Dato: 2026-10-11
Gren: Testrunner

FORMÅL
Denne pakken viderefører Testrunner-kandidaten fra Test 7 og beholder test-runneren og diagnostikkfilene. Backend-kandidaten retter scope for ebayPipelineStageTrace slik at feltet kan leses i responsdiagnostikken.

VERSJON
api/analyze.js: v15.5.43-test7.9-switch-accessory-filter-fix
Viktig: backend_version/version-feltene i API-responsen er satt til samme versjon som toppkommentaren. Kontroller alltid faktisk backend_version i Preview-rapporten etter deploy.

STATUS FØR DENNE PAKKEN
Preview-rapporter datert 2026-10-11 viste backend v15.5.41-test7.7-market-pipeline-stage-diagnostics. eBay returnerte 12 søk med HTTP 200 og totalt 600 råtreff, men scoring godkjente 0 og klargjorde 0. Disse rapportene beviser ikke at v15.5.42 er aktiv eller at prisgrunnlaget fungerer.

TESTER UTFØRT PÅ DENNE PAKKEN
- ZIP-integritet: bestått.
- Node.js syntakskontroll av alle .js-filer: kjøres separat ved pakkebygging.
- Kontroll av versjonsmarkører i analyze.js: forventet v15.5.42 i topptekst og responsfelt.
- Live Vercel/eBay/OpenAI/Supabase-integrasjon: IKKE verifisert av lokal kontroll.

VIKTIG
Dette er en testkandidat, ikke godkjent for produksjon. Ikke kopier til main eller produksjon. Behold Test 7-baselinen urørt. Ikke løs problemet ved å svekke listing-filtrene; bruk diagnostikk til å finne avvisningsårsaken.

FREMGANGSMÅTE
1. Erstatt innholdet i GitHub-grenen Testrunner med filene i denne ZIP-en.
2. Vent til Vercel Preview-deployen er Ready.
3. Kjør én Nintendo Switch OLED-test.
4. Bekreft at rapporten viser v15.5.43-test7.9-switch-accessory-filter-fix.
5. Kontroller at stage_trace_entries finnes og at treff ikke lenger blir avvist 100 % uten forklaring.
6. Hvis alle treff fortsatt avvises, hent konkrete avvisningsårsaker før neste kodeendring.
