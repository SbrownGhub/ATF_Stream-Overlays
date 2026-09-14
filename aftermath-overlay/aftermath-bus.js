/* =====================================================================
   ATF AFTERMATH OVERLAY — SHARED STATE BUS
   Loaded by both aftermath-overlay.html and aftermath-control.html.

   STRUCTURE
     5 levels (rows), each a bout on the main card.
     LEFT  column  back layer = that bout's RED corner fighter
     RIGHT column  back layer = that bout's BLUE corner fighter
     Front layer, either side = that fighter's prospective next opponent.
     20 fighters total.

   Transport:
     same device  localStorage (source of truth) + BroadcastChannel (instant)
                  + a 300ms poll (fallback where events don't fire).
     any device   Ably channel  atf-aftermath:<ROOM>  — controller on a phone,
                  tablet or other PC, overlay in OBS / Streamlabs.
                  The key's capability must allow  atf-aftermath:*
                  with Publish + Subscribe.

   Every state carries a rev. A page only accepts a rev newer than the
   newest it has seen, so duplicate or late deliveries are ignored, and
   every publish is stamped newer than anything seen (clock-skew safe).
   ===================================================================== */

const ATF_KEY = 'atf_aftermath_overlay_state_v1';

/* Ably remote link. ROOM lives here so every device always matches. */
const ATF_ABLY_KEY     = "tBw4fw.Du7a8g:Nw87ANLIEFE0uSU86Rt4-c2QWLPOMopApUBOwLJrC5E";
const ATF_ABLY_ROOM    = "atf";
const ATF_ABLY_CHANNEL = 'atf-aftermath:' + ATF_ABLY_ROOM;

/* Approved geometry. dx is how far a level steps inward — the arc.
   Deliberately not exposed in the controller. */
const ATF_ROWS = [
  { id:'R1', y:20,  dx:0   },
  { id:'R2', y:232, dx:6   },
  { id:'R3', y:444, dx:34  },
  { id:'R4', y:656, dx:96  },
  { id:'R5', y:868, dx:200 }
];

const ATF_BAR = { red:'#D71920', blue:'#1E4FD8' };

const ATF_SIDES  = ['l','r'];
const ATF_LAYERS = ['back','front'];

function atfFighter(color){
  return { name:'', meta:'', img:'', color:color, winner:false, visible:true };
}

function atfDefaultState(){
  return {
    rev: 0,
    rows: ATF_ROWS.map(row => ({
      id: row.id,
      /* left back is the red corner, right back is the blue corner.
         Each front fighter defaults to the opposite colour so every
         pod still reads as one red bar and one blue bar. */
      l: { back: atfFighter('red'),  front: atfFighter('blue') },
      r: { back: atfFighter('blue'), front: atfFighter('red')  }
    }))
  };
}

/* Merge stored data onto a fresh default so a partial or older payload
   can never leave the overlay with missing fields. */
function atfNormalise(raw){
  const base = atfDefaultState();
  if(!raw || !Array.isArray(raw.rows)) return base;
  base.rev = raw.rev || 0;
  base.rows.forEach(row => {
    const inc = raw.rows.find(x => x && x.id === row.id);
    if(!inc) return;
    ATF_SIDES.forEach(s => {
      if(!inc[s]) return;
      ATF_LAYERS.forEach(l => {
        const f = inc[s][l];
        if(!f) return;
        const t = row[s][l];
        if(typeof f.name    === 'string')  t.name    = f.name;
        if(typeof f.meta    === 'string')  t.meta    = f.meta;
        if(typeof f.img     === 'string')  t.img     = f.img;
        if(f.color === 'red' || f.color === 'blue') t.color = f.color;
        if(typeof f.winner  === 'boolean') t.winner  = f.winner;
        if(typeof f.visible === 'boolean') t.visible = f.visible;
      });
    });
  });
  return base;
}

let _atfRev   = 0;      /* newest rev this page has seen or sent */
let _atfState = null;   /* newest state, used to answer sync requests */
const _atfListeners = [];

function _atfStore(state){
  try{ localStorage.setItem(ATF_KEY, JSON.stringify(state)); }catch(e){}
}

function atfLoad(){
  let s = atfDefaultState();
  try{
    const raw = localStorage.getItem(ATF_KEY);
    if(raw) s = atfNormalise(JSON.parse(raw));
  }catch(e){ /* storage blocked or corrupt */ }
  if(s.rev > _atfRev) _atfRev = s.rev;
  _atfState = s;
  return s;
}

let _atfChannel = null;
try{ _atfChannel = new BroadcastChannel('atf-aftermath-overlay'); }catch(e){ _atfChannel = null; }

