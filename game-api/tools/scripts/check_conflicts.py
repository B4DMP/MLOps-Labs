"""Verify conflict blocks on all 4 tier0 templates."""
import json, pathlib

work = pathlib.Path('/app/tools/content_gen/work/out/templates')
for f in sorted(work.glob('templates__p*.json')):
    d = json.loads(f.read_text())
    out = d['output']
    c = out.get('conflict', 'MISSING')
    print(f"\n=== {f.name} — {out.get('name')} ===")
    print(f"  slug: {out.get('slug')}")
    print(f"  conflict: {json.dumps(c)}")
    if isinstance(c, dict):
        for pos in c.get('positions', []):
            print(f"    {pos['stakeholder_id']} wants level {pos['wants']}")
    print(f"  description: {out.get('description', '')[:100]}")
