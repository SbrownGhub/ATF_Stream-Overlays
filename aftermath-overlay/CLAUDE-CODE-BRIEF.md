# Claude Code brief — ATF Aftermath Overlay

Point Claude Code at this folder and paste the task block below. Read the
constraints first; they exist because the layout took several rounds of
approval and the sync model has one non-obvious failure mode.

---

## Constraints — do not violate

1. **The layout is approved and locked.** Do not change level positions,
   arc offsets (`ATF_ROWS` in `aftermath-bus.js`), pod scale, headshot slot
   sizes, bar dimensions, bar bleed, or the entrance animation curve.
   If something appears misaligned, report it — do not "fix" it.
2. **Bar colours are red or blue only.** No other colour may reach a bar.
3. **Green `#12C46B` is reserved for the winner marker and rim glow.**
4. **Do not add a replay button.** Entrance animation is triggered by a
   fighter going from hidden to shown. That is deliberate.
5. **No backend, no build step, no framework.** Three files, plain JS.
6. **Relative paths only** — the folder must work from any subdirectory.

## Task block

```
Working in <this folder>.

This is a finished OBS overlay: aftermath-overlay.html (browser source),
aftermath-control.html (control panel), aftermath-bus.js (shared localStorage state).
Read README.md and CLAUDE-CODE-BRIEF.md before touching anything.
The layout geometry is approved — do not change it.

1. VERIFY
   - Confirm aftermath-bus.js defines ATF_KEY, ATF_ROWS, ATF_BAR, ATF_SIDES,
     ATF_LAYERS, atfFighter, atfDefaultState, atfNormalise, atfLoad,
     atfPublish, atfSubscribe, atfUnitIds — and that both HTML files
     only use names that exist.
   - Confirm the overlay builds exactly 20 units with ids of the form
     R{1-5}-{l|r}-{back|front}.
   - Report any console error. Do not silently patch geometry.

2. TEST ASSETS
   Generate 6 placeholder PNGs into fighters/ — plain dark silhouette
   busts on full transparency, 400x480, named test1.png … test6.png.
   Use Pillow or node canvas, whichever is already available.

3. SERVE
   Start a static server on port 8080 from this folder.
   Confirm both pages load with no console errors.

4. PROVE THE LINK
   Write a short script or use a headless browser to confirm that a
   change written by aftermath-control.html is picked up by aftermath-overlay.html:
   set a name, a colour, a winner flag and an image filename, then
   assert the overlay DOM reflects all four. Report pass/fail per field.

5. REPORT
   Give me the exact two URLs for OBS — one for the browser source,
   one for the custom browser dock — and confirm they are the same
   origin, character for character.
```

## After it works

Commit and push into the existing `ATF_Stream-Overlays` repo, then point
both OBS entries at the GitHub Pages URL instead of localhost so you are
not depending on a terminal window staying open during a show.

## The failure mode to watch for

The controller reaches the overlay through `localStorage`, which only
syncs between pages on the **same origin**. OBS runs its browser in a
separate process from desktop Chrome, so:

- Controller in Chrome + overlay in OBS → **will not work**
- Controller as an OBS Custom Browser Dock + overlay as an OBS Browser
  Source, both on the same URL → works
- `http://localhost:8080` and `http://127.0.0.1:8080` are **different
  origins** — mixing them fails silently, with no error anywhere

If Claude Code hands you one of each, that is the bug. Make it re-check.
