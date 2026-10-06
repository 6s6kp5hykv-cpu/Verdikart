// Kistefunn felles verdihjelpere v14.26
// Flyttet ut av analyze.js/eBay-engine. Ren hjelpefunksjonalitet.

function parseNok(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") return null;

  let s = value.toLowerCase().replace(/kr/g, "").trim();

  const range = s.match(
    /(\d+(?:[.,]\d+)?)\s*(?:-|–|—|til)\s*(\d+(?:[.,]\d+)?)/i
  );

  if (range) {
    const a = Number(range[1].replace(",", "."));
    const b = Number(range[2].replace(",", "."));

    if (Number.isFinite(a) && Number.isFinite(b)) {
      return Math.round((a + b) / 2);
    }
  }

  s = s
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  if (s.includes(",") && s.includes(".")) {
    const lc = s.lastIndexOf(",");
    const ld = s.lastIndexOf(".");

    if (lc > ld) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    const parts = s.split(",");

    s =
      parts.length === 2 && parts[1].length <= 2
        ? parts[0] + "." + parts[1]
        : parts.join("");
  } else if (s.includes(".")) {
    const parts = s.split(".");

    s =
      parts.length === 2 && parts[1].length <= 2
        ? parts[0] + "." + parts[1]
        : parts.join("");
  }

  const n = Number(s);

  return Number.isFinite(n) ? n : null;
}

function median(values) {
  if (!values.length) return null;

  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);

  return a.length % 2
    ? a[m]
    : (a[m - 1] + a[m]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;

  const a = [...values].sort((x, y) => x - y);
  const index = (a.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);

  if (lo === hi) return a[lo];

  return a[lo] +
    (a[hi] - a[lo]) * (index - lo);
}

function removeOutliers(items) {
  if (items.length < 5) return items;

  const prices = items
    .map(x => Number(x.nok))
    .filter(Number.isFinite);

  if (prices.length < 5) return items;

  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const iqr = q3 - q1;

  return items.filter(item =>
    Number(item.nok) >= q1 - 1.5 * iqr &&
    Number(item.nok) <= q3 + 1.5 * iqr
  );
}


export { parseNok, median, percentile, removeOutliers };
