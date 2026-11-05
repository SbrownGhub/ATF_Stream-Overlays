/* =====================================================================
   ATF AFTERMATH — shared browser code (overlay + controller)
   ===================================================================== */
window.ATF = (() => {
  const SLOTS = [];
  for(let n = 1; n <= 10; n++) SLOTS.push(String(n), n + '.1');

  /* Internal slots: level 1 = 1 v 2, level 2 = 3 v 4 … odd = red (left),
     even = blue (right), N.1 = N's next opponent.
     File labels follow the bout instead: 1A / 1B are bout 1's red and blue,
     1.1 / 1.2 their next opponents. `label` is what the controller shows
     and what the image file must be called: "Fighter <label>.png". */
  function meta(slot){
    const n = parseInt(slot, 10), bout = Math.ceil(n / 2), red = n % 2 === 1;
    const front = slot.endsWith('.1');
    return {
      n,
      side:  red ? 'l' : 'r',
      level: bout,
      layer: front ? 'front' : 'back',
      label: front ? `${bout}.${red ? 1 : 2}` : `${bout}${red ? 'A' : 'B'}`
    };
  }

  /* Live connection. EventSource reconnects on its own; this also rebuilds
     it if a tablet was asleep long enough for the browser to give up. */
  function connect(onState, onConnection){
    let es = null, lastTs = 0;
    const open = () => {
      if(es) es.close();
      es = new EventSource('/events');
      es.addEventListener('state', e => {
        let s; try{ s = JSON.parse(e.data); }catch(err){ return; }
        if(s.ts < lastTs) return;
        lastTs = s.ts;
        onState(s);
      });
      es.onopen  = () => onConnection && onConnection(true);
      es.onerror = () => onConnection && onConnection(false);
    };
    open();
    document.addEventListener('visibilitychange', () => {
      if(!document.hidden && (!es || es.readyState === 2)) open();
    });
    return { reopen: open };
  }

  return { SLOTS, meta, connect };
})();
