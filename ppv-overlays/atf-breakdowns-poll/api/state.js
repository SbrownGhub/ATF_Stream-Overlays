/* GET /api/state — public snapshot.
   Cached at Vercel's edge for 1s, so every voter polling this costs the
   database roughly one read per second in total, not one per voter.
   This is also what the daily keepalive hits. */
import { snapshot } from './_lib.js';

export default async function handler(req, res){
  if(req.method !== 'GET') return res.status(405).end();
  try{
    const snap = await snapshot();
    res.setHeader('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=2');
    return res.status(200).json(snap);
  }catch(e){
    return res.status(500).json({ error:'state unavailable' });
  }
}
