/* GET /api/ably-token — subscribe-only Ably token for the overlay and
   presenter pages. The Ably API key never leaves the server, and nobody
   holding one of these tokens can publish anything. */
import { ablyToken } from './_lib.js';

export default async function handler(req, res){
  try{
    const tr = await ablyToken();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(tr);
  }catch(e){
    return res.status(503).json({ error:'realtime unavailable' });
  }
}
