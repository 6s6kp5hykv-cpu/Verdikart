// Kistefunn I1.3 — B1 v5 authenticated server-to-server client, deny by default.
// No browser-supplied host, token, approval, nonce, or eBay query is trusted.
// No B1 data is allowed into a valuation or AI training by this client.
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {planB1FromS1} from './b1-integration-bridge.mjs';
import {evaluateRights} from './b1-rights-gate.mjs';

export const B1_CLIENT_VERSION='kistefunn-b1-client-i1.3';
export const B1_REMOTE_VERSION='b1-market-v5.0-rights-gated';
const HEX=/^[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9_-]{32,256}$/;
function out(status,plannedJobs,details={}) {
 return Object.freeze({
  version:B1_CLIENT_VERSION,remoteVersion:B1_REMOTE_VERSION,
  status,plannedJobs,
  networkDispatched:false,
  usableForValuation:false,usableForTraining:false,
  ...details
 });
}
function reject(reason){throw new Error('B1_CLIENT_'+reason);}
function fixedEndpoint(endpoint,host) {
 if(typeof endpoint!=='string'||typeof host!=='string')reject('CONFIG_INVALID');
 let u;try{u=new URL(endpoint);}catch{reject('CONFIG_INVALID');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||
    u.pathname!=='/api/b1-v5-market'||u.hostname!==host||
    !/^[a-z0-9-]{1,63}\.vercel\.app$/.test(host))reject('CONFIG_INVALID');
 return u.href;
}
/** Authenticate service response and limit it to safe metadata. */
export function verifyB1V5SignedResponse(raw,nonce,mac,secret,{now=Date.now()}={}) {
 if(typeof raw!=='string'||Buffer.byteLength(raw)>524288||
    typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce)||
    typeof mac!=='string'||!HEX.test(mac)||typeof secret!=='string'||!TOKEN.test(secret))reject('RESPONSE_INVALID');
 const expected=createHmac('sha256',secret).update(raw).digest('hex');
 if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(mac,'hex')))reject('SIGNATURE_INVALID');
 let payload;try{payload=JSON.parse(raw);}catch{reject('RESPONSE_JSON_INVALID');}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    payload.version!==B1_REMOTE_VERSION||payload.nonce!==nonce)reject('RESPONSE_BINDING_INVALID');
 const when=Date.parse(payload.issuedAt);
 if(typeof payload.issuedAt!=='string'||!Number.isFinite(when)||when>now+5000||now-when>30000)reject('RESPONSE_STALE');
 if(payload.status==='rights_blocked') {
  if(payload.allowed!==false||payload.externalCalls!==0||!Array.isArray(payload.results)||payload.results.length!==0)reject('BLOCKED_RESPONSE_INVALID');
  return out('remote_rights_blocked',Number.isSafeInteger(payload.plannedJobs)?payload.plannedJobs:0,{signed:true,networkDispatched:true});
 }
 // An authenticated transport response does not provide legal clearance.
 // Valuation data must be evaluated separately by a future rights-cleared pipeline.
 if(payload.status==='retrieved_not_licensed_for_valuation'){
  if(!Array.isArray(payload.results)||payload.results.length>12)reject('RESULTS_INVALID');
  return out('remote_capture_not_authorized_for_valuation',payload.results.length,{signed:true,networkDispatched:true});
 }
 if(payload.status==='unavailable')return out('remote_unavailable',0,{signed:true,networkDispatched:true});
 reject('RESPONSE_STATUS_INVALID');
}
/** Run only from server-side analysis with previously reviewed rights and config. */
export async function requestB1V5ForS1(strict,{env=process.env,fetchImpl=globalThis.fetch,now=()=>Date.now(),nonceFactory=()=>randomBytes(16).toString('hex')}={}) {
 const plan=planB1FromS1(strict);
 if(!plan.jobs.length)return out('no_search_plan',0);
 const retrieval=evaluateRights('ebay_browse','market_retrieval').allowed;
 const valuation=evaluateRights('ebay_browse','market_valuation').allowed;
 if(!retrieval||!valuation)return out('rights_blocked',plan.jobs.length);
 if(env?.VERCEL_ENV!=='preview'||env?.B1_V5_TRANSPORT_ENABLED!=='EXPLICIT_REVIEWED_PREVIEW')return out('transport_disabled',plan.jobs.length);
 const secret=env?.B1_V5_APP_TOKEN,host=env?.B1_V5_APPROVED_HOST;
 if(typeof secret!=='string'||!TOKEN.test(secret))return out('missing_server_credentials',plan.jobs.length);
 let endpoint;try{endpoint=fixedEndpoint(env.B1_V5_ENDPOINT,host);}catch{return out('invalid_server_destination',plan.jobs.length);}
 if(typeof fetchImpl!=='function')return out('transport_unavailable',plan.jobs.length);
 const nonce=nonceFactory();
 if(typeof nonce!=='string'||!/^[a-f0-9]{32}$/.test(nonce))reject('NONCE_INVALID');
 const jobs=plan.jobs.map(job=>({marketplace:job.marketplace,query:job.query,limit:Math.min(5,job.maxResults)}));
 const wire=JSON.stringify({version:B1_REMOTE_VERSION,jobs});
 const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),10000);
 try {
  const headers={'Authorization':'Bearer '+secret,'Content-Type':'application/json','x-b1-request-nonce':nonce};
  const bypass=env?.B1_V5_PROTECTION_BYPASS;
  if(typeof bypass==='string'&&bypass.length>=32&&bypass.length<=256)headers['x-vercel-protection-bypass']=bypass;
  const res=await fetchImpl(endpoint,{method:'POST',headers,body:wire,signal:abort.signal,redirect:'error',cache:'no-store'});
  if(!res||res.redirected||res.url!==endpoint||![200,423,503].includes(res.status))reject('REMOTE_HTTP_INVALID');
  const raw=await res.text();const signed=verifyB1V5SignedResponse(raw,nonce,res.headers.get('x-b1-v5-mac'),secret,{now:now()});
  if((res.status===423&&signed.status!=='remote_rights_blocked')||
     (res.status===200&&signed.status!=='remote_capture_not_authorized_for_valuation')||
     (res.status===503&&signed.status!=='remote_unavailable'))reject('REMOTE_HTTP_MISMATCH');
  return signed;
 }catch{
  return out('transport_failed_closed',plan.jobs.length,{networkDispatched:true});
 }finally{clearTimeout(timeout);}
}
