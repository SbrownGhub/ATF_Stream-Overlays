#!/usr/bin/env node
/* =====================================================================
   ATF AFTERMATH — local server
   Runs on the Mac you stream from. No dependencies — Node 18+ only.

     Streamlabs  →  http://localhost:8787/overlay        (1920 x 1080)
     iPad        →  http://<this-mac>.local:8787/control

   • Holds the card, saves it to data/state.json on every change
   • Pushes every change to the overlay instantly (Server-Sent Events)
   • Serves fighters from ./fighters, named by bout and corner:
       Fighter 1A.png  bout 1 red      Fighter 1.1.png  1A's next opponent
       Fighter 1B.png  bout 1 blue     Fighter 1.2.png  1B's next opponent
     …up to Fighter 5B / 5.2 — trimmed of empty transparent space
   • Optional PIN: put digits in pin.txt, or start with ATF_PIN=1234
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { trimPNG } from './lib/png-trim.js';

const ROOT     = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC   = path.join(ROOT, 'public');
const FIGHTERS = process.env.ATF_FIGHTERS || path.join(ROOT, 'fighters');
const DATA     = process.env.ATF_DATA || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const PORT     = Number(process.env.PORT || 8787);
const PIN      = String(process.env.ATF_PIN || readText(path.join(ROOT, 'pin.txt')) || '').trim();

/* ---------------- slots ----------------
   Numbered by the card: level 1 is fighters 1 v 2, level 2 is 3 v 4 …
   Odd = red corner (left column), even = blue corner (right column).
   N.1 is fighter N's prospective next opponent (front layer). */
export const SLOTS = [];
for(let n = 1; n <= 10; n++) SLOTS.push(String(n), n + '.1');
const SLOT_RE = /^(10|[1-9])(\.1)?$/;

function defaultFighter(slot){
  const n = parseInt(slot, 10), front = slot.endsWith('.1');
  const corner = n % 2 ? 'red' : 'blue';
  return { name:'', color: front ? (corner === 'red' ? 'blue' : 'red') : corner, winner:false, visible:true };
}
function freshFighters(){ return Object.fromEntries(SLOTS.map(s => [s, defaultFighter(s)])); }

/* ---------------- state ---------------- */
let state = { fighters: freshFighters(), images: Object.fromEntries(SLOTS.map(s => [s, null])), rev: 0 };

function normalise(raw){
  const out = freshFighters();
  const src = raw && raw.fighters ? raw.fighters : {};
  for(const s of SLOTS){
    const f = src[s]; if(!f) continue;
    if(typeof f.name === 'string') out[s].name = f.name.slice(0, 40);
    if(f.color === 'red' || f.color === 'blue') out[s].color = f.color;
    if(typeof f.winner === 'boolean') out[s].winner = f.winner;
    if(typeof f.visible === 'boolean') out[s].visible = f.visible;
  }
  return out;
}
try{ state.fighters = normalise(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); }catch(e){ /* first run */ }

let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{
      await fsp.mkdir(DATA, { recursive:true });
      const tmp = STATE_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify({ fighters: state.fighters }, null, 2));
      await fsp.rename(tmp, STATE_FILE);                    // atomic: never a half-written file
    }catch(e){ console.error('  ! could not save state:', e.message); }
  }, 150);
}

/* ---------------- live updates (Server-Sent Events) ---------------- */
const clients = new Set();
function payload(note){ return JSON.stringify({ ...state, note: note || null, ts: Date.now() }); }
function broadcast(note){
  state.rev++;
  const msg = `event: state\ndata: ${payload(note)}\n\n`;
  for(const res of clients) res.write(msg);
}
setInterval(() => { for(const res of clients) res.write(': ping\n\n'); }, 20000);

/* ---------------- fighter images ----------------
   Files are named by BOUT and CORNER. Internally the overlay still uses
   slots 1–10 (odd = red, even = blue) and N.1 for each one's next opponent:

     Fighter 1A.png → slot 1      Fighter 1.1.png → slot 1.1
     Fighter 1B.png → slot 2      Fighter 1.2.png → slot 2.1
     Fighter 2A.png → slot 3      Fighter 2.1.png → slot 3.1   …

   Forgiving about what people actually type: the "Fighter" prefix is
   optional, case doesn't matter, and 1A / 1 A / 1.1 / 1_1 / 1-1 all work. */
