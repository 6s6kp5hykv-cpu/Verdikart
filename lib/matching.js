// Kistefunn v15.2 – lib/matching.js
// balanceByQuery flyttet 1:1 fra v14.25.

export function balanceByQuery(items, maxPerQuery = 6) {
  const groups = new Map();

  for (const item of items) {
    const key =
      String(item.query || "")
        .trim()
        .toLowerCase();

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(item);
  }

  const balanced = [];

  for (const group of groups.values()) {
    group
      .sort(
        (a, b) =>
          (b.relevance_score || 0) -
          (a.relevance_score || 0)
      )
      .slice(0, maxPerQuery)
      .forEach(item => balanced.push(item));
  }

  return balanced;
}


/**
 * Returns whether a Stratocaster/Telecaster listing matches the target's
 * explicit bridge construction. HT/hardtail is a material model variant.
 * Other guitar families are left to their category-specific gates.
 */
export function isCompatibleGuitarBridgeVariant(targetIdentity, listingTitle) {
  const target = String(targetIdentity || "");
  const listing = String(listingTitle || "");
  const isStratOrTele = /\b(?:stratocaster|telecaster)\b/i.test(target);
  if (!isStratOrTele) return { compatible: true, reason: null };

  const targetIsHardtail = /\b(?:hardtail|ht)\b/i.test(target);
  const listingIsHardtail = /\b(?:hardtail|ht)\b/i.test(listing);
  if (targetIsHardtail === listingIsHardtail) {
    return { compatible: true, reason: null };
  }

  return {
    compatible: false,
    reason: targetIsHardtail
      ? "annen brovariant – målet er hardtail"
      : "hardtail-variant – målet er standard brovariant"
  };
}
