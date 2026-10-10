"""Coverage gate for the case board (docs/plans/case-board.md, step 0).

Best case for D1 (confirmed items only): the player has verified every stance item, so every
tag is the true one. Ally/rift/chain/conflict threads come only from those items.
Run: docker compose exec api python /tmp/relations_probe.py (copy it in first), or `docker cp`.
"""
import json
from collections import defaultdict
from pathlib import Path

from mlops_serious_game.domain.graph_factory import GraphFactory
from mlops_serious_game.domain.requirement import (
    IntelTag, StakeholderRequirement, _set_values, _stance_floors_and_ceilings,
    item_target_and_level,
)
from mlops_serious_game.application.pitch_debate_service.session import find_pipeline_predecessors

cfg = next(p for p in (Path("/gameConfig"), Path("/app/gameConfig"), Path("/app/../gameConfig")) if (p / "RequirementObjects.json").exists())
graph = GraphFactory.load_graph(cfg / "MlopsGraph.json")
conflicts = {c["id"]: c.get("conflict") for c in json.load(open(cfg / "GameProgression.json", encoding="utf-8"))["challenges"]}
raw = json.load(open(cfg / "RequirementObjects.json", encoding="utf-8"))["requirements"]
reqs = []
for r in raw:
    try:
        reqs.append(StakeholderRequirement(**r))
    except Exception:
        pass
STANCE = (IntelTag.DRIVER, IntelTag.BOUNDARY, IntelTag.TRADE_OFF)
by_ch = defaultdict(list)
for r in reqs:
    if r.stakeholder_id and r.type in STANCE:
        by_ch[r.challenge_id].append(r)


def pair(a, b):
    return frozenset((a, b))


def stage_of(target):
    if graph.is_edge(target):
        return None
    return next((c.stage_id for c in graph.components if c.id == target), None)


rows = []
for ch, items in sorted(by_ch.items()):
    people = {r.stakeholder_id for r in items}
    shapes = {r.id: _stance_floors_and_ceilings(r) for r in items}
    ally, rift, chain_loose, chain_strict = set(), set(), set(), set()
    for a in items:
        for b in items:
            if a.stakeholder_id == b.stakeholder_id:
                continue
            fa, ca = shapes[a.id]
            fb, cb = shapes[b.id]
            if a.id < b.id:
                for k in {(t, ax) for t, ax, _ in fa} & {(t, ax) for t, ax, _ in fb}:
                    ally.add((pair(a.stakeholder_id, b.stakeholder_id), k))
                for (t, ax, lo) in fa:
                    for (t2, ax2, hi) in cb:
                        if (t, ax) == (t2, ax2) and lo > hi:
                            rift.add((pair(a.stakeholder_id, b.stakeholder_id), "floor"))
                for (t, ax, lo) in fb:
                    for (t2, ax2, hi) in ca:
                        if (t, ax) == (t2, ax2) and lo > hi:
                            rift.add((pair(a.stakeholder_id, b.stakeholder_id), "floor"))
                va = dict(_set_values(a))
                vb = dict(_set_values(b))
                if any(k in vb and vb[k] != v for k, v in va.items()):
                    rift.add((pair(a.stakeholder_id, b.stakeholder_id), "value"))
            # chain: a waits on b. a has a floor on T, b has a stance on an upstream U of T.
            for (t, ax, lo) in fa:
                ups = set(find_pipeline_predecessors(graph, t))
                tb, _, _ = item_target_and_level(b)
                if tb in ups:
                    chain_loose.add((a.stakeholder_id, b.stakeholder_id, t, tb))
                    if any(t2 == tb and hi < lo for t2, _, hi in cb) or any(t2 == tb for t2, _, _ in fb):
                        chain_strict.add((a.stakeholder_id, b.stakeholder_id, t, tb))
    cf = conflicts.get(ch)
    conflict_pair = None
    if cf:
        s = [p["stakeholder_id"] for p in cf["positions"]]
        if all(x in people for x in s):
            # An item touches the target if any target it names is that component or an edge into/out of it.
            near = {cf["target"]} | {e.id for e in graph.edges if cf["target"] in (e.from_id, e.to_id)}

            def touched(r):
                names = {item_target_and_level(r)[0]} | {t for t, _, _ in shapes[r.id][0] + shapes[r.id][1]}
                names |= {op.get("target") for op in (r.ops or []) if isinstance(op, dict)}
                return bool(names & near)

            held = {r.stakeholder_id for r in items if touched(r)}
            conflict_pair = pair(*s) if set(s) <= held else None
    ally_p = {p for p, _ in ally}
    rift_p = {p for p, _ in rift} | ({conflict_pair} if conflict_pair else set())
    chain_l = {(a, b) for a, b, *_ in chain_loose}
    chain_s = {(a, b) for a, b, *_ in chain_strict}
    # a pair already tied by an ally/rift is not a new thread; chains on top of it still count as one
    base = len(ally_p | rift_p)
    distinct_all = len(ally_p | rift_p | {pair(a, b) for a, b in chain_s})
    rows.append((ch, len(items), len(people), len(ally_p), len(rift_p), 1 if conflict_pair else 0,
                 len(chain_l), len(chain_s), base, distinct_all))

print("challenge items people ally rift(+conflict) conflict_ok chain_loose chain_strict a+r  distinct_pairs_all")
for r in rows:
    print(*r)
n = len(rows)
print("challenges", n)
print("with>=2 threads, ally+rift only:      ", sum(1 for r in rows if r[8] >= 2))
print("with>=2 threads, + chains (distinct pairs):", sum(1 for r in rows if r[9] >= 2))
print("with>=1 thread, ally+rift only:       ", sum(1 for r in rows if r[8] >= 1))
print("with 0 threads (all kinds):           ", sum(1 for r in rows if r[9] == 0))
print("conflict block usable (both people hold an item on its target):", sum(r[5] for r in rows))