function atfPublish(state, note){
  state.rev  = Math.max(Date.now(), _atfRev + 1);
  state.note = note || null;        /* e.g. {cmd:'replay', target:'all'} */
  _atfRev = state.rev;
  _atfState = state;
  _atfStore(state);
  if(_atfChannel){ try{ _atfChannel.postMessage(state); }catch(e){} }
  _atfAblyConnect();
  _atfAblySend('state', state);
  return state;
}

function _atfDeliver(s, fromRemote){
  if(!s || !(s.rev > _atfRev)) return;
  _atfRev = s.rev;
  const clean = atfNormalise(s);
  _atfState = clean;
  if(fromRemote) _atfStore(s);      /* cache so a refresh keeps the card */
  _atfListeners.forEach(cb => cb(clean, s.note || null));
}

function atfSubscribe(cb){
  _atfListeners.push(cb);
  _atfAblyConnect();
}

if(_atfChannel) _atfChannel.onmessage = e => _atfDeliver(e.data, false);
addEventListener('storage', e => {
  if(e.key !== ATF_KEY || !e.newValue) return;
  try{ _atfDeliver(JSON.parse(e.newValue), false); }catch(err){}
});
setInterval(() => {
  try{
    const raw = localStorage.getItem(ATF_KEY);
    if(raw) _atfDeliver(JSON.parse(raw), false);
  }catch(e){}
}, 300);

/* ---------- Ably: cross-device link ----------
   Link states: off · connecting · live · offline · denied */
let _atfAblyCh = null;
let _atfAblyTried = false;
let _atfLinkState = 'off';
const _atfLinkCbs = [];

function _atfSetLink(st){
  if(st === _atfLinkState) return;
  _atfLinkState = st;
  _atfLinkCbs.forEach(cb => cb(st));
}

function atfOnLink(cb){
  _atfLinkCbs.push(cb);
  cb(_atfLinkState);
}

function _atfAblySend(name, data){
  if(!_atfAblyCh || _atfLinkState === 'denied') return;
  _atfAblyCh.publish(name, data, err => {
    if(err) console.warn('ATF: Ably publish failed — ' + err.message);
  });
}

/* Ask the channel for its newest card. Anyone holding a newer one answers;
   anyone holding an older one asks back, so the newest card always wins. */
function _atfAblySync(){
  _atfAblySend('sync', { rev: _atfRev });
}

function _atfAblyConnect(){
  if(_atfAblyTried) return;         /* one attempt per page — no retry spam without a key */
  _atfAblyTried = true;
  if(typeof Ably === 'undefined'){
    console.warn('ATF: Ably library did not load — cross-device control disabled, same-device sync still works.');
    return;
  }
  if(!ATF_ABLY_KEY || ATF_ABLY_KEY.indexOf('PASTE_') === 0){
    console.warn('ATF: No Ably API key set — cross-device control disabled. Edit ATF_ABLY_KEY in aftermath-bus.js.');
    return;
  }

  _atfSetLink('connecting');
  const ably = new Ably.Realtime({
    key: ATF_ABLY_KEY,
    clientId: 'atf-aftermath-' + Math.random().toString(36).slice(2, 8),
    echoMessages: false
  });
  const ch = _atfAblyCh = ably.channels.get(ATF_ABLY_CHANNEL);

  ably.connection.on(['connecting', 'disconnected'], () => { if(_atfLinkState !== 'denied') _atfSetLink('connecting'); });
  ably.connection.on(['suspended', 'failed', 'closed'], s => {
    if(_atfLinkState !== 'denied') _atfSetLink('offline');
    if(s && s.reason) console.error('ATF: Ably connection ' + s.current + ' — ' + s.reason.message);
  });
  ably.connection.on('connected', () => { if(ch.state === 'attached') _atfAblySync(); });

  ch.on('attached', () => { _atfSetLink('live'); _atfAblySync(); });

  ch.subscribe('state', msg => _atfDeliver(msg.data, true), err => {
    if(!err) return;
    _atfSetLink(err.code === 40160 || err.statusCode === 401 ? 'denied' : 'offline');
    console.error('ATF: Channel access denied for "' + ATF_ABLY_CHANNEL + '". ' +
      'Ably key capability must include  atf-aftermath:*  with Publish + Subscribe. Error: ' + err.message);
  });

  ch.subscribe('sync', msg => {
    const theirs = (msg.data && msg.data.rev) || 0;
    if(_atfRev > theirs && _atfState) _atfAblySend('state', Object.assign({}, _atfState, { note: null }));
    else if(_atfRev < theirs) _atfAblySync();
  });
}

/* every unit id, in paint order */
function atfUnitIds(){
  const out = [];
  ATF_ROWS.forEach(r => ATF_SIDES.forEach(s => ATF_LAYERS.forEach(l => out.push(`${r.id}-${s}-${l}`))));
  return out;
}
