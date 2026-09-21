/* POST /api/control — presenter only. Header: x-atf-key
   { action:'open' | 'freeze' | 'reset' | 'ping' }   ping = presenter heartbeat
   { action:'panel', i, pick:'red'|'blue'|null }   the panel's call */
import { rpc, shape, push, N, isPresenter, body } from './_lib.js';

const ACTIONS = new Set(['open', 'freeze', 'reset', 'panel', 'ping']);

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).end();
  if(!isPresenter(req)) return res.status(401).json({ error:'presenter key required' });

  const { action, i, pick } = body(req);
  if(!ACTIONS.has(action)) return res.status(400).json({ error:'unknown action' });
  const args = { p_action: action };
  if(action === 'panel'){
    const idx = Number(i);
    if(!Number.isInteger(idx) || idx < 0 || idx >= N) return res.status(400).json({ error:'bad ability' });
    if(pick !== 'red' && pick !== 'blue' && pick !== null) return res.status(400).json({ error:'bad pick' });
    args.p_ability = idx; args.p_pick = pick;
  }
  try{
    const snap = shape(await rpc('bd_control', args));
    if(action !== 'ping') await push(snap);      // heartbeats don't need broadcasting
    return res.status(200).json(snap);
  }catch(e){
    return res.status(500).json({ error:'control failed' });
  }
}
