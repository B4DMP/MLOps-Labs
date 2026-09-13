#!/bin/sh
# Run after human review of items: assemble approved content into gameConfig and validate.
set -e
export PYTHONPATH=/app/tools

log() { echo "[assemble] $(date '+%H:%M:%S') $*"; }

log "=== assemble (tier0) ==="
python -m content_gen --scope tier0 assemble

log "=== validate (tier0) ==="
python -m content_gen --scope tier0 validate

log "=== DONE ==="
