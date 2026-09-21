/* POST /api/join { device } — the "I'm in the pool" affirmation. */
import { rpc, DEVICE_RE, body } from './_lib.js';

export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(405).end();
  const { device } = body(req);
  if(!DEVICE_RE.test(String(device || ''))) return res.status(400).json({ error:'bad device' });
  try{
    await rpc('bd_join', { p_device: device });
    return res.status(200).json({ ok:true });
  }catch(e){
    return res.status(500).json({ error:'join failed' });
  }
}
