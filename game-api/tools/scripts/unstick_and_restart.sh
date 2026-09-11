#!/bin/sh
set -e
export PYTHONPATH=/app/tools

log() { echo "[regen] $(date '+%H:%M:%S') $*"; }

log "=== unstick stuck items ==="
python -m content_gen --scope tier0 unstick

log "=== items (max_tokens=12000) ==="
python -m content_gen --scope tier0 --provider westai run --stage items

log "=== artifacts ==="
python -m content_gen --scope tier0 --provider westai run --stage artifacts

log "=== objections ==="
python -m content_gen --scope tier0 --provider westai run --stage objections

log "=== fragments ==="
python -m content_gen --scope tier0 --provider westai run --stage fragments

log "=== DONE — run assemble + validate next ==="
