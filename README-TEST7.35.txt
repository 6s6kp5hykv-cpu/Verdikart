# Kistefunn Test 7.35 – presis negasjon i aspektdiagnostikken

Backendversjon: `v15.5.66-test7.35-negation-scope`

## Regel

Aspektdiagnostikken vurderer hvert tekstfelt og hver utstyrstype separat. Tydelig positiv evidens gir `true`, eksplisitt negativ evidens for den aktuelle typen gir `false`, uklart omfang eller generisk/kompatibilitetsomtale gir `null` med `ambiguous_evidence`, og både positivt og negativt belegg for samme type gir `null` med `conflicting_evidence`. Manglende eller ukjent aspektdata forblir `null`.

Komma, semikolon og loddrett strek skiller oppføringer. Kontrastord skiller selvstendige utsagn. Koordinert oppramsing med delt sluttnegasjon («Dock and Joy-Con not included») tolkes som negativ for begge nevnte typer. Relasjonelle konstruksjoner («Dock with Joy-Con not included») gir negativt signal for Joy-Con og tvetydig signal for dock. Et bart utstyrsnavn er utilstrekkelig evidens; bare en tydelig inkluderingsformulering som «Dock included» eller «Joy-Con included» gir `true`. «Dock compatible», bart «controller» og generisk «adapter» gir ikke `true`.

Dette er kun diagnostikk. `classifyNintendoSwitchOledListing`, pakkefilterets godkjenning, eBay-oppslag, verdsetting, prisintervall og markedsvekter er uendret.

## Tester

Kjørt lokalt 2026-10-14 på `codexV1`, HEAD `43add491043ec9db715117b02d618ab338ba9029`. Ingen liveanalyse eller eksterne API-kall ble utført.

| Kommando | Resultat |
| --- | --- |
| `node --check api/analyze.js` | BESTÅTT |
| `node --check api/_diagnostics.js` | BESTÅTT |
| `node --check scripts/test-test7.33-ebay-aspect-diagnostics.mjs` | BESTÅTT |
| `node --check scripts/test-test7.34-isolated-aspect-signals.mjs` | BESTÅTT |
| `node --check scripts/test-test7.35-negation-scope.mjs` | BESTÅTT |
| `node scripts/test-test7.22-ebay-throttle-control.mjs` | BESTÅTT |
| `node scripts/test-test7.23-ebay-error-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.29-nintendo-search-fix.mjs` | BESTÅTT |
| `node scripts/test-test7.30-analysis-diagnostics.mjs` | BESTÅTT (syntetiske positive aspektverdier bruker eksplisitt «included») |
| `node scripts/test-test7.32-ebay-detail-diagnostics.mjs` | BESTÅTT (syntetiske positive aspektverdier bruker eksplisitt «included») |
| `node scripts/test-test7.33-ebay-aspect-diagnostics.mjs` | BESTÅTT |
| `node scripts/test-test7.34-isolated-aspect-signals.mjs` | BESTÅTT |
| `node scripts/test-test7.35-negation-scope.mjs` | BESTÅTT |
| `node scripts/test-test7.25-package-gate.mjs` | FEILET før funksjonsassertions: forventer foreldet `v15.5.58-test7.25-switch-package-valuation-gate` |
| `node scripts/test-test7.26-fail-closed-package-valuation.mjs` | FEILET før funksjonsassertions: forventer foreldet `v15.5.59-test7.26-fail-closed-package-valuation-gate` |
| `git diff --check` | BESTÅTT (Git viste kun linjesluttvarsler) |

Sluttgjennomgang: bart «Joy-Con» gir nå `null` / `no_value_match`; «Joy-Con included» gir `true` / `matched`; «Joy-Con not included» gir `false` / `negative_match`. Test 7.30 og 7.32 beholder dekningen av positive signaler ved å bruke eksplisitte inkluderingsformuleringer. Test 7.33 bruker tilsvarende eksplisitt positiv formulering.

Test 7.25 og 7.26 er uendret; deres funksjonsassertions ble ikke kjørt. Sanitizerens syntetiske lekkasjekontroll bestod. Ingen Preview- eller liveintegrasjon er verifisert.
