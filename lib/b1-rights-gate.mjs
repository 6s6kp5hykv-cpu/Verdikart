// Kistefunn B1 Rights Gate I1.1 — fail closed, server-side only.
// No user request, client setting or env flag grants permissions.
import {B1_RIGHTS_POLICY_VERSION, B1_RIGHTS_APPROVALS} from './b1-rights-policy.mjs';

export {B1_RIGHTS_POLICY_VERSION};
const ALLOWED_SCOPES = Object.freeze(new Set(Object.keys(B1_RIGHTS_APPROVALS)));
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/;

function decision(allowed, reason) {
  return Object.freeze({version:B1_RIGHTS_POLICY_VERSION, allowed, reason});
}

/** Only trusted reviewed server policy can grant rights. No caller-supplied grants. */
export function evaluateRights(source, purpose) {
  if (source === 'synthetic_fixture' && purpose === 'offline_test') {
    return decision(true, 'SYNTHETIC_OFFLINE_ONLY');
  }
  if (source === 'first_party_verified' && purpose === 'identification') {
    return decision(true, 'FIRST_PARTY_IDENTIFICATION_ONLY');
  }
  if (typeof source !== 'string' || typeof purpose !== 'string') {
    return decision(false, 'UNKNOWN_RIGHTS_SCOPE');
  }
  const key = source + ':' + purpose;
  if (!ALLOWED_SCOPES.has(key)) return decision(false, 'UNKNOWN_RIGHTS_SCOPE');
  const grant = B1_RIGHTS_APPROVALS[key];
  if (!isValidWrittenGrant(grant, source, purpose)) {
    return decision(false, 'RIGHTS_NOT_APPROVED');
  }
  return decision(true, 'WRITTEN_SCOPE_APPROVED');
}

/** A structured record is required in addition to a flag. Does not prove legality. */
export function isValidWrittenGrant(grant, source, purpose) {
  if (grant === null || typeof grant !== 'object' || Array.isArray(grant)) return false;
  try {
    if (Object.getPrototypeOf(grant) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(grant);
    const expected = ['enabled','source','purpose','approvalReference','evidenceSha256','reviewedBy','validFrom','validUntil'];
    if (keys.length !== expected.length || keys.some(k => typeof k !== 'string' || !expected.includes(k))) return false;
    const descriptors = Object.getOwnPropertyDescriptors(grant);
    if (keys.some(k => !Object.hasOwn(descriptors[k], 'value'))) return false;
    if (grant.enabled !== true || grant.source !== source || grant.purpose !== purpose) return false;
    if (typeof grant.approvalReference !== 'string' || !REFERENCE.test(grant.approvalReference)) return false;
    if (typeof grant.evidenceSha256 !== 'string' || !SHA256.test(grant.evidenceSha256)) return false;
    if (typeof grant.reviewedBy !== 'string' || !REFERENCE.test(grant.reviewedBy)) return false;
    if (typeof grant.validFrom !== 'string' || typeof grant.validUntil !== 'string' ||
        !ISO_UTC.test(grant.validFrom) || !ISO_UTC.test(grant.validUntil)) return false;
    const from = Date.parse(grant.validFrom);
    const until = Date.parse(grant.validUntil);
    if (!Number.isFinite(from) || !Number.isFinite(until) ||
        new Date(from).toISOString().slice(0,19) !== grant.validFrom.slice(0,19) ||
        new Date(until).toISOString().slice(0,19) !== grant.validUntil.slice(0,19)) return false;
    const now = Date.now();
    if (!(from <= now && now < until) || until - from > 366 * 86400000) return false;
    return true;
  } catch {
    return false;
  }
}

/** Future L1 pipelines must use this gate before any training/export. */
export function requireRights(source, purpose) {
  const result = evaluateRights(source, purpose);
  if (!result.allowed) {
    const error = new Error('DATA_RIGHTS_BLOCKED');
    error.code = 'DATA_RIGHTS_BLOCKED';
    throw error;
  }
  return result;
}

/** Safe, bounded diagnostic fields for user-facing analysis responses. */
export function rightsSummary() {
  return Object.freeze({
    version: B1_RIGHTS_POLICY_VERSION,
    ebay_retrieval: evaluateRights('ebay_browse','market_retrieval').allowed ? 'approved' : 'blocked',
    ebay_valuation: evaluateRights('ebay_browse','market_valuation').allowed ? 'approved' : 'blocked',
    ebay_ai_training: evaluateRights('ebay_browse','ai_training').allowed ? 'approved' : 'blocked',
    external_web_valuation: evaluateRights('external_web','market_valuation').allowed ? 'approved' : 'blocked'
  });
}
