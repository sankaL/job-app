#!/bin/sh

set -eu

LOCKFILE="package-lock.json"
STAMP_DIR="node_modules/.cache"
STAMP_FILE="$STAMP_DIR/package-lock.sha256"

mkdir -p "$STAMP_DIR"

CURRENT_HASH="$(sha256sum "$LOCKFILE" | awk '{print $1}')"
SAVED_HASH=""

if [ -f "$STAMP_FILE" ]; then
  SAVED_HASH="$(cat "$STAMP_FILE")"
fi

if [ ! -d "node_modules/recharts" ] || [ "$CURRENT_HASH" != "$SAVED_HASH" ]; then
  npm install
  printf '%s' "$CURRENT_HASH" > "$STAMP_FILE"
fi

exec npm run dev
