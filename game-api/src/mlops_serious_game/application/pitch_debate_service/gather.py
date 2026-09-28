"""Gather: engagement cards buy conversations, not batches (Section 3, plan 01-intel-and-pitch-redesign).

A stakeholder card buys a fixed number of **turns** per target. Each turn the player picks one
option; turns not used are lost when the conversation closes. Pure over its inputs: the caller
resolves ground truth, held items, graph components and room pools before calling in, and performs the
actual writes (storing revealed items) from what these functions decide. Same inputs, same options,
in the same order - deterministic stable ordering everywhere, no random.sample.
"""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from mlops_serious_game.application.graph_service.scheduler import stable_rank
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.requirement import IntelTag, item_target, truncate_detail

GatherOptionKind = Literal[
    "component_query",
    "priority_query",
    "generic_query",
]


class GatherOptionSpec(BaseModel):
    """One choice on a turn's menu."""

    option: GatherOptionKind
    available: bool
    prompt: str
    label: str
    component_id: Optional[str] = None
    reason: Optional[str] = None


class GatherConversation(BaseModel):
    """One open engagement-card conversation with one stakeholder or whole room.

    Persisted per (player, phase, challenge, card play, stakeholder) by the handler/store; this
    model only carries what a turn needs to be resolved and what the next menu needs to be built.
    """

    conversation_id: str = ""
    card_id: str
    stakeholder_id: str
    turns_left: int
    turns_used: int = 0
    discovered_item_ids: list[str] = Field(default_factory=list)
    asked_options: list[str] = Field(default_factory=list)
    closed: bool = False

    @property
    def is_open(self) -> bool:
        return not self.closed and self.turns_left > 0


class TurnOutcome(BaseModel):
    """What one resolved turn decided."""

    conversation: GatherConversation
    option: Literal[GatherOptionKind, "close"]
    result: Literal[
        "revealed",
        "nothing_left",
        "rejected",
        "closed",
    ]
    item_id: Optional[str] = None
    item_ids: list[str] = Field(default_factory=list)
    emotion_delta: float = 0.0
    rejected: Optional[str] = None
    events: list[GameEvent] = Field(default_factory=list)


def _stable_order(seed: str, items: list) -> list:
    """Deterministic order: same seed, same items, same order every time (no random.sample)."""
    return sorted(items, key=lambda i: stable_rank(seed, i.id))


def _tag_value(tag: Any) -> str:
    return str(getattr(tag, "value", tag)).lower()


def _by_tag(items: list, allowed_types: list[str]) -> list:
    if not allowed_types:
        return list(items)
    allowed_set = {t.lower() for t in allowed_types}
    return [i for i in items if _tag_value(getattr(i, "type", "")) in allowed_set]


def undiscovered_pool(pool: list, known_ids: set[str], allowed_types: list[str]) -> list:
    """Ground-truth items for this stakeholder the player has not yet found, tag-filtered."""
    return _by_tag([r for r in pool if r.id not in known_ids], allowed_types)


STAKEHOLDER_DOMAIN_COMPONENTS: dict[str, list[str]] = {
    "data_dave": ["data.validation", "data.ingestion", "data.feature_store", "data.versioning"],
    "dave": ["data.validation", "data.ingestion", "data.feature_store", "data.versioning"],
    "model_monica": ["model.training_pipeline", "model.registry", "model.experiment_tracking", "model.evaluation"],
    "monica": ["model.training_pipeline", "model.registry", "model.experiment_tracking", "model.evaluation"],
    "requirements_reuben": ["req.acceptance_criteria", "req.kpi_definition", "req.data_contracts", "req.risk_assessment"],
    "reuben": ["req.acceptance_criteria", "req.kpi_definition", "req.data_contracts", "req.risk_assessment"],
    "automation_alex": ["deploy.cicd", "deploy.serving", "deploy.orchestration", "deploy.containerization"],
    "alex": ["deploy.cicd", "deploy.serving", "deploy.orchestration", "deploy.containerization"],
    "reliability_ruth": ["ops.performance_monitoring", "ops.observability", "ops.alerting", "ops.rollback"],
    "ruth": ["ops.performance_monitoring", "ops.observability", "ops.alerting", "ops.rollback"],
}


