#!/bin/sh
set -e
cd /app
python -m pytest tests/ -x -q --tb=short 2>&1 | tail -30
