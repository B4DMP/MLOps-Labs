"""Deterministic story lines for graph targets. Lookup only, never generated at runtime.

The most specific fully matching fragment wins, see domain/story_factory.py for the format.
"""

from typing import Optional

from mlops_serious_game.domain.graph import GraphState, TechnicalGraph
from mlops_serious_game.domain.story_factory import StoryFactory


def story_for(graph: TechnicalGraph, state: GraphState, target: str, level: Optional[int] = None) -> str:
    """Story line for `target` at `level` (defaults to its nominal level) in the given state."""
    level = state.level(target) if level is None else level
    if graph.is_component(target):
        facts = dict(state.attrs.get(target, {}))
    else:
        facts = {"trigger": state.edge_triggers.get(target, "none")}

    best: Optional[tuple[int, str]] = None
    for lv, conditions, text in StoryFactory.targets.get(target, []):
        if lv == level and all(facts.get(k) == v for k, v in conditions.items()):
            if best is None or len(conditions) > best[0]:
                best = (len(conditions), text)
    if best:
        return best[1]

    if graph.is_component(target):
        return StoryFactory.generic["component"][level].format(name=graph.component(target).name)
    edge = graph.edge(target)
    return StoryFactory.generic["edge"][level].format(
        source=graph.component(edge.from_id).name,
        target=graph.component(edge.to_id).name,
        trigger=facts["trigger"].replace("_", " "),
    )


def missing_specific_fragments(graph: TechnicalGraph) -> list[tuple[str, int]]:
    """Reachable (target, level) pairs that only have the generic template. Content gate input."""
    missing = []
    for c in graph.components:
        missing += [(c.id, lv) for lv in c.allowed_levels if not StoryFactory.has_specific(c.id, lv)]
    for e in graph.edges:
        missing += [(e.id, lv) for lv in e.allowed_levels if not StoryFactory.has_specific(e.id, lv)]
    return missing
