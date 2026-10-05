// Kistefunn v15.2 – lib/variants.js
// Variantmotor flyttet 1:1 fra v14.25.
// Dette er den dokumenterte Fender/Squier-gaten som v15.1 manglet.

export function createFenderVariantContext({
  built,
  itemInfo,
  parsed,
  structuredTargetText,
  structuredTargetYear,
  structuredTargetCountry,
  deterministicFenderMimTarget
}) {
  const targetIsSquier =
    /\bsquier(?:\s+series)?\b/i.test(structuredTargetText);

  /*
   * V14.12: normal Fender MIM-target skal identifiseres robust.
   * Tidligere brukte vi /^fender$/ på brand-feltet. Hvis AI-en svarte
   * f.eks. "Fender Musical Instruments", ble hardgaten deaktivert og
   * et Squier-treff kunne slippe gjennom. Brand-feltet er nå tokenbasert,
   * mens identiteten fortsatt krever Stratocaster + år + Mexico/MIM.
   */
  const targetIsFender =
    /\bfender\b/i.test(String(built.brand || "")) &&
    !targetIsSquier;

  const normalFenderMimQuery =
    targetIsFender &&
    /\bstratocaster\b/i.test(structuredTargetText) &&
    structuredTargetYear >= 1900 &&
    structuredTargetYear <= 2100 &&
    /\b(?:mexico|mim|made\s+in\s+mexico)\b/i.test(
      `${structuredTargetText} ${structuredTargetCountry}`
    );

  const hardFenderMimTarget =
    Boolean(normalFenderMimQuery || deterministicFenderMimTarget);

  const finalForbiddenFenderVariants = [
      /\bsquier(?:\s+series)?\b/i,
      /\bfsr\b/i,
      /\b62\s*(?:['’]s?|special)\b/i,
      /\b50th\s+anniversary\b/i,
      /\banniversary\b/i,
      /\bspecial(?:\s+edition)?\b/i,
      /\blimited\s+edition\b/i,
      /\bvintage\s+reissue\b/i,
      /\breissue\b/i,
      /\bplayer(?:\s+ii|\s+2)?\b/i,
      /\bvintera\b/i,
      /\bclassic\s+series\b/i,
      /\bamerican\s+(?:standard|professional|performer|ultra|original|vintage)\b/i,
      /\bprofessional\s+ii\b/i,
      /\bsignature\s+series\b/i
    ];

  /*
   * V14.18 – FELLES FENDER/SQUIER BRAND-GATE
   * -----------------------------------------
   * Fender og Squier deler produktnavn som Stratocaster og Telecaster,
   * men skal aldri behandles som samme merke i markedsverdien.
   *
   * Denne gaten skal brukes på ALLE markeds-pooler, ikke bare
   * normalFenderMimQuery. Den er bevisst basert på målidentiteten
   * og selve annonsedataene, slik at en Squier-annonse ikke kan
   * påvirke exact, same-model, valuation eller kuppberegning.
   */
  // Brand-identiteten skal komme fra strukturerte brand-felter.
  // parsed.name kan omtale andre merker/varianter og skal ikke kunne
  // overstyre et eksplisitt brand-felt.
  const explicitTargetBrandText = String(
    [built.brand, itemInfo?.brand]
      .filter(Boolean)
      .join(" ")
  ).trim().toLowerCase();

  const targetBrandText = explicitTargetBrandText ||
    String(
      [built.manufacturer, itemInfo?.manufacturer, parsed?.name]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

  const targetIsSquierBrand =
    /\bsquier(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(targetBrandText);

  const targetIsFenderBrand =
    /\bfender\b/i.test(targetBrandText) &&
    !targetIsSquierBrand;

  function passesFenderSquierBrandGate(item) {
    // V14.19: Produktmerke skal bestemmes fra strukturerte
    // brand/manufacturer-felter og selve tittelen. Fritekst/aspekter
    // kan inneholde omtaler som "not Squier" eller "Squier comparison"
    // og skal derfor ikke alene gjøre en ekte Fender til Squier.
    const structuredBrandText = String(
      [item?.brand, item?.manufacturer]
    .filter(Boolean)
    .join(" ")
    );

    const titleText = String(item?.title || "");

    const structuredIsSquier =
      /\bsquier(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(structuredBrandText);
    const structuredIsFender =
      /\bfender\b/i.test(structuredBrandText) &&
      !structuredIsSquier;

    // Tittelen brukes som produktidentitet når metadata mangler.
    // Negative/omtaleformuleringer skal ikke telle som merke.
    // V14.23: For et Fender-mål er enhver eksplisitt Squier-omtale
    // i produkttittelen en hard avvisning. Vi skal ikke forsøke å
    // tolke "comparison", "vs", "compatible" osv. som et ekte
    // Fender-produkt; slike treff er uegnede som eksakte prisreferanser.
    const positiveSquierTitle =
      /\bsquier(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(titleText);

    const positiveFenderTitle =
      /\bfender\b/i.test(titleText) &&
      !/\b(?:not|no|without|ikke|versus|vs\.?|comparison|compare|replacement|compatible|for)\s+fender\b/i.test(titleText);

    // V14.20: En eksplisitt positiv Squier-betegnelse i selve
    // produkttittelen skal alltid være nok til å avvise treffet for
    // et Fender-mål, selv om eBay-metadata feilaktig sier Fender.
    // Tilsvarende skal en eksplisitt Fender-tittel kunne avvise et
    // Squier-mål når metadata mangler/er feil.
    const listingIsSquier =
      structuredIsSquier || positiveSquierTitle;
    const listingIsFender =
      structuredIsFender || positiveFenderTitle;

    if (targetIsFenderBrand && listingIsSquier) return false;
    if (targetIsSquierBrand && listingIsFender) return false;

    return true;
  }



  return {
    targetIsSquier,
    targetIsFender,
    normalFenderMimQuery,
    hardFenderMimTarget,
    finalForbiddenFenderVariants,
    targetBrandText,
    targetIsSquierBrand,
    targetIsFenderBrand,
    passesFenderSquierBrandGate
  };
}
