/* =====================================================================
   ATF BREAKDOWNS POLL — shared server code (Supabase + Ably)
   Files starting with _ inside /api are not exposed as endpoints.
   All database logic lives in supabase/setup.sql; this file just calls it.
   ===================================================================== */
import Ably from 'ably';
import crypto from 'node:crypto';

/* Vercel's Supabase integration and a manual setup name these differently —
   accept either. Works with a new-style secret key (sb_secret_…) or the
   legacy service_role JWT. */
const SB_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ably = process.env.ABLY_API_KEY ? new Ably.Rest(process.env.ABLY_API_KEY) : null;

export const CHANNEL = 'atf-breakdowns';
export const N = 5;
export const DEVICE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* Call a Postgres function through Supabase's REST API. */
export async function rpc(fn, args = {}){
  if(!SB_URL || !SB_KEY) throw new Error('Supabase env vars missing');
  const headers = { 'Content-Type':'application/json', apikey: SB_KEY };
  if(!SB_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${SB_KEY}`;   // legacy JWT keys
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method:'POST', headers, body: JSON.stringify(args)
  });
  const text = await r.text();
  if(!r.ok) throw new Error(`${fn} ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/* Normalise whatever Postgres returns into the shape every page expects. */
export function shape(s){
  s = s || {};
  const t = Array.isArray(s.tally) ? s.tally : [];
  const p = Array.isArray(s.panel) ? s.panel : [];
  return {
    ts: Date.now(),
    status: String(s.status || 'idle'),
    pollId: String(s.pollId || ''),
    pool: Number(s.pool || 0),
    live: s.live === true,
    tally: Array.from({ length:N }, (_, i) => ({ r: Number(t[i]?.r || 0), b: Number(t[i]?.b || 0) })),
    panel: Array.from({ length:N }, (_, i) => (p[i] === 'red' || p[i] === 'blue') ? p[i] : null)
  };
}

export async function snapshot(){ return shape(await rpc('bd_snapshot')); }

/* Push to Ably. Vote-driven pushes are throttled to one per 300ms by the
   database; anything they skip is caught by the clients' safety poll.
   Presenter actions pass their fresh snapshot and always push. */
export async function push(snap = null){
  if(!ably) return snap;
  if(!snap){
    const go = await rpc('bd_try_push', { p_ms: 300 });
    if(!go) return null;
    snap = await snapshot();
  }
  try{ await ably.channels.get(CHANNEL).publish('state', snap); }catch(e){ /* poll covers it */ }
  return snap;
}

export async function ablyToken(){
  if(!ably) throw new Error('ABLY_API_KEY not set');
  return ably.auth.createTokenRequest({
    capability: JSON.stringify({ [CHANNEL]: ['subscribe'] }),
    ttl: 6 * 60 * 60 * 1000
  });
}

/* Constant-time compare against the presenter key. */
export function isPresenter(req){
  const want = process.env.PRESENTER_KEY || '';
  const got  = String(req.headers['x-atf-key'] || '');
  if(!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function clientIp(req){
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

export function body(req){
  if(req.body && typeof req.body === 'object') return req.body;
  try{ return JSON.parse(req.body || '{}'); }catch(e){ return {}; }
}
