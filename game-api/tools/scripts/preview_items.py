"""Preview generated items content for human review."""
import json, pathlib, sys

sys.path.insert(0, '/app/tools')

items_dir = pathlib.Path('/app/tools/content_gen/work/out/items')
for f in sorted(items_dir.glob('*.json')):
    d = json.loads(f.read_text())
    out = d.get('output', {})
    items = out.get('items', [])
    tags = {}
    for it in items:
        t = it.get('tag', 'unknown')
        tags[t] = tags.get(t, 0) + 1
    print(f'\n=== {f.stem} ===')
    print(f'  {len(items)} items: {dict(sorted(tags.items()))}')
    for it in items:
        sid = it.get('stakeholder_id') or 'fact'
        fact = it.get('fact', '')[:90]
        tag = it['tag']
        # Show conflict-related items specifically
        dr = it.get('driver', '') or ''
        bo = it.get('boundary', '') or ''
        tf = it.get('trade_off', '') or ''
        concedes = it.get('concedes_target') or it.get('concedes_metric') or ''
        holds = it.get('holds') or ''
        print(f'  [{tag:<10}] {sid:<20} | {fact}')
        if tag == 'trade_off' and concedes:
            print(f'    concedes: {concedes}')
        if tag == 'boundary' and holds:
            print(f'    holds: {holds}')