const EXTS  = ['png', 'webp', 'jpg', 'jpeg'];
const TYPES = { png:'image/png', webp:'image/webp', jpg:'image/jpeg', jpeg:'image/jpeg' };
const NAME_RE = /^(?:fighter)?[\s_-]*([1-5])(?:\s*([ab])|[\s._-]+([12]))\.(png|webp|jpe?g)$/i;

export function slotForFile(file){
  const m = String(file).match(NAME_RE);
  if(!m) return null;
  const bout = Number(m[1]);
  if(m[2]) return String(2 * (bout - 1) + (m[2].toLowerCase() === 'a' ? 1 : 2));
  return (2 * (bout - 1) + Number(m[3])) + '.1';
}

let slotFiles = {};                  // slot -> filename
let lastReport = '';
async function scanFighters(){
  let files = [];
  try{ files = await fsp.readdir(FIGHTERS); }catch(e){ await fsp.mkdir(FIGHTERS, { recursive:true }).catch(() => {}); }
  const found = {}, ignored = [], dupes = [];
  for(const f of files.sort()){
    if(f.startsWith('.') || /^readme/i.test(f)) continue;
    const slot = slotForFile(f);
    if(!slot){ ignored.push(f); continue; }
    const ext = f.split('.').pop().toLowerCase(), prev = found[slot];
    if(prev){
      const better = EXTS.indexOf(ext) < EXTS.indexOf(prev.split('.').pop().toLowerCase());   // prefer PNG
      dupes.push(better ? prev : f);
      if(better) found[slot] = f;
    }else found[slot] = f;
  }
  slotFiles = found;

  /* Say so in the Terminal when a file can't be placed, so a typo in a
     filename is visible instead of the fighter just not appearing. */
  const report = JSON.stringify([ignored, dupes]);
  if(report !== lastReport){
    lastReport = report;
    if(ignored.length) console.log(`  ! Not recognised — rename to e.g. "Fighter 1A.png" or "Fighter 1.1.png":\n      ${ignored.join('\n      ')}`);
    if(dupes.length)   console.log(`  ! Two files for the same slot — ignoring:\n      ${dupes.join('\n      ')}`);
  }

  const next = {};
  for(const s of SLOTS){
    const f = found[s];
    if(!f){ next[s] = null; continue; }
    try{ const st = await fsp.stat(path.join(FIGHTERS, f)); next[s] = `${Math.round(st.mtimeMs)}-${st.size}`; }
    catch(e){ next[s] = null; }
  }
  if(JSON.stringify(next) !== JSON.stringify(state.images)){
    state.images = next;
    broadcast();                     // a new or replaced image appears without touching anything
  }
}
setInterval(scanFighters, 2000);

const trimCache = new Map();         // path -> { version, buf }
async function fighterImage(slot){
  const f = slotFiles[slot];
  if(!f) return null;
  const full = path.join(FIGHTERS, f), ext = f.split('.').pop().toLowerCase();
  const version = state.images[slot];
  const cached = trimCache.get(full);
  if(cached && cached.version === version) return cached;
  const raw = await fsp.readFile(full);
  const buf = ext === 'png' ? trimPNG(raw).buf : raw;      // trims PNGs; anything else as-is
  const entry = { version, buf, type: TYPES[ext] };
  trimCache.set(full, entry);
  return entry;
}

/* ---------------- updates from the controller ---------------- */
function applyOps(ops){
  let note = null;
  for(const op of Array.isArray(ops) ? ops : []){
    if(op && op.all === 'show'){ SLOTS.forEach(s => state.fighters[s].visible = true); note = { cmd:'showAll' }; continue; }
    if(op && op.all === 'hide'){ SLOTS.forEach(s => state.fighters[s].visible = false); continue; }
    if(op && op.all === 'reset'){ state.fighters = freshFighters(); note = { cmd:'reset' }; continue; }
    if(!op || !SLOT_RE.test(String(op.slot)) || typeof op.set !== 'object') continue;
    const f = state.fighters[op.slot], v = op.set;
    if(typeof v.name === 'string') f.name = v.name.slice(0, 40);
    if(v.color === 'red' || v.color === 'blue') f.color = v.color;
    if(typeof v.winner === 'boolean') f.winner = v.winner;
    if(typeof v.visible === 'boolean') f.visible = v.visible;
  }
  save();
  broadcast(note);
}

