// Kistefunn v15.1 – lib/variants.js
// EXAKT v14.18-variantlogikk flyttet ut av api/analyze.js.
// Ingen ny variantlogikk er introdusert i v15.1.

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
  const targetBrandText = String(
    [
      built.brand,
      built.manufacturer,
      itemInfo?.brand,
      itemInfo?.manufacturer,
      parsed?.name
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  const targetIsSquierBrand =
    /\bsquier(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(targetBrandText);

  const targetIsFenderBrand =
    /\bfender\b/i.test(targetBrandText) &&
    !targetIsSquierBrand;

  function passesFenderSquierBrandGate(item) {
    const listingText = String(
      [
        item?.title,
        item?._ebay_aspect_text,
        item?.brand,
        item?.manufacturer
      ]
        .filter(Boolean)
        .join(" ")
    );

    const listingIsSquier =
      /\bsquier(?:\s+by\s+fender)?(?:\s+series)?\b/i.test(listingText);

    const listingIsFender =
      /\bfender\b/i.test(listingText) &&
      !listingIsSquier;

    if (targetIsFenderBrand && listingIsSquier) {
      return false;
    }

    if (targetIsSquierBrand && listingIsFender) {
      return false;
    }

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
