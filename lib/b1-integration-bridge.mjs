// Kistefunn B1 integration bridge I1.2; no network, no dispatch authority.
// Mirrors the response contract of the separately reviewed B1 v4 capture code.
import {createHash} from 'node:crypto';
import {createSearchIntent, assessB1CaptureV4Scope} from './market-data-port.mjs';
import {evaluateRights} from './b1-rights-gate.mjs';

export const B1_BRIDGE_VERSION = 'kistefunn-b1-bridge-i1.2';
export const B1_CAPTURE_V4_VERSION = 'b1-ebay-capture-preview-4-audited';
const RECEIPT_VERSION = 'b1-capture-reservation-receipt-1';
const FIXED_QUERY = 'Nintendo Switch OLED';
const MARKETS = Object.freeze(['EBAY_DE', 'EBAY_GB', 'EBAY_US']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SHA = value => createHash('sha256').update(value).digest('hex');
const REQUIRED_IDENTITY = Object.freeze([
  'projectId','deploymentId','commitSha','branch','host','marketplace','query',
  'captureVersion','codeSha256'
]);
const own = (object, key) => Object.hasOwn(object, key);
function fail(reason) { throw new TypeError('B1_BRIDGE_' + reason); }
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function identityEquals(a, b) {
  return record(a) && record(b) && REQUIRED_IDENTITY.every(key =>
    own(a,key) && own(b,key) && typeof a[key] === 'string' && a[key] === b[key]);
}

/** Translates S1 strict/discovery queries into bounded, never-dispatched B1 intentions. */
export function planB1FromS1(strict) {
  if (!record(strict)) fail('S1_CRITERIA_INVALID');
  const first = Array.isArray(strict.discovery_queries) ? strict.discovery_queries : [];
  const fallback = Array.isArray(strict.queries) ? strict.queries : [];
  const seen = new Set(), queries = [];
  for (const raw of [...first.slice(0, 12), ...fallback.slice(0, 12)]) {
    if (typeof raw !== 'string') continue;
    const query = raw.trim().replace(/\s+/gu, ' ');
    if (query.length < 3 || query.length > 100 || /[\p{Cc}\p{Cf}]/u.test(query)) continue;
    const key = query.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key); queries.push(query);
    if (queries.length === 4) break;
  }
  const jobs = [];
  for (const marketplace of MARKETS) {
    for (const query of queries) {
      const intent = createSearchIntent({query, marketplace, maxResults:10});
      jobs.push(intent);
    }
  }
  return Object.freeze({
    version:B1_BRIDGE_VERSION, mode:'NOT_DISPATCHED',
    queries: Object.freeze(queries), jobs: Object.freeze(jobs)
  });
}

/** Status for app responses; deliberately never returns plaintext queries or listing data. */
export function describeB1Integration(strict) {
  const plan = planB1FromS1(strict);
  const canRetrieve = evaluateRights('ebay_browse','market_retrieval').allowed;
  const canValue = evaluateRights('ebay_browse','market_valuation').allowed;
  const v4SingleScope = plan.jobs.some(job => assessB1CaptureV4Scope(job).fixedScopeMatch);
  return Object.freeze({
    version:B1_BRIDGE_VERSION,
    source:'b1_capture_v4',
    status:'contract_connected_not_executed',
    planned_query_count:plan.queries.length,
    planned_market_jobs:plan.jobs.length,
    v4_single_scope_match:v4SingleScope,
    rights_retrieval: canRetrieve ? 'approved' : 'blocked',
    rights_valuation: canValue ? 'approved' : 'blocked',
    dispatch_allowed:false,
    usable_for_valuation:false,
    usable_for_ai_training:false,
    reason:canRetrieve && canValue ? 'B1_V4_CAPTURE_ONLY_NO_GENERAL_SEARCH' : 'RIGHTS_BLOCKED_AND_B1_V4_CAPTURE_ONLY'
  });
}

