// Read-only I1.3 protected Preview integration health check. No live market I/O.
import {rightsSummary} from '../lib/b1-rights-gate.mjs';
import {B1_CLIENT_VERSION,B1_REMOTE_VERSION} from '../lib/b1-v5-client.mjs';
import {B1_BRIDGE_VERSION} from '../lib/b1-integration-bridge.mjs';
export default function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({status:'method_not_allowed'});}
 if(process.env.VERCEL_ENV!=='preview')return res.status(403).json({status:'preview_only'});
 return res.status(200).json({
  status:'review_candidate',integrationVersion:'I1.3',
  bridgeVersion:B1_BRIDGE_VERSION,clientVersion:B1_CLIENT_VERSION,
  remoteVersion:B1_REMOTE_VERSION,rights: rightsSummary(),
  serverToServerConfigured:false,
  liveB1Dispatch:false,valuationFromB1:false,
  note:'No B1 capture, eBay search or live price valuation was performed.'
 });
}
