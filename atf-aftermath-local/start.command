#!/bin/bash
# ATF AFTERMATH — double-click to start the overlay server.
# Keeps this Mac awake while it runs. Close this window to stop.

cd "$(dirname "$0")" || exit 1

# A double-clicked .command doesn't load your shell profile, so look for
# Node where Homebrew, the official installer and nvm usually put it.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js wasn't found. Install it from https://nodejs.org (LTS), then try again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

# caffeinate stops the Mac sleeping (and the iPad losing the overlay)
# for exactly as long as the server is running.
exec caffeinate -is node server.js
