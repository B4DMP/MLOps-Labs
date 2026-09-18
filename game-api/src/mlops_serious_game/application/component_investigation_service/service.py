from typing import Any, Optional
from fastapi import WebSocket
from loguru import logger
from pydantic import BaseModel, Field

from mlops_serious_game.application.component_investigation_service.chains import (
    generate_component_fact,
    generate_investigation_player_utterance,
    generate_investigation_stakeholder_response,
)
from mlops_serious_game.application.intel_handler import store_intel_item
from mlops_serious_game.application.pitch_debate_service import gather
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.graph import TechnicalGraph
from mlops_serious_game.domain.requirement import (
    ConfidenceType,
    FactAssertion,
    IntelSource,
    IntelTag,
    StakeholderIntelItem,
)
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.infrastructure.websocket.manager import manager


STAGE_TO_DEFAULT_OWNER: dict[str, str] = {
    "req": "requirements_reuben",
    "data": "data_dave",
    "model": "model_monica",
    "deploy": "automation_alex",
    "ops": "reliability_ruth",
    "gov": "efficiency_emilia",
    "infra": "efficiency_emilia",
}


def resolve_component_owner(component_id: str, graph: Optional[TechnicalGraph] = None) -> str:
    """Resolves the stakeholder ID who owns the specified MLOps component.

    Inspects the technical graph component owner, stage owner, and domain mappings.
    """
    if graph is not None:
        try:
            if hasattr(graph, "is_component") and graph.is_component(component_id):
                owner = graph.owner_of(component_id)
                if owner:
                    return owner
                comp = graph.component(component_id)
                if getattr(comp, "stage_id", "") == "gov":
                    return "efficiency_emilia"
        except Exception as e:
            logger.debug(f"[component_investigation_service] Error resolving owner from graph: {e}")

    # Fallback to stage prefix mapping
    prefix = component_id.split(".")[0] if "." in component_id else component_id
    return STAGE_TO_DEFAULT_OWNER.get(prefix, "requirements_reuben")


async def resolve_or_generate_component_intel(
    challenge: Any,
    component_id: str,
    stakeholder_id: str,
    known_ids: set[str],
    graph: Optional[TechnicalGraph] = None,
) -> StakeholderIntelItem:
    """Finds an existing requirement for this component or dynamically generates a Verified Fact."""
    comp_name = gather.component_display_name(component_id, graph)

    # 1. Check for pre-authored requirements assigned to this stakeholder for this component
    stakeholder_pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(
        challenge.id, stakeholder_id
    )
    matching = [
        r
        for r in stakeholder_pool
        if r.id not in known_ids and gather.component_for_item(r, graph) == component_id
    ]

    # 2. If not found, check all challenge requirements for this component
    if not matching:
        challenge_pool = RequirementFactory.get_requirements_for_challenge(challenge.id)
        matching = [
            r
            for r in challenge_pool
            if r.id not in known_ids and gather.component_for_item(r, graph) == component_id
        ]

    # 3. If matching requirement exists, use it
    if matching:
        ordered = gather._stable_order(
            f"{challenge.id}|investigate|{stakeholder_id}|{component_id}", matching
        )
        req = ordered[0]
        return StakeholderIntelItem.from_requirement(
            req,
            intel_type=ConfidenceType.VERIFIED,
            categorized_type=req.type,
            description=req.description,
            source=IntelSource.INTERVIEW,
        )

    # 4. Generate on-the-fly Fact intel item
    comp_obj = None
    if graph is not None and hasattr(graph, "is_component") and graph.is_component(component_id):
        comp_obj = graph.component(component_id)
    comp_group = getattr(comp_obj, "stage_id", "") if comp_obj else ""

    challenge_context = f"{challenge.name}: {challenge.description}"
    fact_text = await generate_component_fact(
        challenge=challenge_context,
        component_id=component_id,
        component_name=comp_name,
        component_group=comp_group,
    )
    item_id = f"fact_{challenge.id}_{component_id.replace('.', '_')}"
    return StakeholderIntelItem(
        id=item_id,
        challenge_id=challenge.id,
        stakeholder_id=stakeholder_id,
        type=IntelTag.FACT,
        categorized_type=IntelTag.FACT,
        intel_type=ConfidenceType.VERIFIED,
        description=fact_text,
        categorized_description=fact_text,
        source=IntelSource.INTERVIEW,
        discovered_phase_id=challenge.phase_id,
        discovered_challenge_template=getattr(challenge, "template_id", ""),
        dossier_source="engagement_card",
        asserts=FactAssertion(target=component_id),
    )


class InvestigationTurnResult(BaseModel):
    outcome: gather.TurnOutcome
    revealed_db_entries: list[dict[str, Any]] = Field(default_factory=list)
    intel_item: Optional[StakeholderIntelItem] = None
    player_message: str = ""
    stakeholder_message: str = ""


