"""Print ledger counts and list non-done items."""
import sys
sys.path.insert(0, '/app/tools')

from pathlib import Path
from content_gen.ledger import Ledger

l = Ledger(Path('/app/tools/content_gen/work/ledger.sqlite'))
counts = l.counts()
print("=== Counts ===")
for stage, c in sorted(counts.items()):
    print(f"  {stage}: " + ", ".join(f"{k}={v}" for k, v in sorted(c.items())))

tin, tout = l.usage()
print(f"\nTotal tokens: in={tin}, out={tout}")

print("\n=== Non-done items ===")
for stage in ['templates', 'items', 'artifacts', 'objections', 'fragments']:
    rows = l.rows(stage)
    for r in rows:
        if r.status not in ('done', 'approved'):
            print(f"  [{r.status}] {r.item_id}")
l.close()
