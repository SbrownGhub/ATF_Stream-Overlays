#!/usr/bin/env bash
# Smoke test against a deployed instance.
#   ./smoke.sh https://your-project.vercel.app  YOUR_PRESENTER_KEY
# Leaves the poll RESET and IDLE when it finishes.
set -euo pipefail
BASE="${1:?usage: ./smoke.sh <base-url> <presenter-key>}"
KEY="${2:?usage: ./smoke.sh <base-url> <presenter-key>}"
DEV="00000000-0000-4000-8000-$(printf '%012x' "$(date +%s)")"
pass(){ echo "PASS  $1"; }
fail(){ echo "FAIL  $1"; exit 1; }
ctl(){ curl -s -X POST "$BASE/api/control" -H 'Content-Type: application/json' -H "x-atf-key: $KEY" -d "$1"; }

curl -sf "$BASE/api/state" | grep -q '"status"'                 && pass "state endpoint"      || fail "state endpoint (check SUPABASE_URL and SUPABASE_SECRET_KEY)"
curl -sf "$BASE/api/ably-token" | grep -q 'subscribe'           && pass "ably token"          || fail "ably token (is ABLY_API_KEY set?)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/control" -H 'Content-Type: application/json' -d '{"action":"open"}')
[ "$code" = "401" ]                                              && pass "control locked"      || fail "control NOT locked ($code)"
ctl '{"action":"reset"}' | grep -q '"idle"'                      && pass "reset"               || fail "reset (is PRESENTER_KEY right?)"
curl -sf -X POST "$BASE/api/join" -H 'Content-Type: application/json' -d "{\"device\":\"$DEV\"}" >/dev/null && pass "join" || fail "join"
ctl '{"action":"open"}' | grep -q '"open"'                       && pass "open"                || fail "open"
curl -sf -X POST "$BASE/api/vote" -H 'Content-Type: application/json' -d "{\"device\":\"$DEV\",\"i\":0,\"pick\":\"r\"}" >/dev/null && pass "vote" || fail "vote (did setup.sql run? are the Supabase env vars set?)"
ctl '{"action":"panel","i":0,"pick":"red"}' | grep -q '"red"'    && pass "panel call"          || fail "panel call"
ctl '{"action":"freeze"}' | grep -q '"frozen"'                   && pass "freeze"              || fail "freeze"
ctl '{"action":"reset"}' >/dev/null                              && pass "cleaned up — idle"
