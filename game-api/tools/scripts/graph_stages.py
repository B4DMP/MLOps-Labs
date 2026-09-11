"""Print stage/component structure for layout planning."""
import json
from collections import defaultdict

with open('/gameConfig/MlopsGraph.json') as f:
    g = json.load(f)

by_stage = defaultdict(list)
for c in g.get('components', []):
    by_stage[c.get('stage', '?')].append(c['id'])

for stage in g.get('stages', []):
    comps = by_stage.get(stage['id'], [])
    print(f"\n## {stage['id']} — {stage['name']} ({len(comps)} components)")
    for cid in comps:
        print(f"  {cid}")

# Cross-stage pipeline edges
comp_to_stage = {c['id']: c.get('stage', '?') for c in g.get('components', [])}
print("\n## Cross-stage edges")
for edge in g.get('edges', []):
    from_s = comp_to_stage.get(edge['from'], '?')
    to_s = comp_to_stage.get(edge['to'], '?')
    if from_s != to_s:
        print(f"  {edge['id']}: {edge['from']}({from_s}) -> {edge['to']}({to_s})  [{edge.get('kind','')}]")
