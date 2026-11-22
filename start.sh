#!/usr/bin/env sh
# ytdown: one-command start for macOS and Linux.
# First run: creates engine/.venv, installs the engine, builds the web app if Node is present.
# Then: starts the engine on http://127.0.0.1:8787 and opens it in your browser.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$ROOT/engine"
WEB="$ROOT/web"
PY="$ENGINE/.venv/bin/python"

if [ ! -x "$PY" ]; then
  SYS=""
  for c in python3.13 python3.12 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then SYS="$c"; break; fi
  done
  if [ -z "$SYS" ]; then echo "ytdown needs Python 3.12 or newer: https://www.python.org/downloads/"; exit 1; fi
  echo "Setting up the engine (first run)..."
  "$SYS" -m venv "$ENGINE/.venv"
  "$PY" -m pip install --disable-pip-version-check -q --upgrade pip
  "$PY" -m pip install --disable-pip-version-check -q -r "$ENGINE/requirements.txt"
fi

if [ ! -f "$WEB/dist/index.html" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "Building the app (first run)..."
    (cd "$WEB" && npm ci --silent && npm run build --silent)
  else
    echo "Node.js isn't installed, so the app can't be built. Install Node 22+: https://nodejs.org"
  fi
fi

command -v ffmpeg >/dev/null 2>&1 || echo "Tip: ffmpeg isn't installed. macOS: brew install ffmpeg   Debian/Ubuntu: sudo apt install ffmpeg"

cd "$ENGINE" && exec "$PY" -m ytdown_engine --open "$@"
