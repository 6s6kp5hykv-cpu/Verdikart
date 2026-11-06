// Kistefunn market data port I1.0 — offline contract only; no live B1/eBay usage.
// This module neither imports a network client nor makes an HTTP request.
export const MARKET_PORT_VERSION = 'kistefunn-market-port-i1.0';
export const MARKET_PORT_MODE = 'OFFLINE_FIXTURE_ONLY';

const MARKETPLACES = new Set(['EBAY_DE', 'EBAY_GB', 'EBAY_US']);
const SYNTHETIC_ID = /^KF-SYN-[A-Z0-9-]{3,32}$/;
const STRIP_CONTROL = /[\p{Cc}\p{Cf}]/u;

function plainData(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const names = Reflect.ownKeys(value);
    if (names.some(name => typeof name !== 'string' || !keys.includes(name))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return names.every(name => Object.hasOwn(descriptors[name], 'value'));
  } catch {
    return false;
  }
}

function reject(message) {
  throw new TypeError('MARKET_PORT_' + message);
}

export function createSearchIntent(input) {
  if (!plainData(input, ['query', 'marketplace', 'maxResults'])) reject('INTENT_INVALID');
  const { query, marketplace, maxResults } = input;
  if (typeof query !== 'string' || STRIP_CONTROL.test(query)) reject('QUERY_INVALID');
  const normalized = query.trim().replace(/\s+/gu, ' ');
  if (normalized.length < 3 || normalized.length > 100) reject('QUERY_INVALID');
  if (!MARKETPLACES.has(marketplace)) reject('MARKETPLACE_INVALID');
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) reject('LIMIT_INVALID');
  return Object.freeze({
    version: MARKET_PORT_VERSION,
    kind: 'SEARCH_INTENT',
    marketplace,
    query: normalized,
    maxResults,
    execution: 'NOT_DISPATCHED'
  });
}

/** Status only. A match does NOT authorize a live call or a new campaign. */
export function assessB1CaptureV4Scope(intent) {
  if (!plainData(intent, ['version', 'kind', 'marketplace', 'query', 'maxResults', 'execution']) ||
      intent.version !== MARKET_PORT_VERSION || intent.kind !== 'SEARCH_INTENT' ||
      intent.execution !== 'NOT_DISPATCHED') reject('INTENT_INVALID');
  const exactFixedScope = intent.marketplace === 'EBAY_DE' &&
    intent.query === 'Nintendo Switch OLED' && intent.maxResults === 1;
  return Object.freeze({
    version: MARKET_PORT_VERSION,
    fixedScopeMatch: exactFixedScope,
    liveAuthorized: false,
    requiresNewApprovedB1Version: !exactFixedScope,
    reason: exactFixedScope ? 'FIXED_TEST_SCOPE_ONLY_NOT_AUTHORIZED' : 'OUTSIDE_B1_CAPTURE_V4_SCOPE'
  });
}

/**
 * Converts synthetic hand-authored fixtures to allowlisted records.
 * Never accepts fetched eBay responses, URLs, or free-form extra properties.
 */
export function normalizeSyntheticSnapshot(intent, snapshot) {
  // Revalidate instead of trusting a caller-created object.
  if (!plainData(intent, ['version', 'kind', 'marketplace', 'query', 'maxResults', 'execution']) ||
      intent.version !== MARKET_PORT_VERSION || intent.kind !== 'SEARCH_INTENT' ||
      intent.execution !== 'NOT_DISPATCHED') reject('INTENT_INVALID');
  const verified = createSearchIntent({
    query: intent.query, marketplace: intent.marketplace, maxResults: intent.maxResults
  });
  if (verified.query !== intent.query) reject('INTENT_INVALID');
  if (!plainData(snapshot, ['source', 'items']) || snapshot.source !== 'synthetic_fixture' ||
      !Array.isArray(snapshot.items) || snapshot.items.length > intent.maxResults) reject('SNAPSHOT_INVALID');
  const ids = new Set();
  const items = snapshot.items.map(item => {
    if (!plainData(item, ['id', 'label', 'priceMinor', 'currency'])) reject('ITEM_INVALID');
    if (typeof item.id !== 'string' || !SYNTHETIC_ID.test(item.id) || ids.has(item.id)) reject('ID_INVALID');
    ids.add(item.id);
    if (typeof item.label !== 'string' || !/^Synthetic [A-Za-z0-9 -]{3,70}$/.test(item.label)) reject('LABEL_INVALID');
    if (!Number.isSafeInteger(item.priceMinor) || item.priceMinor < 1 || item.priceMinor > 100_000_000_000) reject('PRICE_INVALID');
    if (item.currency !== 'NOK' && item.currency !== 'EUR' && item.currency !== 'GBP' && item.currency !== 'USD') reject('CURRENCY_INVALID');
    return Object.freeze({
      syntheticId: item.id,
      label: item.label,
      priceMinor: item.priceMinor,
      currency: item.currency,
      evidenceStatus: 'SYNTHETIC_NOT_MARKET_EVIDENCE'
    });
  });
  return Object.freeze({
    version: MARKET_PORT_VERSION,
    origin: 'synthetic_fixture',
    usableForValuation: false,
    usableForTraining: false,
    count: items.length,
    items: Object.freeze(items)
  });
}
