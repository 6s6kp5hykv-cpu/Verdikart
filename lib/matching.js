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
