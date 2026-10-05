// Kistefunn v15.0 – lib/variants.js
// Variantmotor isolert fra hoved-API-et.
// Basert på og skal være funksjonelt lik v14.18.

export function createFenderVariantContext({
  built = {},
  itemInfo = {},
  parsed = {},
  deterministicFenderMimTarget = false
} = {}) {
  const structuredTargetText = String(
    [
      built.brand,
      built.model,
      built.type,
      built.manufacturer,
      parsed?.name,
      itemInfo?.year_or_period
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  const structuredTargetYear =
    Number(built.year || built.detected_year || 0);

  const structuredTargetCountry =
    String(
      [
        built.country,
        itemInfo?.year_or_period,
        itemInfo?.manufacturer,
        parsed?.name
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();

  const targetIsSquier =
    /\bsquier(?:\s+series)?\b/i.test(structuredTargetText);

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
    structuredTargetText,
    structuredTargetYear,
    structuredTargetCountry,
    targetIsSquier,
    targetIsFender,
    normalFenderMimQuery,
    hardFenderMimTarget,
    finalForbiddenFenderVariants,
    targetIsSquierBrand,
    targetIsFenderBrand,
    passesFenderSquierBrandGate
  };
}