def component_for_item(item: Any, graph: Optional[Any] = None) -> Optional[str]:
    """Extracts target component ID from a requirement item."""
    target = getattr(item, "target", None) or item_target(item)
    if target:
        if graph is not None:
            if hasattr(graph, "is_component") and graph.is_component(target):
                return target
            if hasattr(graph, "is_edge") and graph.is_edge(target):
                edge = graph.edge(target)
                return edge.to_id or edge.from_id
        elif target.startswith("e."):
            try:
                from mlops_serious_game.domain.graph_factory import GraphFactory
                g = GraphFactory.get_graph()
                if g and g.is_edge(target):
                    edge = g.edge(target)
                    return edge.to_id or edge.from_id
            except Exception:
                pass
        return target

    # Deterministic fallback by stakeholder domain when target is not explicitly annotated
    st_id = getattr(item, "stakeholder_id", None)
    if st_id:
        candidates = STAKEHOLDER_DOMAIN_COMPONENTS.get(st_id, [])
        if candidates:
            item_id = str(getattr(item, "id", "item"))
            m = re.search(r"_(\d+)$", item_id)
            if m:
                idx = int(m.group(1))
                return candidates[idx % len(candidates)]
            return sorted(candidates, key=lambda cid: stable_rank(f"{st_id}|{item_id}|comp", cid))[0]

    return None


def component_display_name(component_id: str, graph: Optional[Any] = None) -> str:
    """Friendly human-readable display name for a component ID."""
    if graph is not None and hasattr(graph, "is_component") and graph.is_component(component_id):
        comp = graph.component(component_id)
        if getattr(comp, "name", None):
            return comp.name
    clean = component_id
    for prefix in ("req.", "data.", "model.", "infra.", "e."):
        if clean.startswith(prefix):
            clean = clean[len(prefix):]
    return clean.replace("_", " ").title()


def format_component_prompt(component_id: str, graph: Optional[Any] = None, variant_index: int = 0) -> str:
    """Generates natural dialogue prompt for a component."""
    name = component_display_name(component_id, graph)
    templates = [
        "What is your view on {name}?",
        "How should we handle {name}?",
        "What are your requirements for {name}?",
        "How does {name} fit into your priorities?",
    ]
    return templates[variant_index % len(templates)].format(name=name)


def top_referenced_components(
    items: list,
    max_count: int = 4,
    seed: str = "default",
    graph: Optional[Any] = None,
) -> list[str]:
    """Inspects items, extracts target components, and ranks the top referenced components.

    Deterministically broken by stable_rank if counts are equal.
    """
    counts: dict[str, int] = {}
    for item in items:
        cid = component_for_item(item, graph)
        if cid:
            counts[cid] = counts.get(cid, 0) + 1

    if not counts:
        return []

    sorted_comps = sorted(
        counts.keys(),
        key=lambda cid: (-counts[cid], stable_rank(f"{seed}|comp_rank", cid)),
    )
    return sorted_comps[:max_count]


def get_allowed_stages_for_phase(phase_id: int, graph: Optional[Any] = None) -> set[str]:
    """Returns the set of allowed stage IDs: just the current phase's stage."""
    phase_map = {0: "req", 1: "req", 2: "data", 3: "model", 4: "deploy", 5: "ops"}
    stage_id = phase_map.get(phase_id, "req")
    if graph is not None and hasattr(graph, "stages"):
        for s in graph.stages:
            if getattr(s, "phase_id", None) == phase_id:
                stage_id = s.id
                break
    return {stage_id}


def is_component_in_allowed_stages(cid: str, allowed_stages: set[str], graph: Optional[Any] = None) -> bool:
    """Checks whether a component ID belongs to one of the allowed stages."""
    if not cid:
        return False
    if graph is not None and hasattr(graph, "is_component") and graph.is_component(cid):
        comp = graph.component(cid)
        return getattr(comp, "stage_id", "") in allowed_stages
    prefix = cid.split(".")[0] if "." in cid else cid
    return prefix in allowed_stages


