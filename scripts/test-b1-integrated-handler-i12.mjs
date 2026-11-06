// I1.2: run the actual analyze handler against real S1/B1 planning modules.
// Fake AI is an isolated test fixture; ALL outbound transports are forbidden.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateRights, requireRights, rightsSummary} from '../lib/b1-rights-gate.mjs';
import {describeB1Integration} from '../lib/b1-integration-bridge.mjs';
import {requestB1V5ForS1} from '../lib/b1-v5-client.mjs';

const source=readFileSync(new URL('../api/analyze.js',import.meta.url),'utf8');
const transformed=source.replace(/^import[^\n]*\n/gm,'')
  .replace('export default async function handler','async function handler');
const factory=new Function(
 'identifyWithOpenAI','logDiagnostic','isCompatibleGuitarBridgeVariant',
 'evaluateRights','requireRights','rightsSummary','describeB1Integration','requestB1V5ForS1',
 'fetch','process','performance','setTimeout','clearTimeout','Buffer',
 transformed+'\nreturn handler;'
);
async function analyze(description='Fender MIM 1995',extra={},env={}) {
 let calls=0;
 const reject=()=>{calls++;throw Error('FORBIDDEN_NETWORK_DISPATCH')};
 const ai=async()=>({
  parsed:{
   name:'Fender Stratocaster Mexico 1995',description:'Used Fender guitar',
   confidence:'høy',condition:'brukt',estimated_value_nok:6500,
   low_value_nok:5000,high_value_nok:7900,
   item_info:{brand:'Fender',model:'Stratocaster',type:'guitar',country:'Mexico',
     year_or_period:'1995',material:'tre'}
  },duration_ms:1,openai_diagnostics:{}
 });
 const handler=factory(ai,async()=>null,()=>true,
   evaluateRights,requireRights,rightsSummary,describeB1Integration,requestB1V5ForS1,
   reject,{env},{now:()=>Date.now()},()=>0,()=>{},null);
 const out={status:null,body:null};
 const res={status(code){out.status=code;return this},json(value){out.body=value;return this}};
 await handler({method:'POST',body:{description,...extra}},res);
 return {...out,networkCalls:calls};
}
test('I1.2 backend version advanced sequentially',()=>assert.match(source,/v15\.5\.63-i1\.3-b1-v5-transport/));
test('I1.2 actual handler makes valid S1-to-B1 plan',async()=>{
 const r=await analyze();
 assert.equal(r.status,200);
 assert.equal(r.networkCalls,0);
 assert.equal(r.body.version,'v15.5.63-i1.3-b1-v5-transport');
 assert.equal(r.body.b1_integration.version,'kistefunn-b1-bridge-i1.2');
 assert.equal(r.body.b1_integration.status,'contract_connected_not_executed');
 assert.ok(r.body.b1_integration.planned_query_count>=1);
 assert.ok(r.body.b1_integration.planned_market_jobs>=3);
 assert.ok(r.body.b1_integration.planned_market_jobs<=12);
});
test('I1.2 real query plan is not exposed in B1 status',async()=>{
 const r=await analyze();
 assert.doesNotMatch(JSON.stringify(r.body.b1_integration),/Stratocaster|Mexico|1995/);
 assert.equal(r.body.b1_integration.dispatch_allowed,false);
});
test('I1.2 actual analyzer stays AI-only and provider usage denied',async()=>{
 const r=await analyze();
 assert.equal(r.body.market_data_status,'ai_estimate_only');
 assert.equal(r.body.estimated_value_nok,6500);
 assert.equal(r.body.market_sources.ebay.enabled,false);
 assert.equal(r.body.market_sources.web_reference.enabled,false);
 assert.equal(r.body.b1_integration.usable_for_valuation,false);
 assert.equal(r.body.b1_integration.usable_for_ai_training,false);
});
test('I1.2 forged client approval cannot activate B1',async()=>{
 const r=await analyze('Fender MIM 1995',{
  b1_integration:{dispatch_allowed:true},
  allowEbay:true,rights_status:{ebay_valuation:'approved'}
 });
 assert.equal(r.networkCalls,0);
 assert.equal(r.body.b1_integration.dispatch_allowed,false);
 assert.equal(r.body.rights_status.ebay_valuation,'blocked');
});
test('I1.2 forged env flags cannot activate B1',async()=>{
 const r=await analyze('Fender MIM 1995',{},{
  B1_EBAY_CAPTURE_ENABLED:'1',B1_MARKET_LIVE:'1',KF_EBAY_RIGHTS_ENABLED:'true'
 });
 assert.equal(r.networkCalls,0);
 assert.equal(r.body.b1_integration.dispatch_allowed,false);
});
test('I1.2 result includes no market evidence sourced from B1 capture',async()=>{
 const r=await analyze();
 assert.equal(r.body.ebay.enabled,false);
 assert.equal(r.body.b1_integration.source,'b1_capture_v4');
 assert.match(r.body.b1_integration.reason,/B1_V4_CAPTURE_ONLY/);
});
test('I1.2 frontend states B1 bridge is connected but inactive',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/layout v1\.13/);
 assert.match(html,/B1-grensesnittet er koblet til søkeplanen, men B1-innhenting er ikke aktiv/);
});