/**
 * Inspect wire output from B1 v4 *without* importing its private service or
 * transferring its one-use authority. SHA-256 only checks INTERNAL consistency;
 * it is not an authenticated signature and does NOT establish origin/trust.
 * Returns only safe metadata. Never returns pricing, listing text, or raw data.
 */
export function inspectB1V4CaptureWire(wire) {
  if (typeof wire !== 'string' || Buffer.byteLength(wire,'utf8') > 1_048_576) fail('WIRE_INVALID');
  let data;
  try { data = JSON.parse(wire); } catch { fail('JSON_INVALID'); }
  if (!record(data) || JSON.stringify(data) !== wire) fail('CANONICAL_JSON_REQUIRED');
  if (data.version !== B1_CAPTURE_V4_VERSION || data.status !== 'capture_complete' ||
    data.captureComplete !== true || data.analysisComplete !== false ||
    data.b1Status !== 'blocked' || data.b1Processing !== 'NOT_RUN' ||
    data.marketCompleteness !== 'incomplete') fail('CAPTURE_STATE_INVALID');
  const {manifest, reservationReceipt:receipt, responses} = data;
  if (!record(manifest) || !record(receipt) || !record(responses)) fail('STRUCTURE_INVALID');
  if (!UUID.test(manifest.captureId) || manifest.captureScope !== 'one_search_one_detail' ||
    manifest.marketplace !== 'EBAY_DE' || manifest.query !== FIXED_QUERY ||
    !record(manifest.upstreamCalls) ||
    ['oauth','search','detail'].some(name => manifest.upstreamCalls[name] !== 1)) fail('SCOPE_INVALID');
  if (!record(responses.search) || !Array.isArray(responses.search.itemSummaries) ||
    responses.search.itemSummaries.length !== 1 || !record(responses.search.itemSummaries[0]) ||
    !record(responses.detail) ||
    responses.search.itemSummaries[0].itemId !== manifest.itemId ||
    responses.detail.itemId !== manifest.itemId) fail('ITEM_BINDING_INVALID');
  if (receipt.version !== RECEIPT_VERSION || !UUID.test(receipt.campaignId) ||
    !UUID.test(receipt.attemptId) || !DIGEST.test(receipt.contextDigest) ||
    !DIGEST.test(receipt.payloadSha256) || !DIGEST.test(receipt.receiptDigest) ||
    receipt.captureId !== manifest.captureId ||
    !identityEquals(receipt.identity, manifest.identity)) fail('RECEIPT_INVALID');
  if (manifest.marketplace !== manifest.identity.marketplace ||
    manifest.query !== manifest.identity.query ||
    manifest.identity.captureVersion !== data.version ||
    ['projectId','deploymentId','commitSha','branch','host'].some(key =>
      manifest[key] !== manifest.identity[key])) fail('MANIFEST_IDENTITY_INVALID');
  const keys = Object.keys(receipt);
  if (keys.length !== 8 || ['version','campaignId','attemptId','contextDigest','identity',
    'captureId','payloadSha256','receiptDigest'].some(key=>!own(receipt,key))) fail('RECEIPT_FIELDS_INVALID');
  const copy = {...data};
  delete copy.reservationReceipt;
  if (SHA(JSON.stringify(copy)) !== receipt.payloadSha256) fail('PAYLOAD_DIGEST_INVALID');
  const {receiptDigest,...meta} = receipt;
  if (SHA(JSON.stringify(meta)) !== receiptDigest) fail('RECEIPT_DIGEST_INVALID');
  return Object.freeze({
    version:B1_BRIDGE_VERSION,
    captureVersion:data.version,
    status:'capture_metadata_consistent_not_authenticated',
    scope:'one_search_one_detail',
    calls: Object.freeze({oauth:1, search:1, detail:1}),
    sourceTrusted:false,
    usableForValuation:false,
    usableForTraining:false,
    dispatchAllowed:false
  });
}
