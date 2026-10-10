"""Relations between stakeholders, derived from a challenge's intel items (docs/plans/case-board.md, D2).

Pure and deterministic, no DB. Relations come from ground-truth items and are never stored in
content. Whether the *player* may see one is `eligible`: they must hold a verified item on each
side (D1), so a thread can only repeat what the dossier already shows.
"""

import hashlib
from collections.abc import Collection, Iterable
from typing import Any, Literal, Optional

from pydantic import BaseModel

from mlops_serious_game.domain.graph import TechnicalGraph
from mlops_serious_game.domain.requirement import (
    IntelTag,
    _set_values,
    item_target_and_level,
    stance_floors_and_ceilings,
)

RelationKind = Literal["ally", "rift", "chain", "step"]
_KIND_ORDER = {"ally": 0, "rift": 1, "chain": 2, "step": 3}
_STANCE = (IntelTag.DRIVER, IntelTag.BOUNDARY, IntelTag.TRADE_OFF)


class Relation(BaseModel):
    id: str
    kind: RelationKind
    a: str  # stakeholder id; for a chain, the one who waits. A step is unordered like an ally
    b: str
    target: str
    a_item_ids: list[str]
    b_item_ids: list[str]
    via: Optional[str] = None  # chain: the capping upstream target
    on_record: bool = False  # the challenge's own conflict block: already public, pinned for free


def _rid(kind: str, a: str, b: str, target: str) -> str:
    ends = ":".join(sorted((a, b))) if kind != "chain" else f"{a}:{b}"
    return hashlib.sha1(f"{kind}|{ends}|{target}".encode()).hexdigest()[:12]


def _make(kind, a, b, target, a_ids, b_ids, via=None) -> Relation:
    if kind != "chain" and a > b:
        a, b, a_ids, b_ids = b, a, b_ids, a_ids
    return Relation(
        id=_rid(kind, a, b, target), kind=kind, a=a, b=b, target=target,
        a_item_ids=sorted(set(a_ids)), b_item_ids=sorted(set(b_ids)), via=via,
    )


def _near(graph: TechnicalGraph, target: str) -> set[str]:
    """The target plus every edge into or out of it."""
    return {target} | {e.id for e in graph.edges if target in (e.from_id, e.to_id)}


def _touched(item: Any, shape: tuple) -> set[str]:
    names = {item_target_and_level(item)[0]} | {t for t, _, _ in shape[0] + shape[1]}
    names |= {op.get("target") for op in (getattr(item, "ops", None) or []) if isinstance(op, dict)}
    names.discard(None)
    return names


def _min_slack_to(graph: TechnicalGraph, target: str) -> dict[str, int]:
    """Least total slack along any pipeline path from each upstream node to `target`'s supply."""
    start = graph.edge(target).from_id if graph.is_edge(target) else target
    best = {start: 0}
    changed = True
    while changed:
        changed = False
        for e in graph.pipeline_edges():
            if e.to_id in best:
                cand = best[e.to_id] + e.slack
                if cand < best.get(e.from_id, 1 << 30):
                    best[e.from_id] = cand
                    changed = True
    return best


def _max_automation(graph: TechnicalGraph, target: str) -> int:
    node = graph.edge(target) if graph.is_edge(target) else next(c for c in graph.components if c.id == target)
    return max(node.allowed_automation)