def select_single_stakeholder_components(
    pool: list,
    known_ids: set[str],
    max_count: int,
    seed: str,
    stakeholder_id: str,
    room_pools: Optional[dict[str, list]] = None,
    graph: Optional[Any] = None,
    allowed_types: Optional[list[str]] = None,
    phase_id: int = 1,
    excluded_cids: Optional[set[str]] = None,
    asked_options: Optional[list[str]] = None,
) -> list[str]:
    """Selects dialogue components for a single stakeholder conversation.

    Always provides up to max_count (default 4) options on different components.
    Prioritizes:
    1. Undiscovered components for this stakeholder (each yields an intel item)
    2. Discovered components for this stakeholder (for follow-up / verification)
    3. Components from other stakeholders in the round (in allowed_stages)
    4. Domain components of this stakeholder
    5. Graph components matching allowed phase stages
    6. Fallback across all domain and graph components
    """
    allowed_stages = get_allowed_stages_for_phase(phase_id, graph)
    excluded = excluded_cids or set()
    asked = asked_options or list(excluded)

    allowed_set = {t.lower() for t in allowed_types} if allowed_types else None
    st_items = [
        r for r in pool
        if not allowed_set or _tag_value(getattr(r, "type", "")) in allowed_set
    ]

    asked_counts: dict[str, int] = {}
    for opt in asked:
        asked_counts[opt] = asked_counts.get(opt, 0) + 1

    comp_req_counts: dict[str, int] = {}
    for r in st_items:
        if (cid := component_for_item(r, graph)) is not None:
            comp_req_counts[cid] = comp_req_counts.get(cid, 0) + 1

    undiscovered = [r for r in st_items if r.id not in known_ids]
    discovered = [r for r in st_items if r.id in known_ids]

    undiscovered_cids = {
        cid for r in undiscovered
        if (cid := component_for_item(r, graph)) is not None
        and asked_counts.get(cid, 0) < comp_req_counts.get(cid, 0)
    }
    discovered_cids = {
        cid for r in discovered
        if (cid := component_for_item(r, graph)) is not None
        and cid not in excluded
        and cid not in undiscovered_cids
    }

    chosen: list[str] = []

    # 1. Undiscovered components for this stakeholder
    ordered_undisc = sorted(undiscovered_cids, key=lambda cid: stable_rank(seed, cid))
    for cid in ordered_undisc:
        if cid not in chosen and cid not in excluded:
            chosen.append(cid)
            if len(chosen) >= max_count:
                return chosen[:max_count]

    # 2. Discovered components for this stakeholder
    ordered_disc = sorted(
        [cid for cid in discovered_cids if cid not in chosen],
        key=lambda cid: stable_rank(seed, cid),
    )
    for cid in ordered_disc:
        if cid not in chosen and cid not in excluded:
            chosen.append(cid)
            if len(chosen) >= max_count:
                return chosen[:max_count]

    # 3. If still less than max_count, pad from stakeholder domain components
    if len(chosen) < max_count:
        domain_comps = [
            c for c in STAKEHOLDER_DOMAIN_COMPONENTS.get(stakeholder_id, [])
            if c not in chosen and c not in excluded
        ]
        ordered_domain = sorted(domain_comps, key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_domain:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 4. If less than max_count, add components from other stakeholders in room
    if len(chosen) < max_count and room_pools:
        other_items = [
            item
            for st_id, st_pool in sorted(room_pools.items())
            if st_id != stakeholder_id
            for item in st_pool
            if not allowed_set or _tag_value(getattr(item, "type", "")) in allowed_set
        ]
        other_cids = {
            cid for item in other_items
            if (cid := component_for_item(item, graph)) is not None
            and cid not in chosen
            and cid not in excluded
        }
        ordered_other = sorted(other_cids, key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_other:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 5. If still less than max_count, pad from graph components belonging to allowed_stages
    if len(chosen) < max_count and graph is not None and hasattr(graph, "components"):
        graph_cids = [
            c.id for c in graph.components
            if c.id not in chosen
            and c.id not in excluded
            and getattr(c, "stage_id", "") in allowed_stages
        ]
        ordered_graph = sorted(graph_cids, key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_graph:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 6. Fallback across all domain components
    if len(chosen) < max_count:
        all_domain = [
            c for comps in STAKEHOLDER_DOMAIN_COMPONENTS.values() for c in comps
            if c not in chosen and c not in excluded
        ]
        ordered_all = sorted(set(all_domain), key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_all:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 7. Fallback to all graph components if still less than max_count
    if len(chosen) < max_count and graph is not None and hasattr(graph, "components"):
        all_graph_cids = [c.id for c in graph.components if c.id not in chosen and c.id not in excluded]
        for cid in sorted(all_graph_cids, key=lambda cid: stable_rank(seed, cid)):
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    return chosen[:max_count]


def select_team_sync_components(
    room_pools: Optional[dict[str, list]],
    pool: list,
    seed: str,
    graph: Optional[Any] = None,
    allowed_types: Optional[list[str]] = None,
    phase_id: int = 1,
    excluded_cids: Optional[set[str]] = None,
    known_ids: Optional[set[str]] = None,
    asked_options: Optional[list[str]] = None,
    max_count: int = 4,
) -> list[str]:
    """Selects dialogue components for Team Sync-Up (eng_3).

    Always provides up to max_count (default 4) options on different components.
    Prioritizes:
    1. Undiscovered components across all stakeholders in the room (ranked by undiscovered count)
       If there are 4+ components with undiscovered intel, all 4 options lead to intel discovery!
    2. Discovered components across the room (for follow-up / verification)
    3. Other challenge components from pool (in allowed_stages)
    4. Domain components of room stakeholders
    5. Graph components in allowed stages
    6. All domain and graph components
    """
    allowed_stages = get_allowed_stages_for_phase(phase_id, graph)
    excluded = excluded_cids or set()
    asked = asked_options or list(excluded)
    known = known_ids or set()

    if room_pools:
        all_items = [r for p in room_pools.values() for r in p]
    else:
        all_items = list(pool)

    allowed_set = {t.lower() for t in allowed_types} if allowed_types else None
    if allowed_set:
        all_items = [r for r in all_items if _tag_value(getattr(r, "type", "")) in allowed_set]

    asked_counts: dict[str, int] = {}
    for opt in asked:
        asked_counts[opt] = asked_counts.get(opt, 0) + 1

    comp_req_counts: dict[str, int] = {}
    for r in all_items:
        if (cid := component_for_item(r, graph)) is not None:
            comp_req_counts[cid] = comp_req_counts.get(cid, 0) + 1

    undiscovered = [r for r in all_items if r.id not in known]
    discovered = [r for r in all_items if r.id in known]

    undiscovered_counts: dict[str, int] = {}
    for r in undiscovered:
        if (cid := component_for_item(r, graph)) is not None:
            undiscovered_counts[cid] = undiscovered_counts.get(cid, 0) + 1

    undiscovered_cids = {
        cid for cid, cnt in undiscovered_counts.items()
        if asked_counts.get(cid, 0) < comp_req_counts.get(cid, 0)
    }

    discovered_cids = {
        cid for r in discovered
        if (cid := component_for_item(r, graph)) is not None
        and cid not in excluded
        and cid not in undiscovered_cids
    }

    chosen: list[str] = []

    # 1. Undiscovered components across the room (ranked by undiscovered count desc, then stable_rank)
    ordered_undisc = sorted(
        undiscovered_cids,
        key=lambda cid: (-undiscovered_counts.get(cid, 0), stable_rank(seed, cid)),
    )
    for cid in ordered_undisc:
        if cid not in chosen and cid not in excluded:
            chosen.append(cid)
            if len(chosen) >= max_count:
                return chosen[:max_count]

    # 2. Discovered components across the room (for follow-up / verification)
    ordered_disc = sorted(
        [cid for cid in discovered_cids if cid not in chosen],
        key=lambda cid: stable_rank(seed, cid),
    )
    for cid in ordered_disc:
        if cid not in chosen and cid not in excluded:
            chosen.append(cid)
            if len(chosen) >= max_count:
                return chosen[:max_count]

    # 3. Remaining challenge components from pool (in allowed_stages)
    if len(chosen) < max_count and pool:
        chal_items = [r for r in pool if not allowed_set or _tag_value(getattr(r, "type", "")) in allowed_set]
        chal_cids = {
            cid for item in chal_items
            if (cid := component_for_item(item, graph)) is not None
            and cid not in chosen
            and cid not in excluded
        }
        ordered_chal = sorted(chal_cids, key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_chal:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 4. Domain components of room stakeholders
    if len(chosen) < max_count and room_pools:
        room_domain = [
            c for st_id in sorted(room_pools.keys())
            for c in STAKEHOLDER_DOMAIN_COMPONENTS.get(st_id, [])
            if c not in chosen and c not in excluded
        ]
        ordered_room_domain = sorted(set(room_domain), key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_room_domain:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 5. Graph components in allowed stages
    if len(chosen) < max_count and graph is not None and hasattr(graph, "components"):
        graph_cids = [
            c.id for c in graph.components
            if c.id not in chosen
            and c.id not in excluded
            and getattr(c, "stage_id", "") in allowed_stages
        ]
        ordered_graph = sorted(graph_cids, key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_graph:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    # 6. Fallback across all domain components
    if len(chosen) < max_count:
        all_domain = [
            c for comps in STAKEHOLDER_DOMAIN_COMPONENTS.values() for c in comps
            if c not in chosen and c not in excluded
        ]
        ordered_all = sorted(set(all_domain), key=lambda cid: stable_rank(seed, cid))
        for cid in ordered_all:
            if cid not in chosen:
                chosen.append(cid)
                if len(chosen) >= max_count:
                    return chosen[:max_count]

    return chosen[:max_count]


def _make_component_specs(
    component_ids: list[str],
    is_open: bool,
    graph: Optional[Any] = None,
) -> list[GatherOptionSpec]:
    if not component_ids:
        return [
            GatherOptionSpec(
                option="component_query",
                available=is_open,
                prompt="What are your technical requirements?",
                label="Technical Requirements",
                reason=None if is_open else "No turns left in this conversation",
            )
        ]
    return [
        GatherOptionSpec(
            option="component_query",
            available=is_open,
            prompt=format_component_prompt(cid, graph, idx),
            label=component_display_name(cid, graph),
            component_id=cid,
            reason=None if is_open else "No turns left in this conversation",
        )
        for idx, cid in enumerate(component_ids)
    ]


def get_component_options(
    undiscovered_items: list,
    max_count: int,
    seed: str,
    graph: Optional[Any] = None,
    stakeholder_id: Optional[str] = None,
    phase_id: int = 1,
    excluded_cids: Optional[set[str]] = None,
) -> list[GatherOptionSpec]:
    """Generates GatherOptionSpec choices for the top referenced components."""
    cids = select_single_stakeholder_components(
        pool=undiscovered_items,
        known_ids=set(),
        max_count=max_count,
        seed=seed,
        stakeholder_id=stakeholder_id or "",
        graph=graph,
        phase_id=phase_id,
        excluded_cids=excluded_cids,
    )
    return _make_component_specs(cids, is_open=True, graph=graph)


def gather_options_for(
    conversation: GatherConversation,
    held: list,
    pool: list,
    allowed_types: list[str],
    seed: str,
    room_pools: Optional[dict[str, list]] = None,
    graph: Optional[Any] = None,
    known_ids: Optional[set[str]] = None,
    phase_id: int = 1,
) -> list[GatherOptionSpec]:
    """The turn menu for one target or room, given the conversation so far.

    Generates 4 options scoped to the current phase stage and 'gov'.
    Options that were already clicked in this conversation are not re-shown.
    """
    if known_ids is None:
        known_ids = {i.id for i in held} | set(conversation.discovered_item_ids)

    excluded_cids = set(conversation.asked_options)
    turn_seed = f"{seed}|turn_{conversation.turns_used}"

    if conversation.card_id == "eng_3":
        # Team Sync-Up: Whole room, top 4 affected components across all stakeholders in room
        cids = select_team_sync_components(
            room_pools=room_pools,
            pool=pool,
            seed=turn_seed,
            graph=graph,
            allowed_types=allowed_types,
            phase_id=phase_id,
            excluded_cids=excluded_cids,
            known_ids=known_ids,
            asked_options=conversation.asked_options,
        )
        opts = _make_component_specs(cids, conversation.is_open, graph)

    elif conversation.card_id == "eng_1":
        # 1-to-1 Meeting: 1 stakeholder, option to ask for most important requirement (max once per convo) + component options
        has_asked_priority = "priority_query" in conversation.asked_options
        priority_opt = GatherOptionSpec(
            option="priority_query",
            available=conversation.is_open and not has_asked_priority,
            prompt="What is your most important requirement?",
            label="Most Important Requirement",
            reason=(
                None
                if (conversation.is_open and not has_asked_priority)
                else (
                    "You have already asked for the most important requirement in this conversation"
                    if has_asked_priority
                    else "No turns left in this conversation"
                )
            ),
        )
        cids = select_single_stakeholder_components(
            pool=pool,
            known_ids=known_ids,
            max_count=3,
            seed=turn_seed,
            stakeholder_id=conversation.stakeholder_id,
            room_pools=room_pools,
            graph=graph,
            allowed_types=allowed_types,
            phase_id=phase_id,
            excluded_cids=excluded_cids,
            asked_options=conversation.asked_options,
        )
        opts = [priority_opt] + _make_component_specs(cids, conversation.is_open, graph)

    elif conversation.card_id == "eng_2":
        # Probe Requirements: 1 stakeholder, 4 component options
        cids = select_single_stakeholder_components(
            pool=pool,
            known_ids=known_ids,
            max_count=4,
            seed=turn_seed,
            stakeholder_id=conversation.stakeholder_id,
            room_pools=room_pools,
            graph=graph,
            allowed_types=allowed_types,
            phase_id=phase_id,
            excluded_cids=excluded_cids,
            asked_options=conversation.asked_options,
        )
        opts = _make_component_specs(cids, conversation.is_open, graph)

    elif conversation.card_id == "eng_4":
        # Ask Generic Question: 1 stakeholder, open-ended question
        opts = [
            GatherOptionSpec(
                option="generic_query",
                available=conversation.is_open,
                prompt="Can you tell me about your general perspective or any requirements on your radar?",
                label="Ask Generic Question",
                reason=None if conversation.is_open else "No turns left in this conversation",
            )
        ]

    else:
        # Generic fallback
        cids = select_single_stakeholder_components(
            pool=pool,
            known_ids=known_ids,
            max_count=4,
            seed=turn_seed,
            stakeholder_id=conversation.stakeholder_id,
            room_pools=room_pools,
            graph=graph,
            allowed_types=allowed_types,
            phase_id=phase_id,
            excluded_cids=excluded_cids,
            asked_options=conversation.asked_options,
        )
        opts = _make_component_specs(cids, conversation.is_open, graph)

    if not conversation.is_open:
        return [
            opt.model_copy(update={"available": False, "reason": "No turns left in this conversation"})
            for opt in opts
        ]

    return opts


def _spend_turn(conversation: GatherConversation, asked_option: Optional[str] = None) -> GatherConversation:
    asked = list(conversation.asked_options)
    if asked_option and asked_option not in asked:
        asked.append(asked_option)
    return conversation.model_copy(update={
        "turns_left": conversation.turns_left - 1,
        "turns_used": conversation.turns_used + 1,
        "asked_options": asked,
    })


def _reject(conversation: GatherConversation, option: GatherOptionKind, reason: str) -> TurnOutcome:
    return TurnOutcome(conversation=conversation, option=option, result="rejected", rejected=reason)


def resolve_component_query(
    conversation: GatherConversation,
    pool: list,
    known_ids: set[str],
    component_id: str,
    seed: str,
    stakeholder_name: str,
    graph: Optional[Any] = None,
) -> TurnOutcome:
    """Reveals all undiscovered items related to the selected component in stable order."""
    if not conversation.is_open:
        return _reject(conversation, "component_query", "no turns left in this conversation")

    undiscovered = [
        r for r in pool
        if r.id not in known_ids and component_for_item(r, graph) == component_id
    ]
    if not undiscovered:
        return TurnOutcome(conversation=_spend_turn(conversation, asked_option=component_id), option="component_query", result="nothing_left")

    ordered = _stable_order(f"{seed}|comp|{component_id}", undiscovered)
    revealed_ids = [item.id for item in ordered]
    updated = _spend_turn(conversation, asked_option=component_id).model_copy(
        update={"discovered_item_ids": conversation.discovered_item_ids + revealed_ids}
    )
    events = [
        GameEvent(
            step="gather",
            kind="intel",
            subject_id=conversation.stakeholder_id,
            direction="up",
            magnitude="clear",
            cause="intel.revealed",
            params={
                "st": stakeholder_name,
                "component": component_display_name(component_id, graph),
                "detail": truncate_detail(getattr(item, "description", None) or getattr(item, "gist", None)),
            },
            refs={"item_id": item.id},
        )
        for item in ordered
    ]
    return TurnOutcome(
        conversation=updated,
        option="component_query",
        result="revealed",
        item_id=revealed_ids[0],
        item_ids=revealed_ids,
        events=events,
    )


def resolve_team_sync_up(
    conversation: GatherConversation,
    room_pools: dict[str, list],
    known_ids: set[str],
    component_id: str,
    seed: str,
    names_by_stakeholder: dict[str, str],
    graph: Optional[Any] = None,
) -> TurnOutcome:
    """Each stakeholder in the room reveals all undiscovered intel items related to the selected component."""
    if not conversation.is_open:
        return _reject(conversation, "component_query", "no turns left in this conversation")

    revealed_ids: list[str] = []
    events: list[GameEvent] = []
    current_known = set(known_ids) | set(conversation.discovered_item_ids)

    # Deterministic order over stakeholders
    for st_id in sorted(room_pools.keys()):
        st_pool = room_pools[st_id]
        st_name = names_by_stakeholder.get(st_id, st_id)
        matching = [
            r for r in st_pool
            if r.id not in current_known and component_for_item(r, graph) == component_id
        ]
        if matching:
            ordered = _stable_order(f"{seed}|sync|{st_id}|{component_id}", matching)
            for item in ordered:
                revealed_ids.append(item.id)
                current_known.add(item.id)
                events.append(GameEvent(
                    step="gather",
                    kind="intel",
                    subject_id=st_id,
                    direction="up",
                    magnitude="clear",
                    cause="intel.revealed",
                    params={
                        "st": st_name,
                        "component": component_display_name(component_id, graph),
                        "detail": truncate_detail(getattr(item, "description", None) or getattr(item, "gist", None)),
                    },
                    refs={"item_id": item.id},
                ))

    if not revealed_ids:
        return TurnOutcome(conversation=_spend_turn(conversation, asked_option=component_id), option="component_query", result="nothing_left")

    updated = _spend_turn(conversation, asked_option=component_id).model_copy(
        update={"discovered_item_ids": conversation.discovered_item_ids + revealed_ids}
    )
    return TurnOutcome(
        conversation=updated,
        option="component_query",
        result="revealed",
        item_id=revealed_ids[0],
        item_ids=revealed_ids,
        events=events,
    )


def resolve_priority_query(
    conversation: GatherConversation,
    pool: list,
    known_ids: set[str],
    seed: str,
    stakeholder_name: str,
    graph: Optional[Any] = None,
) -> TurnOutcome:
    """Reveals the stakeholder's highest priority undiscovered item (Boundary > Driver > Trade-Off > Fact)."""
    if not conversation.is_open:
        return _reject(conversation, "priority_query", "no turns left in this conversation")

    if "priority_query" in conversation.asked_options:
        return _reject(conversation, "priority_query", "You have already asked for their most important requirement in this conversation.")

    undiscovered = [r for r in pool if r.id not in known_ids]
    if not undiscovered:
        return TurnOutcome(conversation=_spend_turn(conversation, asked_option="priority_query"), option="priority_query", result="nothing_left")

    tag_priority = {
        IntelTag.BOUNDARY: 0,
        "boundary": 0,
        IntelTag.DRIVER: 1,
        "driver": 1,
        IntelTag.TRADE_OFF: 2,
        "trade_off": 2,
        IntelTag.FACT: 3,
        "fact": 3,
    }

    sorted_items = sorted(
        undiscovered,
        key=lambda i: (
            tag_priority.get(getattr(i, "type", None), 9),
            stable_rank(f"{seed}|priority", i.id),
        ),
    )
    item = sorted_items[0]
    updated = _spend_turn(conversation, asked_option="priority_query").model_copy(
        update={"discovered_item_ids": conversation.discovered_item_ids + [item.id]}
    )
    item_component_id = component_for_item(item, graph)
    event = GameEvent(
        step="gather",
        kind="intel",
        subject_id=conversation.stakeholder_id,
        direction="up",
        magnitude="clear",
        cause="intel.revealed",
        params={
            "st": stakeholder_name,
            "component": component_display_name(item_component_id, graph) if item_component_id else "the system",
            "detail": truncate_detail(getattr(item, "description", None) or getattr(item, "gist", None)),
        },
        refs={"item_id": item.id},
    )
    return TurnOutcome(
        conversation=updated,
        option="priority_query",
        result="revealed",
        item_id=item.id,
        item_ids=[item.id],
        events=[event],
    )


def resolve_generic_query(
    conversation: GatherConversation,
    pool: list,
    known_ids: set[str],
    seed: str,
    stakeholder_name: str,
    graph: Optional[Any] = None,
) -> TurnOutcome:
    """Reveals 1 random undiscovered item in stable order."""
    if not conversation.is_open:
        return _reject(conversation, "generic_query", "no turns left in this conversation")

    undiscovered = [r for r in pool if r.id not in known_ids]
    if not undiscovered:
        return TurnOutcome(conversation=_spend_turn(conversation, asked_option="generic_query"), option="generic_query", result="nothing_left")

    ordered = _stable_order(f"{seed}|generic", undiscovered)
    item = ordered[0]
    updated = _spend_turn(conversation, asked_option="generic_query").model_copy(
        update={"discovered_item_ids": conversation.discovered_item_ids + [item.id]}
    )
    item_component_id = component_for_item(item, graph)
    event = GameEvent(
        step="gather",
        kind="intel",
        subject_id=conversation.stakeholder_id,
        direction="up",
        magnitude="clear",
        cause="intel.revealed",
        params={
            "st": stakeholder_name,
            "component": component_display_name(item_component_id, graph) if item_component_id else "the system",
            "detail": truncate_detail(getattr(item, "description", None) or getattr(item, "gist", None)),
        },
        refs={"item_id": item.id},
    )
    return TurnOutcome(
        conversation=updated,
        option="generic_query",
        result="revealed",
        item_id=item.id,
        item_ids=[item.id],
        events=[event],
    )


def close_conversation(conversation: GatherConversation, stakeholder_name: str) -> TurnOutcome:
    """Ends the conversation; unused turns are lost."""
    updated = conversation.model_copy(update={"closed": True})
    events = []
    if updated.turns_left > 0:
        events.append(GameEvent(
            step="gather", kind="card", subject_id=conversation.stakeholder_id,
            cause="card.turn_lost", params={"st": stakeholder_name, "n": str(updated.turns_left)},
        ))
    return TurnOutcome(conversation=updated, option="close", result="closed", events=events)
