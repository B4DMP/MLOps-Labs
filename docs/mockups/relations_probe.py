import json
from collections import defaultdict
from pathlib import Path

from mlops_serious_game.domain.requirement import StakeholderRequirement, _stance_floors_and_ceilings, IntelTag

cfg = next(p for p in (Path("/gameConfig"), Path("/app/gameConfig"), Path("/app/../gameConfig")) if (p / "RequirementObjects.json").exists())
raw = json.load(open(cfg / "RequirementObjects.json", encoding="utf-8"))["requirements"]
reqs, bad = [], 0
for r in raw:
    try:
        reqs.append(StakeholderRequirement(**r))
    except Exception:
        bad += 1
print("items", len(reqs), "unparsed", bad)

by_ch = defaultdict(list)
for r in reqs:
    if r.stakeholder_id and r.type in (IntelTag.DRIVER, IntelTag.BOUNDARY, IntelTag.TRADE_OFF):
        by_ch[r.challenge_id].append(r)

rows = []
for ch, items in sorted(by_ch.items()):
    shapes = {r.id: _stance_floors_and_ceilings(r) for r in items}
    allies, rifts = set(), set()
    for a in items:
        for b in items:
            if a.id >= b.id or a.stakeholder_id == b.stakeholder_id:
                continue
            fa, ca = shapes[a.id]
            fb, cb = shapes[b.id]
            keys_a = {(t, ax) for t, ax, _ in fa}
            keys_b = {(t, ax) for t, ax, _ in fb}
            for k in keys_a & keys_b:
                allies.add((frozenset((a.stakeholder_id, b.stakeholder_id)), k))
            for (t, ax, lo) in fa:
                for (t2, ax2, hi) in cb:
                    if (t, ax) == (t2, ax2) and lo > hi:
                        rifts.add((frozenset((a.stakeholder_id, b.stakeholder_id)), (t, ax)))
            for (t, ax, lo) in fb:
                for (t2, ax2, hi) in ca:
                    if (t, ax) == (t2, ax2) and lo > hi:
                        rifts.add((frozenset((a.stakeholder_id, b.stakeholder_id)), (t, ax)))
    ally_pairs = {p for p, _ in allies}
    rift_pairs = {p for p, _ in rifts}
    rows.append((ch, len(items), len({r.stakeholder_id for r in items}), len(ally_pairs), len(rift_pairs)))

print("challenge items stakeholders ally_pairs rift_pairs")
for r in rows:
    print(*r)
n = len(rows)
print("challenges", n,
      "with>=1 ally", sum(1 for r in rows if r[3] >= 1),
      "with>=1 rift", sum(1 for r in rows if r[4] >= 1),
      "with>=2 threads", sum(1 for r in rows if r[3] + r[4] >= 2),
      "with 0 threads", sum(1 for r in rows if r[3] + r[4] == 0))
