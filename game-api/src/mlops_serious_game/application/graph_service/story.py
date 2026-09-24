"""Deterministic story lines for graph targets. Lookup only, never generated at runtime.

The most specific fully matching fragment wins, see domain/story_factory.py for the format.
Fragments are keyed by the 0-4 `narrative_tier` (docs/plans/graph-governance-automation-rework/
00-plan.md) - a display-only combination of the two real axes, never used for gameplay logic.
"""

from typing import Optional, Union

from mlops_serious_game.domain.graph import GraphState, TechnicalGraph, narrative_tier
from mlops_serious_game.domain.story_factory import StoryFactory


def story_for(
    graph: TechnicalGraph, state: GraphState, target: str, at: Optional[Union[int, tuple[int, int]]] = None
) -> str:
    """Story line for `target` (defaults to its nominal automation/governance) in the given
    state. `at` is either a pre-computed narrative tier (0-4) or an (automation, governance) pair."""
    if at is None:
        tier = state.narrative(target)
    elif isinstance(at, tuple):
        tier = narrative_tier(*at)
    else:
        tier = at
    if graph.is_component(target):
        facts = dict(state.attrs.get(target, {}))
    else:
        facts = {"trigger": state.edge_triggers.get(target, "none")}

    best: Optional[tuple[int, str]] = None
    for lv, conditions, text in StoryFactory.targets.get(target, []):
        if lv == tier and all(facts.get(k) == v for k, v in conditions.items()):
            if best is None or len(conditions) > best[0]:
                best = (len(conditions), text)
    if best:
        return best[1]

    if graph.is_component(target):
        return StoryFactory.generic["component"][tier].format(name=graph.component(target).name)
    edge = graph.edge(target)
    return StoryFactory.generic["edge"][tier].format(
        source=graph.component(edge.from_id).name,
        target=graph.component(edge.to_id).name,
        trigger=facts["trigger"].replace("_", " "),
    )


def missing_specific_fragments(graph: TechnicalGraph) -> list[tuple[str, int]]:
    """Reachable (target, narrative-tier) pairs that only have the generic template. Content gate
    input."""
    missing = []
    for c in graph.components:
        tiers = {narrative_tier(a, g) for a in c.allowed_automation for g in c.allowed_governance}
        missing += [(c.id, tier) for tier in tiers if not StoryFactory.has_specific(c.id, tier)]
    for e in graph.edges:
        tiers = {narrative_tier(a, g) for a in e.allowed_automation for g in e.allowed_governance}
        missing += [(e.id, tier) for tier in tiers if not StoryFactory.has_specific(e.id, tier)]
    return missing
