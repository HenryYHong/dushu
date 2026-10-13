#!/bin/bash
# Double-click to start Dushu. Installs and builds on first run, then serves the app on port 4317.
cd "$(dirname "$0")" || exit 1
PORT=4317
URL="http://localhost:$PORT"

# Finder starts this with a minimal PATH; pick up node from the usual places.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Dushu needs Node.js (version 20 or newer). Install it from https://nodejs.org and try again."
  read -r -p "Press Return to close."
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing the pinned packages..."
  npm ci || { read -r -p "npm ci failed. Press Return to close."; exit 1; }
fi
export PATH="$PWD/node_modules/.bin:$PATH"

# Build if there is no build yet, or if anything in src/ or public/ is newer than it.
if [ ! -f dist/index.html ] || [ -n "$(find src public index.html vite.config.ts tsconfig.json package.json package-lock.json -newer dist/index.html -type f 2>/dev/null | head -1)" ]; then
  echo "Building..."
  npm run build || { read -r -p "Build failed. Press Return to close."; exit 1; }
fi

# The launcher verifies Dushu itself and starts the installed private AI service if needed,
# including when the reader server was already running.
node scripts/start-local.mjs || { read -r -p "Could not start Dushu. Press Return to close."; exit 1; }
open "$URL"
