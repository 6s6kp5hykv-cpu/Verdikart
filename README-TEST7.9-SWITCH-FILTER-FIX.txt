KISTEFUNN TEST 7.9 – SWITCH FILTER FIX CANDIDATE

Formål
Rette en konkret feil der Nintendo Switch OLED-annonser feilaktig ble klassifisert som tilbehør/del.

Rotårsak
Test 7.8-rapporten viser 600 rå eBay-treff, 0 godkjente, og avvisningsårsaken "tilbehør/del" for alle. I api/analyze.js var "switch" oppført i en generell accessoryTerms-liste som sjekkes med t.includes(term). Dette matcher "Switch" i produktnavnet "Nintendo Switch".

Endring
Fjerner bare "switch" fra den generelle accessoryTerms-listen. Andre kategori-spesifikke konsoll-/tilbehørsfiltre beholdes.

Versjon
v15.5.43-test7.9-switch-accessory-filter-fix

Sikkerhet
Kun for Testrunner. Test 7-baseline skal forbli urørt. Ikke deploy til main/produksjon uten eksplisitt godkjenning.

Teststatus
Kandidatpakken må gjennomgå lokale syntaks-/ZIP-kontroller. Den er ikke live-testet mot eBay; Preview-verifisering kreves.
