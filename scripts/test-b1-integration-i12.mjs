// I1.2: offline tests based on inspected B1 v4 capture contract. No live eBay data.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {B1_BRIDGE_VERSION, B1_CAPTURE_V4_VERSION, planB1FromS1, describeB1Integration, inspectB1V4CaptureWire} from '../lib/b1-integration-bridge.mjs';
const HASH=x=>createHash('sha256').update(x).digest('hex');
const uuid='12345678-1234-4123-8123-123456789abc';
const identity={projectId:'prj_123456789abc',deploymentId:'dpl_123456789abc',commitSha:'a'.repeat(40),branch:'b1-ebay-capture-preview',host:'private.vercel.app',marketplace:'EBAY_DE',query:'Nintendo Switch OLED',captureVersion:B1_CAPTURE_V4_VERSION,codeSha256:'b'.repeat(64)};
function wire(){
 const itemId='v1|123456|0';
 const a={
   version:B1_CAPTURE_V4_VERSION,status:'capture_complete',captureComplete:true,
   analysisComplete:false,marketCompleteness:'incomplete',b1Status:'blocked',b1Processing:'NOT_RUN',
   responses:{search:{itemSummaries:[{itemId,title:'[WITHHELD_UNREVIEWED_TEXT]'}],total:1,limit:1,offset:0},detail:{itemId,title:'[WITHHELD_UNREVIEWED_TEXT]'}},
   manifest:{captureId:uuid,transport:'mock',sourceVerification:'MOCK_ONLY',deploymentId:identity.deploymentId,projectId:identity.projectId,
     commitSha:identity.commitSha,branch:identity.branch,host:identity.host,identity,
     marketplace:'EBAY_DE',query:'Nintendo Switch OLED',itemId,captureScope:'one_search_one_detail',
     upstreamCalls:{oauth:1,search:1,detail:1},bodyByteMeaning:'bytes read after native fetch decoding',
     semanticVerification:'NOT_VERIFIED_REDACTED',personalDataPolicy:'unreviewed text withheld',
     authentication:'mock only',replayProtection:'none in this contract fixture',w1Status:'NOT_INTEGRATED_OR_APPROVED',responses:{}}
 };
 const payloadSha256=HASH(JSON.stringify(a));
 const meta={version:'b1-capture-reservation-receipt-1',campaignId:uuid,attemptId:uuid,contextDigest:'c'.repeat(64),identity,captureId:uuid,payloadSha256};
 return JSON.stringify({...a,reservationReceipt:{...meta,receiptDigest:HASH(JSON.stringify(meta))}});
}
const mutate=fn=>{const a=JSON.parse(wire());fn(a);return JSON.stringify(a)};
test('I1.2 version pinned',()=>assert.equal(B1_BRIDGE_VERSION,'kistefunn-b1-bridge-i1.2'));
test('I1.2 S1 builds three marketplace groups',()=>{const p=planB1FromS1({queries:['Fender Stratocaster 1995'],discovery_queries:['Fender Stratocaster Mexico']});assert.equal(p.mode,'NOT_DISPATCHED');assert.deepEqual(p.jobs.map(j=>j.marketplace),['EBAY_DE','EBAY_DE','EBAY_GB','EBAY_GB','EBAY_US','EBAY_US']);assert.equal(p.jobs.length,6)});
test('I1.2 S1 dedup and max four queries',()=>{const p=planB1FromS1({discovery_queries:['Alpha Model','Alpha   Model','Beta Model','Gamma Model','Delta Model'],queries:['Other Model']});assert.deepEqual(p.queries,['Alpha Model','Beta Model','Gamma Model','Delta Model']);assert.equal(p.jobs.length,12)});
test('I1.2 intents are never dispatched',()=>{const p=planB1FromS1({queries:['Nintendo Switch OLED']});assert.ok(p.jobs.every(j=>j.execution==='NOT_DISPATCHED'));assert.ok(Object.isFrozen(p.jobs));assert.ok(Object.isFrozen(p.queries));assert.ok(Object.isFrozen(p.jobs[0]))});
test('I1.2 invalid S1 object rejected',()=>{for(const v of [null,undefined,[],3])assert.throws(()=>planB1FromS1(v),/S1_CRITERIA_INVALID/)});
test('I1.2 unsafe query discarded',()=>{const p=planB1FromS1({queries:['xy','bad\u0000name','x'.repeat(101),'Valid Query']});assert.deepEqual(p.queries,['Valid Query'])});
test('I1.2 no query means no jobs',()=>assert.equal(planB1FromS1({queries:[],discovery_queries:[]}).jobs.length,0));
test('I1.2 status has no plaintext query and no rights',()=>{const s=describeB1Integration({queries:['Unique Secret User Input']});assert.equal(s.dispatch_allowed,false);assert.equal(s.usable_for_valuation,false);assert.equal(s.usable_for_ai_training,false);assert.equal(s.planned_market_jobs,3);assert.doesNotMatch(JSON.stringify(s),/Unique Secret User Input/)});
test('I1.2 rights gate denies retrieval and valuation',()=>{const s=describeB1Integration({queries:['Nintendo Switch OLED']});assert.equal(s.rights_retrieval,'blocked');assert.equal(s.rights_valuation,'blocked');assert.equal(s.status,'contract_connected_not_executed')});
test('I1.2 B1 v4 synthetic contract consistent but not authenticated',()=>{const s=inspectB1V4CaptureWire(wire());assert.equal(s.status,'capture_metadata_consistent_not_authenticated');assert.equal(s.sourceTrusted,false);assert.equal(s.dispatchAllowed,false);assert.equal(s.usableForValuation,false);assert.equal(s.usableForTraining,false);assert.deepEqual(s.calls,{oauth:1,search:1,detail:1});assert.ok(Object.isFrozen(s))});
test('I1.2 no completed analysis accepted',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.analysisComplete=true)),/CAPTURE_STATE_INVALID/));
test('I1.2 no false B1 completed status accepted',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.b1Status='ready')),/CAPTURE_STATE_INVALID/));
test('I1.2 fixed query and marketplace',()=>{for(const key of ['marketplace','query'])assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.manifest[key]='bad')),/SCOPE_INVALID/)});
test('I1.2 one call of each operation',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.manifest.upstreamCalls.search=2)),/SCOPE_INVALID/));
test('I1.2 item identities bind',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.responses.detail.itemId='v1|555|0')),/ITEM_BINDING_INVALID/));
test('I1.2 receipt identity binds',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.reservationReceipt.identity.query='Wrong Query')),/RECEIPT_INVALID/));
test('I1.2 manifest identity binds',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.manifest.projectId='prj_another')),/MANIFEST_IDENTITY_INVALID/));
test('I1.2 receipt digest mismatch',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.reservationReceipt.receiptDigest='0'.repeat(64))),/RECEIPT_DIGEST_INVALID/));
test('I1.2 payload digest mismatch',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>a.responses.detail.price={value:'999999',currency:'NOK'})),/PAYLOAD_DIGEST_INVALID/));
test('I1.2 absent receipt refused',()=>assert.throws(()=>inspectB1V4CaptureWire(mutate(a=>delete a.reservationReceipt)),/STRUCTURE_INVALID/));
test('I1.2 invalid wire type refused',()=>{for(const v of [null,{},123,undefined])assert.throws(()=>inspectB1V4CaptureWire(v),/WIRE_INVALID/)});
test('I1.2 noncanonical JSON refused',()=>{assert.throws(()=>inspectB1V4CaptureWire(wire()+'\n'),/CANONICAL_JSON_REQUIRED/);assert.throws(()=>inspectB1V4CaptureWire('{"version":1,"version":2}'),/CANONICAL_JSON_REQUIRED/)});
test('I1.2 oversize wire refused',()=>assert.throws(()=>inspectB1V4CaptureWire('a'.repeat(1_050_000)),/WIRE_INVALID/));
test('I1.2 no network, secrets or HTTP code in bridge',()=>{const s=readFileSync(new URL('../lib/b1-integration-bridge.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/\bfetch\s*\(|\brequest\s*\(|process\.env|authorization\s*:/i)});