async def conduct_component_investigation_turn(
    websocket: WebSocket,
    username: str,
    challenge: Any,
    conversation: gather.GatherConversation,
    component_id: str,
    history_str: str,
    emotion_values_map: dict[str, Any],
    graph: Optional[TechnicalGraph] = None,
    known_ids: Optional[set[str]] = None,
    chosen_prompt: str = "",
) -> InvestigationTurnResult:
    """Executes a component investigation dialogue turn with the owning stakeholder."""
    stakeholder_id = conversation.stakeholder_id
    comp_name = gather.component_display_name(component_id, graph)

    # Stakeholder persona and emotion setup
    st_obj = None
    try:
        st_obj = StakeholderFactory.get_stakeholder(stakeholder_id)
    except Exception:
        pass

    st_name = st_obj.name if st_obj else stakeholder_id.replace("_", " ").title()
    st_role = st_obj.role_description if st_obj else "MLOps Stakeholder"
    st_resp = st_obj.responsibilities if st_obj else ""
    st_priorities = st_obj.priorities if st_obj else ""

    emotion_str = "Neutral"
    st_ev = emotion_values_map.get(stakeholder_id)
    if st_ev:
        try:
            derived = EmotionFactory.derive_emotional_state(st_ev)
            if derived:
                emotion_str = derived.capitalize()
        except Exception:
            pass

    current_known = known_ids or set()
    challenge_context = f"{challenge.name}: {challenge.description}"

    # 1. Resolve or generate intel item
    intel_item = await resolve_or_generate_component_intel(
        challenge=challenge,
        component_id=component_id,
        stakeholder_id=stakeholder_id,
        known_ids=current_known,
        graph=graph,
    )

    # 2. Generate and emit player utterance
    player_message = await generate_investigation_player_utterance(
        challenge=challenge_context,
        target_stakeholder_name=st_name,
        target_stakeholder_role=st_role,
        component_id=component_id,
        component_name=comp_name,
        dialogue_option_prompt=chosen_prompt,
        history=history_str,
    )
    if player_message:
        await manager.send_event(
            websocket=websocket,
            event="intel:message_received",
            payload={
                "type": "player_message",
                "message": player_message,
                "conversation_id": conversation.conversation_id,
            },
        )

    # 3. Store the verified intel item in dossier
    await store_intel_item(challenge, websocket, intel_item)

    # 4. Generate and emit stakeholder response
    tag_str = (
        intel_item.type.value
        if hasattr(intel_item.type, "value")
        else str(intel_item.type)
    ).replace("_", " ").title()

    stakeholder_message = await generate_investigation_stakeholder_response(
        stakeholder_name=st_name,
        stakeholder_role=st_role,
        challenge=challenge_context,
        responsibilities=st_resp,
        priorities=st_priorities,
        emotion=emotion_str,
        component_name=comp_name,
        revealed_intel_description=intel_item.description,
        revealed_intel_tag=tag_str,
        history=history_str,
        player_utterance=player_message,
    )

    item_dict = intel_item.model_dump(mode="json")
    item_dict["stakeholder_name"] = st_name

    msg_payload = {
        "type": "stakeholder_message",
        "stakeholder_id": stakeholder_id,
        "stakeholder_name": st_name,
        "message": stakeholder_message,
        "conversation_id": conversation.conversation_id,
        "revealed_intel_items": [item_dict],
    }
    await manager.send_event(websocket=websocket, event="intel:message_received", payload=msg_payload)

    # 5. Build GameEvent and updated conversation
    event = GameEvent(
        step="gather",
        kind="intel",
        subject_id=stakeholder_id,
        direction="up",
        magnitude="clear",
        cause="intel.revealed",
        params={"st": st_name, "component": comp_name},
        refs={"item_id": intel_item.id},
    )

    updated_conv = gather._spend_turn(conversation, asked_option=component_id).model_copy(
        update={
            "discovered_item_ids": conversation.discovered_item_ids + [intel_item.id]
        }
    )

    outcome = gather.TurnOutcome(
        conversation=updated_conv,
        option="investigate_component",
        result="revealed",
        item_id=intel_item.id,
        item_ids=[intel_item.id],
        events=[event],
    )

    revealed_db_entries = [
        {
            "id": stakeholder_id,
            "stakeholder_id": stakeholder_id,
            "stakeholder_name": st_name,
            "message": stakeholder_message,
            "conversation_id": conversation.conversation_id,
            "ac_id": -1,
            "revealed_intel": [item_dict],
        }
    ]

    return InvestigationTurnResult(
        outcome=outcome,
        revealed_db_entries=revealed_db_entries,
        intel_item=intel_item,
        player_message=player_message,
        stakeholder_message=stakeholder_message,
    )
