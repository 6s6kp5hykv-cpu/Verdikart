// Kistefunn I1.0 market-data-port offline regression tests — no network.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {MARKET_PORT_VERSION, MARKET_PORT_MODE, createSearchIntent, assessB1CaptureV4Scope, normalizeSyntheticSnapshot} from '../lib/market-data-port.mjs';

const intent = () => createSearchIntent({query:'  Nintendo   Switch OLED ',marketplace:'EBAY_DE',maxResults:1});
const record = () => ({id:'KF-SYN-TEST-001',label:'Synthetic Example Console',priceMinor:250000,currency:'NOK'});
const snapshot = (items=[record()]) => ({source:'synthetic_fixture',items});

test('I1.0: version and offline-only mode',()=>{
 assert.equal(MARKET_PORT_VERSION,'kistefunn-market-port-i1.0');
 assert.equal(MARKET_PORT_MODE,'OFFLINE_FIXTURE_ONLY');
});
test('I1.0: valid request is normalized and frozen',()=>{
 const p=intent();assert.equal(p.query,'Nintendo Switch OLED');assert.equal(p.execution,'NOT_DISPATCHED');assert.ok(Object.isFrozen(p));
});
test('I1.0: every supported marketplace is accepted',()=>{
 for(const marketplace of ['EBAY_DE','EBAY_GB','EBAY_US'])assert.equal(createSearchIntent({query:'Synthetic test',marketplace,maxResults:2}).marketplace,marketplace);
});
test('I1.0: empty, short and too-long search strings rejected',()=>{
 for(const query of ['', '  ', 'aa', 'x'.repeat(101)])assert.throws(()=>createSearchIntent({query,marketplace:'EBAY_DE',maxResults:1}),/QUERY_INVALID/);
});
test('I1.0: control characters rejected',()=>{
 for(const query of ['abc\u0000def','abc\u202Edef','abc\nxyz'])assert.throws(()=>createSearchIntent({query,marketplace:'EBAY_DE',maxResults:1}),/QUERY_INVALID/);
});
test('I1.0: unsupported marketplace rejected',()=>{
 for(const marketplace of ['FINN_NO','EBAY_CA',null,''])assert.throws(()=>createSearchIntent({query:'Test Item',marketplace,maxResults:1}),/MARKETPLACE_INVALID/);
});
test('I1.0: limit must be integer between one and fifty',()=>{
 for(const maxResults of [0,-1,51,1.5,NaN,Infinity,'1'])assert.throws(()=>createSearchIntent({query:'Test Item',marketplace:'EBAY_DE',maxResults}),/LIMIT_INVALID/);
});
test('I1.0: unknown fields and getters are rejected',()=>{
 assert.throws(()=>createSearchIntent({query:'Test Item',marketplace:'EBAY_DE',maxResults:1,token:'sensitive'}),/INTENT_INVALID/);
 let hit=false;const x={marketplace:'EBAY_DE',maxResults:1};Object.defineProperty(x,'query',{enumerable:true,get(){hit=true;return 'Test Item'}});
 assert.throws(()=>createSearchIntent(x),/INTENT_INVALID/);assert.equal(hit,false);
});
test('I1.0: B1 v4 fixed scope is recognized but always blocked',()=>{
 const x=assessB1CaptureV4Scope(intent());assert.equal(x.fixedScopeMatch,true);assert.equal(x.liveAuthorized,false);assert.equal(x.reason,'FIXED_TEST_SCOPE_ONLY_NOT_AUTHORIZED');
});
test('I1.0: normal Kistefunn queries exceed current B1 fixed scope',()=>{
 const other=createSearchIntent({query:'Fender Stratocaster 1995',marketplace:'EBAY_DE',maxResults:5});
 const x=assessB1CaptureV4Scope(other);assert.equal(x.fixedScopeMatch,false);assert.equal(x.requiresNewApprovedB1Version,true);assert.equal(x.liveAuthorized,false);
});
test('I1.0: disallows forged intent execution status',()=>{
 const bad={...intent(),execution:'AUTHORIZED'};
 assert.throws(()=>assessB1CaptureV4Scope(bad),/INTENT_INVALID/);
 assert.throws(()=>normalizeSyntheticSnapshot(bad,snapshot()),/INTENT_INVALID/);
});
test('I1.0: synthetic snapshot projects only safe allowlisted values',()=>{
 const p=normalizeSyntheticSnapshot(intent(),snapshot());
 assert.equal(p.origin,'synthetic_fixture');assert.equal(p.count,1);
 assert.equal(p.usableForValuation,false);assert.equal(p.usableForTraining,false);
 assert.equal(p.items[0].priceMinor,250000);assert.equal(p.items[0].evidenceStatus,'SYNTHETIC_NOT_MARKET_EVIDENCE');
 assert.ok(Object.isFrozen(p));assert.ok(Object.isFrozen(p.items));assert.ok(Object.isFrozen(p.items[0]));
});
test('I1.0: synthetic batch size may not exceed the intent limit',()=>{
 assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([record(),{...record(),id:'KF-SYN-TEST-002'}])),/SNAPSHOT_INVALID/);
});
test('I1.0: empty synthetic batch is allowed',()=>{
 assert.equal(normalizeSyntheticSnapshot(intent(),snapshot([])).count,0);
});
test('I1.0: nonfixture source rejected',()=>{
 for(const source of ['ebay','live',null,''])assert.throws(()=>normalizeSyntheticSnapshot(intent(),{source,items:[record()]}),/SNAPSHOT_INVALID/);
});
test('I1.0: unknown fields including URL and PII rejected',()=>{
 for(const key of ['url','rawResponse','seller','email','accessToken'])assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([{...record(),[key]:'nope'}])),/ITEM_INVALID/);
});
test('I1.0: malformed ID and repeated IDs rejected',()=>{
 for(const id of ['123','item-123','KF-SYN-','KF-SYN-test'])assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([{...record(),id}])),/ID_INVALID/);
 const p=createSearchIntent({query:'Test Item',marketplace:'EBAY_DE',maxResults:2});
 assert.throws(()=>normalizeSyntheticSnapshot(p,snapshot([record(),record()])),/ID_INVALID/);
});
test('I1.0: synthetic labels must have explicit synthetic prefix',()=>{
 for(const label of ['Real iPhone','Synthetic <img>','Synthetic x'])assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([{...record(),label}])),/LABEL_INVALID/);
});
test('I1.0: no invalid prices enter normalized snapshots',()=>{
 for(const priceMinor of [0,-1,1.4,'500',Infinity,NaN,100_000_000_001])assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([{...record(),priceMinor}])),/PRICE_INVALID/);
});
test('I1.0: invalid currency rejected',()=>{
 assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([{...record(),currency:'BTC'}])),/CURRENCY_INVALID/);
});
test('I1.0: object accessors are not invoked',()=>{
 let accessed=false;const item={id:'KF-SYN-TEST-001',label:'Synthetic Example Console',currency:'NOK'};
 Object.defineProperty(item,'priceMinor',{enumerable:true,get(){accessed=true;return 1}});
 assert.throws(()=>normalizeSyntheticSnapshot(intent(),snapshot([item])),/ITEM_INVALID/);assert.equal(accessed,false);
});
test('I1.0: no network or secret-bearing imports in port',()=>{
 const code=readFileSync(new URL('../lib/market-data-port.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bfetch\s*\(|\bhttps?\.request\s*\(|\bimport\s*\(|process\.env\s*\[|\.env\.|\bpg\b|api\.ebay\.com/i);
});
