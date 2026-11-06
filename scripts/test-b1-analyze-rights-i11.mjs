// I1.1 integration regression: execute the actual analysis handler with fake AI.
// This deliberately refuses all external fetches. No live API/SQL/Neon/eBay calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateRights, requireRights, rightsSummary} from '../lib/b1-rights-gate.mjs';
import {describeB1Integration} from '../lib/b1-integration-bridge.mjs';

const source = readFileSync(new URL('../api/analyze.js', import.meta.url), 'utf8');
const translated = source.replace(/^import[^\n]*\n/gm, '')
 .replace('export default async function handler', 'async function handler');
const compile = new Function(
 'identifyWithOpenAI','logDiagnostic','isCompatibleGuitarBridgeVariant',
 'evaluateRights','requireRights','rightsSummary','describeB1Integration','fetch','process','performance',
 'setTimeout','clearTimeout','Buffer',
 translated + '\nreturn handler;'
);

async function runMock(body, env={}) {
 let calls=0;
 const fetch=async()=>{calls++;throw new Error('NETWORK_FORBIDDEN_IN_TEST');};
 const identifyWithOpenAI=async()=>({
   parsed:{
     name:'Synthetic Demo',description:'Synthetic object',condition:'brukt',confidence:'lav',
     estimated_value_nok:1500,low_value_nok:1100,high_value_nok:1900,
     item_info:{brand:'Synthetic',model:'Demo',type:'gjenstand',year_or_period:'ukjent',material:'',country:'',color:''}
   }, duration_ms:1, openai_diagnostics:{}
 });
 const handler=compile(
   identifyWithOpenAI, async()=>null, ()=>true,
   evaluateRights,requireRights,rightsSummary,describeB1Integration,fetch,{env},
   {now:()=>Date.now()}, ()=>0, ()=>{}, null
 );
 const output={status:null,body:null};
 const res={status(code){output.status=code;return this},json(value){output.body=value;return this}};
 await handler({method:'POST',body},res);
 assert.equal(calls,0,'no outbound requests allowed');
 return output;
}

test('I1.1 analysis success is clearly AI-only without eBay', async()=>{
 const r=await runMock({description:'Synthetic Demo'});
 assert.equal(r.status,200);
 assert.equal(r.body.version,'v15.5.62-i1.2-b1-bridge');
 assert.equal(r.body.market_data_status,'ai_estimate_only');
 assert.equal(r.body.estimated_value_nok,1500);
 assert.equal(r.body.ebay.enabled,false);
 assert.equal(r.body.market_sources.ebay.enabled,false);
 assert.equal(r.body.market_sources.web_reference.enabled,false);
 assert.equal(r.body.web_reference_market.status,'rights_blocked');
});
test('I1.1 rights decision is in response but never a token', async()=>{
 const r=await runMock({description:'Synthetic Demo'});
 assert.deepEqual(r.body.rights_status,{
  version:'b1-rights-i1.1',ebay_retrieval:'blocked',ebay_valuation:'blocked',
  ebay_ai_training:'blocked',external_web_valuation:'blocked'
 });
 assert.equal(r.body.ebay.diagnostic.code,'DATA_RIGHTS_BLOCKED');
});
test('I1.1 request fields cannot grant usage', async()=>{
 const r=await runMock({description:'Synthetic Demo', rights_status:{ebay_valuation:'approved'},grant:{approved:true},allowEbay:true});
 assert.equal(r.status,200);
 assert.equal(r.body.rights_status.ebay_valuation,'blocked');
 assert.equal(r.body.market_data_status,'ai_estimate_only');
});
test('I1.1 unsafe env flag cannot bypass reviewed rights policy', async()=>{
 const r=await runMock({description:'Synthetic Demo'},{B1_EBAY_CAPTURE_ENABLED:'1',KF_EBAY_RIGHTS_ENABLED:'true',OPENAI_MODEL:'mock'});
 assert.equal(r.status,200);
 assert.equal(r.body.rights_status.ebay_retrieval,'blocked');
 assert.equal(r.body.ebay.enabled,false);
});
test('I1.1 missing image and text remains a validated 400', async()=>{
 const r=await runMock({description:''});
 assert.equal(r.status,400);
});
test('I1.1 complete analysis source is syntactically valid',()=>{
 assert.match(source,/const BACKEND_VERSION = "v15\.5\.62-i1\.2-b1-bridge"/);
 assert.doesNotThrow(()=>compile);
});
test('I1.1 frontend clearly indicates unverified AI-only valuation',()=>{
 const html=readFileSync(new URL('../index.html', import.meta.url),'utf8');
 assert.match(html,/layout v1\.13/);
 assert.match(html,/Beløpet er et AI-estimat, ikke en bekreftet markedsverdi/);
});
