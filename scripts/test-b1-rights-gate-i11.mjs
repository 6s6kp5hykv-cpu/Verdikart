// I1.1 — offline rights policy tests, Node built-ins only.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {B1_RIGHTS_POLICY_VERSION, evaluateRights, requireRights, isValidWrittenGrant, rightsSummary} from '../lib/b1-rights-gate.mjs';
import {B1_RIGHTS_APPROVALS} from '../lib/b1-rights-policy.mjs';
const scopes = [
 ['ebay_browse','market_retrieval'],['ebay_browse','market_valuation'],['ebay_browse','ai_training'],
 ['external_web','market_retrieval'],['external_web','market_valuation'],['external_web','ai_training']
];
const valid = () => ({enabled:true,source:'ebay_browse',purpose:'market_valuation',approvalReference:'WRITTEN-PERMISSION-123',evidenceSha256:'a'.repeat(64),reviewedBy:'project-owner',validFrom:new Date(Date.now()-10000).toISOString().replace(/\.\d{3}Z$/,'Z'),validUntil:new Date(Date.now()+100000).toISOString().replace(/\.\d{3}Z$/,'Z')});
test('I1.1 version is explicit',()=>assert.equal(B1_RIGHTS_POLICY_VERSION,'b1-rights-i1.1'));
test('I1.1 every third-party right is blocked by default',()=>{for(const [s,p] of scopes)assert.deepEqual(evaluateRights(s,p).allowed,false)});
test('I1.1 synthetic offline inspection allowed',()=>{assert.equal(evaluateRights('synthetic_fixture','offline_test').allowed,true)});
test('I1.1 synthetic fixture cannot be valued or used to train',()=>{for(const p of ['market_valuation','ai_training','market_retrieval'])assert.equal(evaluateRights('synthetic_fixture',p).allowed,false)});
test('I1.1 first-party identification only',()=>{assert.equal(evaluateRights('first_party_verified','identification').allowed,true);assert.equal(evaluateRights('first_party_verified','ai_training').allowed,false)});
test('I1.1 unknown providers and purposes blocked',()=>{for(const [s,p] of [['evil','market_valuation'],['ebay','market_valuation'],['ebay_browse','unknown'],[null,'market_valuation'],['ebay_browse',null]])assert.equal(evaluateRights(s,p).allowed,false)});
test('I1.1 cannot allow third-party data by throwing or using a flag',()=>{for(const [s,p] of scopes) assert.throws(()=>requireRights(s,p),e=>e.code==='DATA_RIGHTS_BLOCKED')});
test('I1.1 returned decisions are immutable',()=>{assert.ok(Object.isFrozen(evaluateRights('ebay_browse','market_valuation')));assert.ok(Object.isFrozen(rightsSummary()))});
test('I1.1 public rights summary contains no secrets or grant tokens',()=>{const s=rightsSummary(); assert.deepEqual(Object.keys(s).sort(),['version','ebay_retrieval','ebay_valuation','ebay_ai_training','external_web_valuation'].sort()); assert.equal(s.ebay_retrieval,'blocked');assert.equal(s.ebay_valuation,'blocked');assert.equal(s.ebay_ai_training,'blocked');assert.equal(s.external_web_valuation,'blocked');});
test('I1.1 policy grants are all null and policy object immutable',()=>{assert.ok(Object.isFrozen(B1_RIGHTS_APPROVALS));assert.equal(Object.values(B1_RIGHTS_APPROVALS).filter(Boolean).length,0)});
test('I1.1 complete written grant record validates structurally',()=>{assert.equal(isValidWrittenGrant(valid(),'ebay_browse','market_valuation'),true)});
test('I1.1 grant missing fields rejected',()=>{for(const key of Object.keys(valid())){const g=valid();delete g[key];assert.equal(isValidWrittenGrant(g,'ebay_browse','market_valuation'),false)}});
test('I1.1 disabled grant rejected',()=>{assert.equal(isValidWrittenGrant({...valid(),enabled:false},'ebay_browse','market_valuation'),false)});
test('I1.1 mismatched provider or purpose rejected',()=>{assert.equal(isValidWrittenGrant(valid(),'external_web','market_valuation'),false);assert.equal(isValidWrittenGrant(valid(),'ebay_browse','ai_training'),false)});
test('I1.1 expired grant rejected',()=>{const g={...valid(),validFrom:'2020-01-01T00:00:00Z',validUntil:'2020-02-01T00:00:00Z'};assert.equal(isValidWrittenGrant(g,'ebay_browse','market_valuation'),false)});
test('I1.1 future grant rejected',()=>{const g={...valid(),validFrom:'2099-01-01T00:00:00Z',validUntil:'2099-01-02T00:00:00Z'};assert.equal(isValidWrittenGrant(g,'ebay_browse','market_valuation'),false)});
test('I1.1 unreasonable grant expiry rejected',()=>{const g={...valid(),validFrom:'2025-01-01T00:00:00Z',validUntil:'2028-01-01T00:00:00Z'};assert.equal(isValidWrittenGrant(g,'ebay_browse','market_valuation'),false)});
test('I1.1 unverifiable approval reference and digest rejected',()=>{assert.equal(isValidWrittenGrant({...valid(),approvalReference:'OK'},'ebay_browse','market_valuation'),false);assert.equal(isValidWrittenGrant({...valid(),evidenceSha256:'unverified'},'ebay_browse','market_valuation'),false)});
test('I1.1 accessor grant properties never invoked',()=>{const g=valid();let touched=false;Object.defineProperty(g,'reviewedBy',{enumerable:true,get(){touched=true;return 'reviewer'}});assert.equal(isValidWrittenGrant(g,'ebay_browse','market_valuation'),false);assert.equal(touched,false)});
test('I1.1 forged prototype rejected',()=>{const g=Object.create(null);Object.assign(g,valid());assert.equal(isValidWrittenGrant(g,'ebay_browse','market_valuation'),false)});
test('I1.1 unknown fields rejected',()=>{assert.equal(isValidWrittenGrant({...valid(),secret:'x'},'ebay_browse','market_valuation'),false)});
test('I1.1 policy and gate have no network APIs',()=>{for(const f of ['../lib/b1-rights-gate.mjs','../lib/b1-rights-policy.mjs']){const src=readFileSync(new URL(f,import.meta.url),'utf8');assert.doesNotMatch(src,/\bfetch\s*\(|\bhttps?\.request\s*\(|process\.env|api\.ebay\.com/);}});
test('I1.1 no browser-controlled permission or raw eBay data in gate',()=>{
 const code=readFileSync(new URL('../lib/b1-rights-gate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\breq\.|\bheaders\.|localStorage|window\.|authorization|client_secret/i);
});
