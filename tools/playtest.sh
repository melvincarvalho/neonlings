#!/usr/bin/env bash
# Solvability proofs, three-sided:
#   solution replay must SOLVE every level (completability, with margin report)
#   null replay must FAIL every level (skills are load-bearing)
#   each provisioned skill ablated must FAIL its level (no dead skills in the pool)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-chromium}"
run() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --virtual-time-budget=40000 --dump-dom \
    "file://$DIR/index.html?$1" 2>/dev/null | grep -o 'VERIFY:{[^<]*' | head -1
}
for lvl in 0 1 2 3 4; do run "verify=$lvl&mode=solution"; done
for lvl in 0 1 2 3 4; do run "verify=$lvl&mode=null"; done
run "verify=0&mode=ablate&skill=digger"
run "verify=1&mode=ablate&skill=builder"
run "verify=1&mode=ablate&skill=bomber"
run "verify=2&mode=ablate&skill=basher"
run "verify=2&mode=ablate&skill=miner"
run "verify=3&mode=ablate&skill=floater"
run "verify=4&mode=ablate&skill=climber"
run "verify=4&mode=ablate&skill=builder"
run "verify=4&mode=ablate&skill=blocker"
run "verify=4&mode=ablate&skill=bomber"
run "verify=0&mode=mechrelease"
