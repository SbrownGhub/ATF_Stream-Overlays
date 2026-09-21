# ATF Breakdowns — Fan Poll

Live fan voting on five abilities, with the panel's own call alongside.

```
atf-breakdowns-poll/
├── api/
│   ├── _lib.js         shared: Supabase calls, Ably push, presenter auth
│   ├── state.js        GET  public snapshot (edge-cached 1s)
│   ├── join.js         POST "I'm in the pool"
│   ├── vote.js         POST a pick
│   ├── control.js      POST presenter actions — key required
│   └── ably-token.js   GET  subscribe-only realtime token
├── public/
│   ├── overlay.html    Streamlabs browser source, 608 × 766
│   ├── vote.html       the public link
│   ├── presenter.html  you and your co-presenter, phone layout
│   ├── atf-live.js     shared client: live updates, polling, sound
│   └── icons/          the five ability icons
├── supabase/setup.sql  run once in Supabase's SQL editor
├── keepalive/          GitHub Action that stops Supabase pausing
├── package.json  vercel.json  smoke.sh  .gitignore
└── README.md  CLAUDE-CODE-BRIEF.md
```

## How it fits together

| Piece | Job | Who connects |
|---|---|---|
| **Vercel** (Hobby) | Hosts the pages, runs the API, caches public state | Everyone |
| **Supabase** (Free) | Stores votes; all the rules live in Postgres functions | Only the API |
| **Ably** (Free) | Pushes changes instantly | Overlay + presenter only |

All the voting logic is in `supabase/setup.sql`. The API just calls those
functions. One row per device per ability is enforced by the table's primary
key, so a double vote isn't prevented by code being correct — it's
structurally impossible. Counts are worked out from the votes themselves,
so they can't drift.

The public key can touch nothing: every table has row-level security with
no policies, and every function has public execute revoked. Only the
server's secret key gets through.

## Setup

**1. Supabase.** Two free projects are allowed. If you already have one
active, use it — every object here is prefixed `bd_`, so it won't collide,
and it shares the keepalive. Otherwise create one in **London (eu-west-2)**.
Then SQL Editor → paste all of `supabase/setup.sql` → Run. Safe to re-run.

**2. Ably.** Create a new app called *ATF Breakdowns*, separate from the
timer, and copy its root API key.

**3. Vercel.** New Project → import `ATF_Stream-Overlays` → **Root
Directory** = this folder → preset **Other**. `vercel.json` pins functions
to London (`lhr1`) to sit next to the database. If your Supabase project
isn't in London, change that region to match — otherwise every vote
crosses an ocean twice.

**4. Environment variables** (Vercel → Settings → Environment Variables):

| Name | Value |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → a **secret** key (`sb_secret_…`). The legacy `service_role` key also works. **Never the publishable/anon key.** |
| `ABLY_API_KEY` | From step 2 |
| `PRESENTER_KEY` | A long random phrase you and your co-presenter type into `/presenter` |

**5. Deploy**, then `./smoke.sh https://<project>.vercel.app <PRESENTER_KEY>`.
Every line should say PASS. It leaves the poll reset.

**6. Keepalive.** See the instructions at the top of
`keepalive/atf-breakdowns-keepalive.yml`. It runs once a day. Without it,
a once-a-month show will find the database paused.

This repo also serves GitHub Pages, which will serve these HTML files too —
but `/api` doesn't exist there. **Always use the Vercel URL.**

## URLs

| Page | URL | Where |
|---|---|---|
| Overlay | `/overlay` | Streamlabs browser source, **608 × 766** |
| Voters | `/vote` | Pinned comment, QR on stream |
| Presenter | `/presenter` | Your phones |

## Running a segment

1. Open `/presenter` a few minutes before the segment — that wakes every
   voter's phone up to fast checking
2. Tap **OPEN** — voters' ballots appear within about 3 seconds
3. Leave it open **at least 45 seconds**. Your stream is 5–20s behind real
   time, so viewers hear you announce it well after you've pressed the button
4. Make the panel's calls whenever you like — separate from fan votes
5. **FREEZE** — voters see the final fan percentages on their phones
6. **Hold RESET** about a second to clear for the next fight. Let go early
   and nothing happens. The pool is kept, so nobody re-joins

## Staying on free tiers

How voters' phones behave, because this is what decides the Vercel bill:

| When | Voter phone checks in |
|---|---|
| Presenter controller connected, or voting open | Every **3s** |
| Presenter not connected, voting not open | One quiet check every **30s** |
| Tab in the background, or phone locked | **Never** — catches up instantly on return |

The presenter page sends a heartbeat every 20 seconds and counts as
connected for two minutes after the last one, so locking your phone
between rounds doesn't slow everyone down. Voting that's open always keeps
phones at 3s, whatever the presenter's phone is doing.

A phone can't be *told* the presenter has connected — that needs a live
connection to every phone, which this design avoids to stay free. The 30s
check is how pages notice you've come on air. In practice you'll open the
controller well before you open voting, so nobody waits.

| Service | Free allowance | One 500-voter show |
|---|---|---|
| Vercel | 1M edge requests/month | Worst case ~450k, if every voter keeps the page in front of them for 45 minutes. Usually far less. |
| Supabase | Unlimited API requests | A few thousand rows, cleared on reset |
| Ably | 6M messages, 200 connections | 3 connections, a few thousand messages |

Comfortable for one show a month. Two big shows in one month could get
close on Vercel, and Hobby has no overage billing — go over and features
pause for the rest of the 30 days. Check Vercel's usage page if you ever
double up.

Free Supabase projects pause after about a week of inactivity. The daily
keepalive handles that.

## Rules the database enforces

- One pick per device per ability; changing a pick moves the vote
- Votes refused unless open; a freeze waits for in-flight votes to finish
- 120 votes per 10s per IP — generous, because mobile carriers put
  thousands of real people behind one IP. Stops a flood script, not a
  busy phone network
- Device IDs are random and local. No sign-up, no personal data

A determined viewer in incognito can vote twice. Fine for a fan poll.

## Audio

The overlay plays the iOS-style tap when the panel makes a call, and in
Streamlabs that goes out on stream. For off-air only, mute the browser
source in the mixer and monitor it, or load `/overlay?mute`.

## Layout is locked

Card geometry, icon sizes, animation and sound are the approved design,
in `public/overlay.html`, and aren't exposed anywhere else.
