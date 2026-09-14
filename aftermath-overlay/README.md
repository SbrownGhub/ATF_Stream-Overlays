# ATF Aftermath Overlay

Twenty fighters arranged in five levels curving around the presenter.

```
aftermath-overlay/
├── aftermath-overlay.html      → the OBS browser source
├── aftermath-control.html      → the control panel
├── aftermath-bus.js        → shared state + geometry (both pages load this)
├── fighters/         → your headshot PNGs
└── README.md
```

## Structure

Five levels, one per main-card bout.

| | Back layer | Front layer |
|---|---|---|
| **Left column** | Red corner fighter | Their prospective next opponent |
| **Right column** | Blue corner fighter | Their prospective next opponent |

Level 1 left and level 1 right are the same fight, so the card reads
across the screen. The front fighter is larger and nearer — the overlay
argues about what's coming, not just what happened.

Levels step inward as they descend (0 / 6 / 34 / 96 / 200px), curving the
two columns around the lower half of the presenter. Bars are anchored to
the frame edge, so a level that sits further in automatically gets a
longer bar.

## Controls — six per fighter

| Control | What it does |
|---|---|
| Name | Text on the bar. Blank = clean colour block |
| Subline | Small mono line after the name |
| Image file | Filename in `fighters/` |
| RED / BLUE | Bar colour. Corner colours only, no other options |
| W | Winner marker — green circle with a white W, plus a green rim glow around the fighter |
| Toggle | Show/hide this fighter |

Plus Show all / Hide all / Reset / JSON in the header.

Entrance animations are automatic: a fighter slides in whenever they go
from hidden to shown, and Show all re-runs the whole card staggered.
There is no manual replay button — visibility is the trigger.

## Running it

- **OBS / Streamlabs → Browser source**, 1920 × 1080:
  `https://sbrownghub.github.io/ATF_Stream-Overlays/aftermath-overlay/aftermath-overlay.html`
- **Controller** — open anywhere: phone, tablet, another PC, or a browser dock:
  `https://sbrownghub.github.io/ATF_Stream-Overlays/aftermath-overlay/aftermath-control.html`

Every change travels two ways at once:

| Link | Reaches | Needs |
|---|---|---|
| `localStorage` + `BroadcastChannel` | pages in the same browser, same origin | nothing |
| Ably channel `atf-aftermath:atf` | any device | Ably key with capability `atf-aftermath:*`, Publish + Subscribe |

The controller header shows the Ably link: **REMOTE LIVE** is good,
**REMOTE DENIED** means the key's capability is missing `atf-aftermath:*`.
The key and room are set once in `aftermath-bus.js` (`ATF_ABLY_KEY`,
`ATF_ABLY_ROOM`), so every page always matches.

Newest change wins. A controller opening on a new device does not publish
on load — it asks the channel for the live card first, so it cannot wipe
it. The overlay caches the last card, so refreshing the browser source
keeps it.

For local testing:

```bash
cd aftermath-overlay
python3 -m http.server 8080
```

then use `http://localhost:8080/aftermath-overlay.html` and
`http://localhost:8080/aftermath-control.html`. All paths are relative, so
the folder works from any subdirectory. `file://` is fine for eyeballing
the layout but will not sync.

## Headshots

Transparent PNGs in `fighters/`. Slots are 148×176 (back) and 166×196
(front) before the 0.8 level scale, fit with `object-fit: contain`
anchored bottom-centre. Head-and-shoulders crops sit best.

A missing or misspelled filename falls back to the placeholder
silhouette rather than a broken image icon.

Right-column images are mirrored so fighters face inward — pre-flip any
PNG with a visible logo or sponsor patch.

## Prepping a card

Build the card before going live, hit **JSON**, and save the output per
event. Paste it back to restore. State also persists in `localStorage`,
so reopening OBS keeps your last card.

## Layout is locked

Level positions, arc offsets, headshot sizes and bar geometry live in
`ATF_ROWS` in `aftermath-bus.js` and the CSS in `aftermath-overlay.html`. They are
deliberately absent from the controller — approved layout, not a live
control.