function pinOk(req){
  if(!PIN) return true;
  const got = String(req.headers['x-atf-pin'] || '');
  return got.length === PIN.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(PIN));
}

function readBody(req, limit = 64 * 1024){
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if(size > limit){ reject(new Error('too big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try{ resolve(JSON.parse(Buffer.concat(parts).toString() || '{}')); }catch(e){ reject(e); } });
    req.on('error', reject);
  });
}

/* ---------------- http ---------------- */
const PAGES = {
  '/overlay': ['overlay.html', 'text/html; charset=utf-8'],
  '/control': ['control.html', 'text/html; charset=utf-8'],
  '/shared.js': ['shared.js', 'text/javascript; charset=utf-8']
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  try{
    if(p === '/'){ res.writeHead(302, { Location:'/control' }); return res.end(); }

    if(PAGES[p] && req.method === 'GET'){
      const [file, type] = PAGES[p];
      res.writeHead(200, { 'Content-Type':type, 'Cache-Control':'no-cache' });
      return res.end(await fsp.readFile(path.join(PUBLIC, file)));
    }

    if(p === '/events' && req.method === 'GET'){
      res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
      res.write(`retry: 1500\nevent: state\ndata: ${payload()}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if(p === '/api/state' && req.method === 'GET'){
      res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-cache' });
      return res.end(payload());
    }

    if(p === '/api/config' && req.method === 'GET'){
      res.writeHead(200, { 'Content-Type':'application/json' });
      return res.end(JSON.stringify({ pinRequired: !!PIN }));
    }

    if(p === '/api/update' && req.method === 'POST'){
      if(!pinOk(req)){ res.writeHead(401, { 'Content-Type':'application/json' }); return res.end('{"error":"pin"}'); }
      let body;
      try{ body = await readBody(req); }catch(e){ res.writeHead(400); return res.end('{"error":"bad body"}'); }
      applyOps(body.ops);
      res.writeHead(200, { 'Content-Type':'application/json' });
      return res.end(payload());
    }

    const brand = p.match(/^\/brand\/([a-z0-9-]+\.png)$/);
    if(brand && req.method === 'GET'){
      try{
        const buf = await fsp.readFile(path.join(PUBLIC, 'brand', brand[1]));
        res.writeHead(200, { 'Content-Type':'image/png', 'Cache-Control':'max-age=3600' });
        return res.end(buf);
      }catch(e){ res.writeHead(404); return res.end(); }
    }

    const m = p.match(/^\/fighters\/(.+)$/);
    if(m && req.method === 'GET' && SLOT_RE.test(m[1])){
      const img = await fighterImage(m[1]);
      if(!img){ res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type':img.type, 'Cache-Control':'no-cache' });
      return res.end(img.buf);
    }

    res.writeHead(404, { 'Content-Type':'text/plain' }); res.end('Not found');
  }catch(e){
    console.error('  !', req.method, p, e.message);
    if(!res.headersSent) res.writeHead(500);
    res.end();
  }
});

function readText(f){ try{ return fs.readFileSync(f, 'utf8'); }catch(e){ return ''; } }

function lanAddresses(){
  const out = [];
  for(const list of Object.values(os.networkInterfaces()))
    for(const a of list || []) if(a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

server.on('error', e => {
  if(e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use — is the server already running in another window?\n`);
  else console.error(e);
  process.exit(1);
});

await scanFighters();
server.listen(PORT, '0.0.0.0', () => {
  const host = os.hostname().replace(/\.local$/i, '');
  const found = SLOTS.filter(s => state.images[s]).length;
  console.log(`
  ATF AFTERMATH is running.

    Streamlabs browser source:  http://localhost:${PORT}/overlay   (1920 x 1080)
    iPad controller:            http://${host}.local:${PORT}/control
${lanAddresses().map(ip => `                                http://${ip}:${PORT}/control`).join('\n')}

    Fighter images found: ${found} of 20   (folder: fighters/)
    PIN: ${PIN ? 'ON' : 'off — add pin.txt to require one'}

  Keep this window open during the show. Close it to stop.
`);
});

process.on('SIGINT', () => { clearTimeout(saveTimer);
  try{ fs.mkdirSync(DATA, { recursive:true });
       fs.writeFileSync(STATE_FILE, JSON.stringify({ fighters: state.fighters }, null, 2)); }catch(e){}
  process.exit(0); });
