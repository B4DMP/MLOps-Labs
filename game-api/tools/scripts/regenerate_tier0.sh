#!/bin/sh
# Regenerate all tier0 content stages sequentially with Qwen on WestAI.
# Templates are skipped (already approved; p3/s0 fixed manually).
# Run from inside the game-api container: /app/tools/scripts/regenerate_tier0.sh

set -e
export PYTHONPATH=/app/tools

log() { echo "[regen] $(date '+%H:%M:%S') $*"; }

log "=== items ==="
python -m content_gen --scope tier0 --provider westai run --stage items
log "=== artifacts ==="
python -m content_gen --scope tier0 --provider westai run --stage artifacts
log "=== objections ==="
python -m content_gen --scope tier0 --provider westai run --stage objections
log "=== fragments ==="
python -m content_gen --scope tier0 --provider westai run --stage fragments
log "=== DONE — run assemble next ==="
