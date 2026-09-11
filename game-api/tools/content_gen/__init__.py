"""Content generation harness (plan 04). Run from game-api/tools: python -m content_gen --help"""

import importlib.util
import sys
from pathlib import Path

# Make the game package importable when run from tools/, both in the repo (game-api/src) and in
# the container (/app).
if importlib.util.find_spec("mlops_serious_game") is None:
    _root = Path(__file__).resolve().parents[2]
    for _candidate in (_root / "src", _root):
        if (_candidate / "mlops_serious_game").is_dir():
            sys.path.insert(0, str(_candidate))
            break
