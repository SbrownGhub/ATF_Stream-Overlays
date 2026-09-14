/* =====================================================================
   ATF AFTERMATH OVERLAY — SHARED STATE BUS
   Loaded by both aftermath-overlay.html and aftermath-control.html.

   STRUCTURE
     5 levels (rows), each a bout on the main card.
     LEFT  column  back layer = that bout's RED corner fighter
     RIGHT column  back layer = that bout's BLUE corner fighter
     Front layer, either side = that fighter's prospective next opponent.
     20 fighters total.

   Transport: localStorage (source of truth) + BroadcastChannel (instant)
              + a 300ms poll (fallback where events don't fire).
   ===================================================================== */

const ATF_KEY = 'atf_aftermath_overlay_state_v1';

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

function atfLoad(){
  try{
    const raw = localStorage.getItem(ATF_KEY);
    if(raw) return atfNormalise(JSON.parse(raw));
  }catch(e){ /* storage blocked or corrupt */ }
  return atfDefaultState();
}

let _atfChannel = null;
try{ _atfChannel = new BroadcastChannel('atf-aftermath-overlay'); }catch(e){ _atfChannel = null; }

function atfPublish(state, note){
  state.rev  = Date.now();
  state.note = note || null;        /* e.g. {cmd:'replay', target:'R1-l-back'} */
  try{ localStorage.setItem(ATF_KEY, JSON.stringify(state)); }catch(e){}
  if(_atfChannel){ try{ _atfChannel.postMessage(state); }catch(e){} }
  return state;
}

function atfSubscribe(cb){
  let lastRev = -1;
  const deliver = s => {
    if(!s || s.rev === lastRev) return;
    lastRev = s.rev;
    cb(atfNormalise(s), s.note || null);
  };
  if(_atfChannel) _atfChannel.onmessage = e => deliver(e.data);
  addEventListener('storage', e => {
    if(e.key !== ATF_KEY || !e.newValue) return;
    try{ deliver(JSON.parse(e.newValue)); }catch(err){}
  });
  setInterval(() => {
    try{
      const raw = localStorage.getItem(ATF_KEY);
      if(raw) deliver(JSON.parse(raw));
    }catch(e){}
  }, 300);
}

/* every unit id, in paint order */
function atfUnitIds(){
  const out = [];
  ATF_ROWS.forEach(r => ATF_SIDES.forEach(s => ATF_LAYERS.forEach(l => out.push(`${r.id}-${s}-${l}`))));
  return out;
}
