/* POST /api/vote { device, i, pick: 'r'|'b' }
   bd_vote() in Postgres decides everything in one transaction. */
import { rpc, DEVICE_RE, N, push, clientIp, body } from './_lib.js';

/* Generous on purpose: mobile carriers put thousands of real viewers behind
   one IP address. This stops a flood script, not a busy phone network. */
const RATE_LIMIT  = 120;
const RATE_WINDOW = 10;   // seconds

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).end();
  const { device, i, pick } = body(req);
  const idx = Number(i);
  if(!DEVICE_RE.test(String(device || ''))) return res.status(400).json({ error:'bad device' });
  if(!Number.isInteger(idx) || idx < 0 || idx >= N) return res.status(400).json({ error:'bad ability' });
  if(pick !== 'r' && pick !== 'b') return res.status(400).json({ error:'bad pick' });

  try{
    const r = await rpc('bd_vote', {
      p_device: device, p_ability: idx, p_pick: pick, p_ip: clientIp(req),
      p_limit: RATE_LIMIT, p_window: RATE_WINDOW
    });
    if(r === -1) return res.status(409).json({ error:'voting closed' });
    if(r === -2) return res.status(429).json({ error:'slow down' });
    if(r === -3) return res.status(400).json({ error:'bad vote' });
    if(r === 1) await push().catch(() => {});
    return res.status(200).json({ ok:true });
  }catch(e){
    return res.status(500).json({ error:'vote failed' });
  }
}
