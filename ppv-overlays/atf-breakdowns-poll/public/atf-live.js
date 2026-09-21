/* =====================================================================
   ATF BREAKDOWNS — shared browser client
   ATFLive(onState, { poll, realtime })
     realtime: subscribe to Ably for instant updates (overlay, presenter)
     poll:     ms between safety fetches of /api/state (everyone)
   Snapshots carry a timestamp; anything older than what's on screen is
   ignored, so a slow poll can never overwrite a fresher Ably push.
   ===================================================================== */
window.ATF = {
  ABILITIES: [
    { k:'striking',  l:'STRIKING'  },
    { k:'grappling', l:'GRAPPLING' },
    { k:'power',     l:'POWER'     },
    { k:'speed',     l:'SPEED'     },
    { k:'cardio',    l:'CARDIO'    }
  ],
  split(v){
    const t = v.r + v.b;
    if(!t) return null;
    const r = Math.round(v.r / t * 100);
    return [r, 100 - r];
  }
};

window.ATFLive = function(onState, opts = {}){
  /* poll: a number of ms, or a function (lastState) => ms, so a page can
     slow down when nothing is happening.
     pauseHidden: stop polling while the tab is in the background or the
     phone is locked, and catch up instantly when it comes back. */
  const poll = opts.poll || 2500;
  let last = 0, online = null, lastState = null, timer = null;

  const deliver = s => {
    if(!s || typeof s.ts !== 'number' || s.ts < last) return;
    last = s.ts; lastState = s;
    onState(s);
  };
  const setOnline = v => { if(v !== online){ online = v; opts.onConnection && opts.onConnection(v); } };

  const pull = () => fetch('/api/state', { cache:'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(s => { deliver(s); setOnline(true); })
    .catch(() => setOnline(false));

  const schedule = () => {
    clearTimeout(timer);
    if(opts.pauseHidden && document.hidden) return;
    const ms = typeof poll === 'function' ? poll(lastState) : poll;
    timer = setTimeout(() => pull().finally(schedule), ms);
  };
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) pull().finally(schedule);
    else if(opts.pauseHidden) clearTimeout(timer);
  });
  pull().finally(schedule);

  if(opts.realtime && window.Ably){
    try{
      const rt = new Ably.Realtime({ authUrl:'/api/ably-token' });
      rt.channels.get('atf-breakdowns').subscribe('state', m => deliver(m.data));
    }catch(e){ /* polling carries on */ }
  }
  return { deliver, pull };
};

/* iOS-style tap, synthesised — nothing to host. */
window.ATFSound = (() => {
  let ctx = null, buf = null, muted = false;
  function ac(){
    if(!ctx){ try{ ctx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ return null; } }
    if(ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tap(tone){
    const c = ac(); if(!c || muted) return; const t = c.currentTime;
    if(!buf){
      const n = Math.floor(c.sampleRate * .03);
      buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for(let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    }
    const s = c.createBufferSource(); s.buffer = buf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 5200; pk.gain.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .001);
    g.gain.exponentialRampToValueAtTime(.0001, t + .018);
    s.connect(hp).connect(pk).connect(g).connect(c.destination); s.start(t); s.stop(t + .04);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = tone;
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(.03, t + .001);
    g2.gain.exponentialRampToValueAtTime(.0001, t + .026);
    o.connect(g2).connect(c.destination); o.start(t); o.stop(t + .05);
  }
  return {
    call(corner){ tap(corner === 'red' ? 2400 : corner === 'blue' ? 2900 : 1550); },
    mute(v){ muted = v; }
  };
})();