def derive_relations(items: Iterable[Any], conflict: Optional[Any], graph: TechnicalGraph) -> list[Relation]:
    """Every ally, rift and chain between stakeholders in one challenge, sorted and id-stable."""
    stance = [r for r in items if r.type in _STANCE and getattr(r, "stakeholder_id", None)]
    shapes = {r.id: stance_floors_and_ceilings(r) for r in stance}
    found: dict[str, Relation] = {}

    def add(rel: Relation) -> None:
        old = found.get(rel.id)
        if old:
            rel = rel.model_copy(update={
                "a_item_ids": sorted(set(old.a_item_ids) | set(rel.a_item_ids)),
                "b_item_ids": sorted(set(old.b_item_ids) | set(rel.b_item_ids)),
                "on_record": old.on_record or rel.on_record,
            })
        found[rel.id] = rel

    for a in stance:
        fa, ca = shapes[a.id]
        for b in stance:
            if a.stakeholder_id >= b.stakeholder_id:
                continue
            fb, cb = shapes[b.id]
            # Allies agree: both need the same (target, axis) reached, or both will only go so far on it.
            wanted = ({(t, ax) for t, ax, _ in fa} & {(t, ax) for t, ax, _ in fb}) | (
                {(t, ax) for t, ax, _ in ca} & {(t, ax) for t, ax, _ in cb}
            )
            for key in sorted(wanted):
                add(_make("ally", a.stakeholder_id, b.stakeholder_id, key[0], [a.id], [b.id]))
            for floors, ceilings, lo_item, hi_item in ((fa, cb, a, b), (fb, ca, b, a)):
                for t, ax, lo in floors:
                    if any((t, ax) == (t2, ax2) and lo > hi for t2, ax2, hi in ceilings):
                        add(_make("rift", lo_item.stakeholder_id, hi_item.stakeholder_id, t, [lo_item.id], [hi_item.id]))
            va, vb = dict(_set_values(a)), dict(_set_values(b))
            for key, value in va.items():
                if key in vb and vb[key] != value:
                    add(_make("rift", a.stakeholder_id, b.stakeholder_id, key.split(".trigger")[0], [a.id], [b.id]))

    # The conflict block names the rift directly; each side needs an item that touches its target.
    if conflict is not None:
        near = _near(graph, conflict.target)
        ids = {}
        for pos in conflict.positions:
            ids[pos.stakeholder_id] = [r.id for r in stance if r.stakeholder_id == pos.stakeholder_id and _touched(r, shapes[r.id]) & near]
        s1, s2 = (p.stakeholder_id for p in conflict.positions)
        if s1 != s2 and ids[s1] and ids[s2]:
            add(_make("rift", s1, s2, conflict.target, ids[s1], ids[s2]).model_copy(update={"on_record": True}))

    # One pair is never both allies and at odds: where a rift stands (the authored conflict included),
    # whatever else they agree on does not make them allies.
    rifted = {frozenset((r.a, r.b)) for r in found.values() if r.kind == "rift"}
    for rid in [rid for rid, r in found.items() if r.kind == "ally" and frozenset((r.a, r.b)) in rifted]:
        del found[rid]

    # A shared step: two people each have a stance on the same component or edge, on different axes or
    # in ways that neither agree nor clash (those are allies and rifts). The step is where they meet.
    graph_targets = {c.id for c in graph.components} | {e.id for e in graph.edges}
    for a in stance:
        for b in stance:
            if a.stakeholder_id >= b.stakeholder_id:
                continue
            for target in sorted(_touched(a, shapes[a.id]) & _touched(b, shapes[b.id]) & graph_targets):
                if any(_rid(kind, a.stakeholder_id, b.stakeholder_id, target) in found for kind in ("ally", "rift")):
                    continue
                add(_make("step", a.stakeholder_id, b.stakeholder_id, target, [a.id], [b.id]))

    # A chain: A needs T at some automation level, an upstream U cannot deliver it, and B owns U's
    # stage or holds a stance on U. U's reach is its allowed maximum, or lower if B's ceiling says so.
    slack_cache: dict[str, dict[str, int]] = {}
    owner = {c.id: c.owner_role or next((s.owner_role for s in graph.stages if s.id == c.stage_id), None) for c in graph.components}
    for a in stance:
        for t, ax, level in shapes[a.id][0]:
            if ax != "automation" or not (graph.is_edge(t) or t in owner):
                continue
            slack = slack_cache.setdefault(t, _min_slack_to(graph, t))
            # Upstream components, and pipeline edges whose far end is upstream, with how much
            # slack lies between each and T.
            sources = {u: s for u, s in slack.items() if u != t}
            sources.update({e.id: e.slack + slack[e.to_id] for e in graph.pipeline_edges() if e.to_id in slack and e.id != t})
            extra = 1 if graph.is_edge(t) else 0
            for u, downstream in sorted(sources.items()):
                stage_owner = owner.get(graph.edge(u).to_id if graph.is_edge(u) else u)
                for b_id in sorted({r.stakeholder_id for r in stance if r.stakeholder_id != a.stakeholder_id}):
                    b_items = [r for r in stance if r.stakeholder_id == b_id]
                    touching = [r.id for r in b_items if u in _touched(r, shapes[r.id])]
                    if not touching and stage_owner != b_id:
                        continue
                    reach = _max_automation(graph, u)
                    for r in b_items:
                        reach = min([reach] + [hi for t2, ax2, hi in shapes[r.id][1] if t2 == u and ax2 == "automation"])
                    if reach + downstream + extra < level:
                        add(_make("chain", a.stakeholder_id, b_id, t, [a.id], touching or [r.id for r in b_items], via=u))

    return sorted(found.values(), key=lambda r: (_KIND_ORDER[r.kind], r.a, r.b, r.target, r.via or ""))


def eligible(rel: Relation, held_item_ids: Collection[str]) -> bool:
    """D1: the player holds a verified item on each side. Pass the ids of their verified items."""
    held = set(held_item_ids)
    return bool(held & set(rel.a_item_ids)) and bool(held & set(rel.b_item_ids))
