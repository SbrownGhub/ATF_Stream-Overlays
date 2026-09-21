# Claude Code brief — ATF Breakdowns Poll

Read the constraints before the task. The front end was approved over
many rounds. The backend has been tested end to end against a real
Postgres 16 database running `supabase/setup.sql`, with an HTTP stand-in
for Supabase's REST layer and Ably. It has **not** yet touched the live
Supabase, Vercel or Ably services. Your job is deployment and
verification, not redesign.

## Constraints — do not violate

1. **Only touch files inside this folder** — with exactly one exception:
   copying `keepalive/atf-breakdowns-keepalive.yml` to
   `.github/workflows/` at the repo root, as a **new** file. Never edit an
   existing workflow. The repo also holds a working ATF timer overlay.
2. **Do not change the overlay's look.** Geometry, the 1200 × 1511 design
   canvas and its 0.5628 cap, icons, percentages, animation and sound are
   approved. Report visual issues; don't fix them.
3. **Do not move vote logic out of Postgres.** Dedupe, counting, status
   checks and rate limiting live in `bd_vote()` so they're transactional.
4. **Voters must not connect to Ably**, and must keep the polling rules:
   3s while the presenter is connected or voting is open, 30s otherwise,
   none while hidden. Don't remove the 30s check — it's the only way a
   voter's page notices the presenter has come online. Don't remove the
   presenter heartbeat either; voters depend on it.
5. **Never expose the Supabase secret key, Ably key or presenter key to
   the browser**, and never put them in a committed file.
6. **Do not weaken `setup.sql`'s permissions.** The `revoke` statements
   are what stop the public key opening or resetting the poll.
7. No framework, no build step, no new dependencies.

## Task block

```
Working in /Users/silasbrown/APPS/ATF_Stream-Overlays/<this folder>

Read README.md and CLAUDE-CODE-BRIEF.md first. Only modify files inside
this folder, except the one keepalive workflow copy described in the brief.

1. VERIFY
   - npm install
   - node --check every file in api/
   - confirm vote.html never loads the Ably script
   - confirm nothing in public/ references a Supabase key
   - report anything wrong rather than fixing it

2. STOP FOR ME — I will:
   - run supabase/setup.sql in the Supabase SQL editor
   - create the Ably app
   - create the Vercel project (root = this folder, preset Other)
   - set SUPABASE_URL, SUPABASE_SECRET_KEY, ABLY_API_KEY, PRESENTER_KEY
   Do not invent, generate or ask me to paste these values into chat.

3. LOCAL TEST (after I confirm)
   - vercel link, then vercel env pull .env.local
   - confirm .env.local is gitignored BEFORE anything else
   - vercel dev; open /overlay, /vote, /presenter; no console errors

4. DEPLOY
   - vercel --prod
   - ./smoke.sh <prod-url> <presenter-key> — show me the output.
     Every line must be PASS.

5. KEEPALIVE
   - copy keepalive/atf-breakdowns-keepalive.yml to .github/workflows/
   - tell me to set the ATF_POLL_URL repository variable, then to run
     the workflow once manually and confirm it's green

6. COMMIT
   - git status first; show me. Every path must be inside this folder
     or be the single new workflow file. Anything else: stop.
   - commit: "Add ATF Breakdowns fan poll (Vercel + Supabase + Ably)"
   - push

7. REPORT
   Three production URLs, smoke test result, keepalive status.
```

## What "done" looks like

- `smoke.sh` all PASS against production
- `/presenter` on a phone: tapping a tick stamps the overlay within ~1s
- `/vote` on a second phone: after OPEN, the ballot appears within a few
  seconds; a vote moves the overlay's percentage
- `/vote` with `/presenter` closed shows "The show isn't live yet"; within
  30s of opening `/presenter` it switches to "Waiting for the presenters"
- The keepalive workflow has one green run

## If something fails

- **Tick takes several seconds, not ~1:** Ably isn't connecting and the
  2.5s poll is carrying it. Check `/api/ably-token` returns JSON.
- **Every API call returns 500:** check the Vercel function logs. A
  `permission denied` means the key is the publishable/anon key, not the
  secret key. A `function ... does not exist` means `setup.sql` hasn't run
  on this project.
- **Slow votes (300ms+):** the Vercel function region doesn't match the
  Supabase region. Fix `regions` in `vercel.json`.
