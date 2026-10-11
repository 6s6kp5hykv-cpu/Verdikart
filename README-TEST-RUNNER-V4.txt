Kistefunn Test Runner v4 – batchtest og gruppert rapport

Basert på brukerens opplastede Verdikart-Testrunner(3).zip.
Endret fil: test-runner.html
Ny runner_version: test-runner-v4-batch-cases-grouped-report

Hva som er lagt til:
- 10 forhåndsdefinerte teksttesttilfeller for konsoller, tilbehør, løs del, pakke, Fender/Squier, årsmodell, uklar identifikasjon, få sammenlignbare treff og valuta.
- Mulighet til å velge flere testtilfeller og kjøre dem sekvensielt i én runde.
- Valgfri bildeopplasting (PNG/JPEG/WebP som støttes av nettleseren), maks 5 MB. Hvis avkrysset, sendes samme valgte bilde sammen med beskrivelsen for hver valgt test.
- JSON-rapport med resultater fra hele runden og gruppering av transport/HTTP-feil, backend-feil, manglende prisestimat og manglende diagnostikk.
- Kopier rapport / last ned JSON / stopp etter pågående forespørsel.
- Ingen tester starter automatisk; brukeren velger eksplisitt live-testene.

Viktige begrensninger:
- Dette er LIVE API-tester mot /api/analyze og kan bruke OpenAI/eBay-kvoter/koste penger.
- Testtilfellene har ikke automatiske fasitpriser. Systemet grupperer tekniske og diagnostiske funn, men semantisk korrekthet må vurderes mot faktiske annonser eller et verifisert fasitdatasett.
- Valgt bilde sendes med alle valgte tester dersom «Legg ved valgt testbilde» er krysset av. Ikke bruk den funksjonen med flere ulike produktbeskrivelser med mindre det er tilsiktet.
- Bypass-hemmelighet brukes ikke av denne HTML-filen og er ikke lagt inn i klientkode.
- Dette er en kandidat for Testrunner, ikke deployet og ikke godkjent for produksjon.

Sikker arbeidsflyt:
1. Test lokalt/syntaks først.
2. Legg kun test-runner.html og denne README-filen inn i Testrunner-branchen.
3. Deploy Preview og test med én valgt test før batchkjøring.
4. Ikke endre Test 7 eller main/produksjon uten uttrykkelig godkjenning.
