import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {B1_CLIENT_VERSION,B1_REMOTE_VERSION,verifyB1V5SignedResponse,requestB1V5ForS1} from '../lib/b1-v5-client.mjs';
const nonce='b'.repeat(32),token='TEST_SECRET_abcdefghijklmnopqrstuvwxyz0123456789';
const now=Date.parse('2026-11-06T12:30:00.000Z');
const sign=data=>{const raw=JSON.stringify(data);return {raw,mac:createHmac('sha256',token).update(raw).digest('hex')}};
const blocked=()=>({version:B1_REMOTE_VERSION,status:'rights_blocked',allowed:false,trainingAllowed:false,externalCalls:0,plannedJobs:2,plannedItems:8,results:[],code:'B1_V5_DATA_RIGHTS_BLOCKED',nonce,issuedAt:new Date(now).toISOString()});
test('I1.3 version is pinned',()=>assert.equal(B1_CLIENT_VERSION,'kistefunn-b1-client-i1.3'));
test('I1.3 valid signed B1 rights-blocked response is still not market data',()=>{
 const s=sign(blocked());
 const o=verifyB1V5SignedResponse(s.raw,nonce,s.mac,token,{now});
 assert.equal(o.status,'remote_rights_blocked');assert.equal(o.signed,true);
 assert.equal(o.usableForValuation,false);assert.equal(o.usableForTraining,false);
});
test('I1.3 wrong MAC is rejected',()=>{
 const s=sign(blocked());
 assert.throws(()=>verifyB1V5SignedResponse(s.raw,nonce,'a'.repeat(64),token,{now}),/SIGNATURE_INVALID/);
});
test('I1.3 wrong nonce rejected even with valid MAC',()=>{
 const s=sign({...blocked(),nonce:'c'.repeat(32)});
 assert.throws(()=>verifyB1V5SignedResponse(s.raw,nonce,s.mac,token,{now}),/RESPONSE_BINDING_INVALID/);
});
test('I1.3 stale signed payload rejected',()=>{
 const s=sign({...blocked(),issuedAt:'2026-11-06T12:20:00.000Z'});
 assert.throws(()=>verifyB1V5SignedResponse(s.raw,nonce,s.mac,token,{now}),/RESPONSE_STALE/);
});
test('I1.3 future-dated signed payload rejected',()=>{
 const s=sign({...blocked(),issuedAt:'2026-11-06T12:31:00.000Z'});
 assert.throws(()=>verifyB1V5SignedResponse(s.raw,nonce,s.mac,token,{now}),/RESPONSE_STALE/);
});
test('I1.3 forged positive valuation in blocked payload is rejected',()=>{
 const s=sign({...blocked(),results:[{price:999999}]});
 assert.throws(()=>verifyB1V5SignedResponse(s.raw,nonce,s.mac,token,{now}),/BLOCKED_RESPONSE_INVALID/);
});
test('I1.3 signed positive source response remains nonvaluative by default',()=>{
 const s=sign({version:B1_REMOTE_VERSION,status:'retrieved_not_licensed_for_valuation',
  results:[{marketplace:'EBAY_DE',query:'Synthetic only',items:[]}],
  nonce,issuedAt:new Date(now).toISOString()});
 const a=verifyB1V5SignedResponse(s.raw,nonce,s.mac,token,{now});
 assert.equal(a.usableForValuation,false);assert.equal(a.usableForTraining,false);
 assert.equal(a.status,'remote_capture_not_authorized_for_valuation');
});
test('I1.3 live request rejected before any transport while rights not approved',async()=>{
 let calls=0;
 const result=await requestB1V5ForS1({queries:['Fender Stratocaster'],discovery_queries:[]},{
  env:{VERCEL_ENV:'preview',B1_V5_TRANSPORT_ENABLED:'EXPLICIT_REVIEWED_PREVIEW',
   B1_V5_APP_TOKEN:token,B1_V5_ENDPOINT:'https://some-vercel-app.vercel.app/api/b1-v5-market',
   B1_V5_APPROVED_HOST:'some-vercel-app.vercel.app'},
  fetchImpl:async()=>{calls++;throw Error('NETWORK_FORBIDDEN');}
 });
 assert.equal(calls,0);
 assert.equal(result.status,'rights_blocked');
 assert.equal(result.networkDispatched,false);
});
test('I1.3 request-supplied client token cannot override server gate',async()=>{
 let calls=0;
 const result=await requestB1V5ForS1({queries:['Nintendo Switch OLED'],allowB1:true,token:'FAKE'},{
  env:{VERCEL_ENV:'preview',B1_V5_TRANSPORT_ENABLED:'EXPLICIT_REVIEWED_PREVIEW'},
  fetchImpl:async()=>{calls++;return null;}
 });
 assert.equal(calls,0);assert.equal(result.status,'rights_blocked');
});
test('I1.3 no queries results in no network and no plan',async()=>{
 const r=await requestB1V5ForS1({queries:[],discovery_queries:[]});
 assert.equal(r.status,'no_search_plan');assert.equal(r.plannedJobs,0);
});
