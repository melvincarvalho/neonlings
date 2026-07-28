#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$DIR/shots}"
mkdir -p "$OUT"
CHROME="${CHROME:-chromium}"
SHOTS=(title level1 crowd digger builder blocker basher miner floater bomber exit ascent win fail)
for s in "${SHOTS[@]}"; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=2 --window-size=1280,720 \
    --virtual-time-budget=15000 \
    --screenshot="$OUT/$s.png" \
    "file://$DIR/index.html?shot=$s" 2>/dev/null
  echo "captured $s"
done
