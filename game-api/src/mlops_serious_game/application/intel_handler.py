
import asyncio
import uuid
from mlops_serious_game.domain.requirement import (
    StakeholderIntelItemArtifact,
    ArtifactType,
    ConfidenceType,
    IntelSource,
    IntelTag,
    join_wording,
    StakeholderIntelItem,
    StakeholderRequirement,
    item_target as _shared_item_target,
    item_target_and_level,
)
from typing import List, Dict, Any, Optional
import random

from fastapi import WebSocket
from sqlalchemy import select

from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.offline_intel_artifact_factory import OfflineIntelArtifactFactory
from mlops_serious_game.domain.convincer_archetype_artifact_factory import ConvincerArchetypeArtifactFactory
from mlops_serious_game.application.pitch_debate_service.chains import (
    get_wrong_intel_chain,
    get_intel_artifact_chain,
)
from mlops_serious_game.application.pitch_debate_service.state import DialogueOption
from mlops_serious_game.infrastructure.database import IntelItem, GameSession, get_session, get_user_id
from mlops_serious_game.config import settings


async def generate_intel_item_artifact_content(
    curr_challenge: Challenge,
    intel_item: StakeholderIntelItem,
    artifact_type: ArtifactType = ArtifactType.EMAIL,
) -> str:
    """Generates the content of an intel item artifact based on the stakeholder's stance."""
    req = RequirementFactory.get_requirement(intel_item.id)
    stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
    stakeholder_name = stakeholder.name
    stakeholder_profile = (
        f"Responsibilities: {stakeholder.responsibilities}, Priorities: {stakeholder.priorities}"
    )

    chain = get_intel_artifact_chain()
    res = await chain.ainvoke({
        "challenge": personalize(curr_challenge.description, resolve_markers=True),
        "stakeholder_name": stakeholder_name,
        "stakeholder_profile": stakeholder_profile,
        "requirement_description": req.description,
        "requirement_type": req.type.value,
        "artifact_type": artifact_type.value if isinstance(artifact_type, ArtifactType) else str(artifact_type),
    })
    return res.strip()


async def generate_intel_item_artifact(
    curr_challenge: Challenge,
    intel_item: StakeholderIntelItem,
    artifact_type: ArtifactType = ArtifactType.EMAIL,
) -> StakeholderIntelItemArtifact:
    """Generates an intel item artifact for the given intel item."""
    content = await generate_intel_item_artifact_content(curr_challenge, intel_item, artifact_type)
    return StakeholderIntelItemArtifact(
        id=str(uuid.uuid4()),
        intel_item_id=intel_item.id,
        type=artifact_type,
        content=content,
    )


def select_reqs_for_offl_intel_gathering(curr_challenge: Challenge) -> List[StakeholderRequirement]:
    """Selects 5 random requirement objects across all stakeholders and types for the current challenge."""
    all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
    if len(all_reqs) <= 5:
        return all_reqs.copy()
    return random.sample(all_reqs, 5)


async def _generate_single_artifact(curr_challenge: Challenge, req: StakeholderRequirement, art_type: ArtifactType) -> Dict[str, Any]:
    stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
    temp_item = StakeholderIntelItem.from_requirement(req)
    try:
        content = await generate_intel_item_artifact_content(curr_challenge, temp_item, art_type)
    except Exception as e:
        print(f"[Offline Intel Generation Error] {e}")
        content = f"Stakeholder Stance Note regarding {curr_challenge.name}: {req.description}"

    return {
        "id": str(uuid.uuid4()),
        "requirement_id": req.id,
        "stakeholder_id": req.stakeholder_id,
        "stakeholder_name": stakeholder.name,
        "stakeholder_role": stakeholder.role_description,
        "artifact_type": art_type.value if isinstance(art_type, ArtifactType) else str(art_type),
        "content": content,
    }


def get_default_stakeholder_archetypes(existing_archs: Optional[dict] = None) -> dict:
    """Helper function to build or update default stakeholder convincer archetypes."""
    archs = dict(existing_archs or {})
    stakeholder_list = (
        StakeholderFactory.stakeholders
        if isinstance(StakeholderFactory.stakeholders, list)
        else list(StakeholderFactory.stakeholders.values())
    )
    for st in stakeholder_list:
        s_id = getattr(st, "id", None) or (st.get("id") if isinstance(st, dict) else str(st))
        real_arch = getattr(st, "convincer_archetype", "") if hasattr(st, "convincer_archetype") else (st.get("convincer_archetype", "") if isinstance(st, dict) else "")
        if s_id not in archs:
            archs[s_id] = {
                "real_archetype": real_arch,
                "categorized_archetype": None,
            }
        else:
            archs[s_id]["real_archetype"] = real_arch
    return archs


async def tag_stakeholder_convincer_archetype(
    player: str,
    stakeholder_id: str,
    categorized_archetype: str,
) -> dict:
    """Processes tagging or re-tagging of a stakeholder's convincer archetype."""
    if stakeholder_id not in StakeholderFactory.get_available_stakeholders():
        raise ValueError(f"Invalid stakeholder_id: {stakeholder_id}")
    if categorized_archetype not in EmotionFactory.get_available_archetype_names():
        raise ValueError(f"Invalid categorized_archetype: {categorized_archetype}")

    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
    with get_session() as db_session:
        session_rec = get_or_create_game_session(player, db_session)
        archs = dict(session_rec.stakeholder_archetypes or {})
        st_entry = dict(archs.get(stakeholder_id, {}))
        st = StakeholderFactory.get_stakeholder(stakeholder_id)
        real_arch = getattr(st, "convincer_archetype", "") if st else st_entry.get("real_archetype", "")

        # Only a verified archetype is locked. A correct guess stays open to re-tagging until the
        # pitch confirms it, otherwise the lock itself would tell the player they got it right.
        if st_entry.get("verified"):
            return st_entry

        st_entry["real_archetype"] = real_arch
        st_entry["categorized_archetype"] = categorized_archetype
        st_entry["verified"] = False
        archs[stakeholder_id] = st_entry
        session_rec.stakeholder_archetypes = archs
        flag_modified(session_rec, "stakeholder_archetypes")
        db_session.commit()
        return st_entry


def correct_and_verify_convincer_archetype(
    username: str,
    stakeholder_id: str,
) -> dict:
    """Sets the true archetype in GameSession and marks it verified, whether the tag was right or not."""
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
    with get_session() as session:
        session_rec = get_or_create_game_session(username, session)
        archs = dict(session_rec.stakeholder_archetypes or {})
        st_entry = dict(archs.get(stakeholder_id, {}))
        st = StakeholderFactory.get_stakeholder(stakeholder_id)
        real_arch = getattr(st, "convincer_archetype", "") if st else st_entry.get("real_archetype", "")
        old_cat = st_entry.get("categorized_archetype")
        st_entry["real_archetype"] = real_arch
        st_entry["categorized_archetype"] = real_arch
        st_entry["verified"] = True
        archs[stakeholder_id] = st_entry
        session_rec.stakeholder_archetypes = archs
        flag_modified(session_rec, "stakeholder_archetypes")
        session.commit()
        return {
            "stakeholder_id": stakeholder_id,
            "old_archetype": old_cat,
            "true_archetype": real_arch,
        }


def rule_out_archetype(username: str, stakeholder_id: str, archetype_name: str) -> dict:
    """Trial Balloon (D49, plan 11): a guessed archetype that did not land. Struck through in the
    re-tag picker from then on. Never verifies anything - only a match does that."""
    from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
    with get_session() as session:
        session_rec = get_or_create_game_session(username, session)
        archs = dict(session_rec.stakeholder_archetypes or {})
        st_entry = dict(archs.get(stakeholder_id, {}))
        ruled_out = list(st_entry.get("ruled_out", []))
        if archetype_name not in ruled_out:
            ruled_out.append(archetype_name)
        st_entry["ruled_out"] = ruled_out
        archs[stakeholder_id] = st_entry
        session_rec.stakeholder_archetypes = archs
        flag_modified(session_rec, "stakeholder_archetypes")
        session.commit()
        return st_entry


def ruled_out_archetypes(username: str, stakeholder_id: str) -> list[str]:
    """Archetypes a Trial Balloon has already ruled out for this stakeholder (D49)."""
    with get_session() as session:
        user_id = get_user_id(session, username)
        row = session.scalars(
            select(GameSession).where(GameSession.user_id == user_id).order_by(GameSession.id.desc())
        ).first()
        if row is None or not isinstance(row.stakeholder_archetypes, dict):
            return []
        entry = row.stakeholder_archetypes.get(stakeholder_id)
        return list(entry.get("ruled_out", [])) if isinstance(entry, dict) else []


# The deck stays short: a few stances, and at most a couple of Facts among them.
MAX_STANCE_ARTIFACTS = 3
MAX_FACT_ARTIFACTS = 2


def deal_unconfirmed_artifacts(curr_challenge: Challenge, artifacts: list) -> list:
    """The artifacts the player tags themselves: up to three stances and up to two Facts.

    Facts about the conflict's own target go first, since those are what the pitch turns on;
    config order breaks ties. A Fact nobody voices is left out, because a card with no name on it
    would give its tag away.
    """
    conflict_target = getattr(getattr(curr_challenge, "conflict", None), "target", None)
    stances, facts = [], []
    for art in artifacts:
        req = RequirementFactory.get_requirement(art.requirement_id)
        if req is not None and req.type == IntelTag.FACT:
            if art.narrator_id:
                facts.append((item_target(req) != conflict_target, art))
        else:
            stances.append(art)
    facts.sort(key=lambda pair: pair[0])
    return stances[:MAX_STANCE_ARTIFACTS] + [art for _, art in facts[:MAX_FACT_ARTIFACTS]]


def _deck_debug(requirement_id: str) -> Dict[str, Any]:
    """Answer key for one card in the offline deck. Empty unless ENABLE_DOSSIER_DEBUG is on."""
    if not settings.ENABLE_DOSSIER_DEBUG:
        return {}
    req = RequirementFactory.get_requirement(requirement_id)
    return {"debug": _debug_requirement(req)} if req else {}


async def generate_offline_intel_artifacts(curr_challenge: Challenge, username: str = None) -> List[Dict[str, Any]]:
    """Loads offline intel artifacts and additional convincer profile artifacts for newly introduced stakeholders.

    Known artifacts are dealt into the deck too, already tagged and locked. They used to be seeded
    straight into the dossier without ever being shown, which left players staring at verified intel
    with no idea where it came from. Reading them costs a couple of clicks and gives the player a
    worked example of a correct tag before their first real call.
    """
    challenge_artifacts = OfflineIntelArtifactFactory.get_artifacts_for_challenge(curr_challenge.id)
    unconfirmed_artifacts = deal_unconfirmed_artifacts(
        curr_challenge, [art for art in challenge_artifacts if not art.is_known]
    )
    known_artifacts = [art for art in challenge_artifacts if art.is_known]

    results = []
    for art in unconfirmed_artifacts:
        # A Fact goes out under its narrator's name, with nothing in the payload that marks it as
        # a Fact: telling it apart from a stance is the player's call.
        results.append({
            "id": art.id,
            "requirement_id": art.requirement_id,
            "stakeholder_id": art.speaker_id,
            "stakeholder_name": art.stakeholder_name,
            "stakeholder_role": art.stakeholder_role,
            "artifact_type": art.artifact_type.value if isinstance(art.artifact_type, ArtifactType) else str(art.artifact_type),
            "content": art.content,
            "is_known": False,
            **_deck_debug(art.requirement_id),
        })


    # Append convincer profile artifacts for stakeholders newly introduced in this phase
    # Append convincer profile artifacts for stakeholders active in this phase that need introduction/categorization
    active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id)
    phases = PhaseFactory.get_phases()
    if not active_st_ids and 0 <= curr_challenge.phase_id < len(phases):
        active_st_ids = [ps.stakeholder_id for ps in phases[curr_challenge.phase_id].stakeholders]
    
    session_archs = {}
    if username:
        from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
        with get_session() as db_session:
            sess_rec = get_or_create_game_session(username, db_session)
            session_archs = dict(sess_rec.stakeholder_archetypes or {})

    previous_st_ids = set()
    for p_idx in range(curr_challenge.phase_id):
        if p_idx < len(phases):
            for ps in phases[p_idx].stakeholders:
                previous_st_ids.add(ps.stakeholder_id)

    # Include any active stakeholder who is either newly introduced in this phase or not yet categorized
    st_ids_to_introduce = []
    for s_id in active_st_ids:
        st_cat = session_archs.get(s_id, {}).get("categorized_archetype")
        if st_cat is None or s_id not in previous_st_ids:
            if s_id not in st_ids_to_introduce:
                st_ids_to_introduce.append(s_id)
        
    all_archetypes = EmotionFactory.get_available_archetype_names()

    for s_id in st_ids_to_introduce:
        st = StakeholderFactory.get_stakeholder(s_id)
        if not st:
            continue
        real_arch_name = getattr(st, "convincer_archetype", "")
        art_def = ConvincerArchetypeArtifactFactory.get_artifact_for_archetype(real_arch_name)
        
        if art_def:
            template = art_def.convincer_archetype_artifact
            artifact_type_val = (
                art_def.artifact_type.value
                if hasattr(art_def.artifact_type, "value")
                else str(art_def.artifact_type)
            )
        else:
            # The viewer draws the channel header and the speaker's name, so the body is body only.
            template = "Let's make sure our approach is aligned with our priorities."
            artifact_type_val = "slack_message"

        content = template.replace("{stakeholder_name}", st.name)
        
        cat_type = session_archs.get(s_id, {}).get("categorized_archetype") if session_archs else None

        results.append({
            "id": f"convincer_{st.id}",
            "requirement_id": f"convincer_{st.id}",
            "stakeholder_id": st.id,
            "stakeholder_name": st.name,
            "stakeholder_role": getattr(st, "role_description", ""),
            "artifact_type": artifact_type_val,
            "content": content,
            "is_convincer_profile": True,
            "possible_archetypes": all_archetypes,
            "categorized_type": cat_type,
            **({"debug": {
                "id": f"convincer_{st.id}",
                "correct_tag": real_arch_name,
                "description": "Convincer archetype",
            }} if settings.ENABLE_DOSSIER_DEBUG else {}),
        })

    # Shuffle the combined list so convincer and intel artifacts are mixed
    random.shuffle(results)

    # Known artifacts go in front, unshuffled: they are the briefing the player reads before
    # making any call of their own, so they must not land in the middle of the deck.
    known_results = []
    for art in known_artifacts:
        req = RequirementFactory.get_requirement(art.requirement_id)
        if not req:
            continue
        known_results.append({
            "id": art.id,
            "requirement_id": art.requirement_id,
            "stakeholder_id": art.speaker_id,
            "stakeholder_name": art.stakeholder_name,
            "stakeholder_role": art.stakeholder_role,
            "artifact_type": art.artifact_type.value if isinstance(art.artifact_type, ArtifactType) else str(art.artifact_type),
            "content": art.content,
            "is_known": True,
            "categorized_type": req.type.value if hasattr(req.type, "value") else str(req.type),
            **_deck_debug(art.requirement_id),
        })

    # The challenge itself leads: how the disputed component stands, then who wants what from it.
    known_results.sort(key=lambda card: card["categorized_type"] != IntelTag.FACT.value)
    return known_results + results


from sqlalchemy.orm.attributes import flag_modified

def _phase_of_challenge(challenge_id: Optional[int]) -> Optional[int]:
    """The phase a challenge belongs to, for notes written before the phase was stamped."""
    if challenge_id is None:
        return None
    try:
        return PhaseFactory.get_challenge_by_id(challenge_id).phase_id
    except Exception:
        return None


def load_known_intel_items_for_challenge(curr_challenge: Challenge, username: str) -> List[StakeholderIntelItem]:
    """Loads all is_known==True intel items for the current challenge into the DB as verified and returns them."""
    known_artifacts = [
        art for art in OfflineIntelArtifactFactory.get_artifacts_for_challenge(curr_challenge.id)
        if art.is_known
    ]
    if not known_artifacts:
        return []

    loaded_items: List[StakeholderIntelItem] = []
    with get_session() as session:
        user_id = get_user_id(session, username)
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == user_id)
        ).all()
        existing_ids = {
            r.intel_item_data.get("id")
            for r in records
            if isinstance(r.intel_item_data, dict)
        }

        for art in known_artifacts:
            req = RequirementFactory.get_requirement(art.requirement_id)
            if not req:
                continue

            if req.id not in existing_ids:
                new_item = StakeholderIntelItem.from_requirement(
                    req,
                    intel_type=ConfidenceType.VERIFIED,
                    categorized_type=req.type,
                    description=req.description,
                    source=IntelSource.PUBLIC_RECORD,
                )
                # Where the player picked it up, so the dossier can say so later (plan 05).
                new_item.discovered_phase_id = curr_challenge.phase_id
                new_item.discovered_challenge_template = curr_challenge.template_id
                new_record = IntelItem(
                    user_name=username,
                    user_id=user_id,
                    intel_item_data=new_item.model_dump(mode="json"),
                )
                session.add(new_record)
                existing_ids.add(req.id)
                loaded_items.append(new_item)
            else:
                for r in records:
                    if isinstance(r.intel_item_data, dict) and r.intel_item_data.get("id") == req.id:
                        data = dict(r.intel_item_data)
                        cat_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)
                        if data.get("intel_type") != ConfidenceType.VERIFIED.value or data.get("categorized_type") != cat_type_str or data.get("description") != req.description or data.get("categorized_description") != req.description or data.get("source") != IntelSource.PUBLIC_RECORD.value:
                            data["intel_type"] = ConfidenceType.VERIFIED.value
                            data["categorized_type"] = cat_type_str
                            data["description"] = req.description
                            data["categorized_description"] = req.description
                            # Items persisted before provenance was tracked say nothing about
                            # where they came from; anything the known-intel loader touches was
                            # said openly before the player started digging.
                            data.pop("is_public_record", None)
                            data["source"] = IntelSource.PUBLIC_RECORD.value
                        if data.get("discovered_phase_id") is None:
                            data["discovered_phase_id"] = curr_challenge.phase_id
                            data["discovered_challenge_template"] = curr_challenge.template_id
                            r.intel_item_data = data
                            flag_modified(r, "intel_item_data")
                        loaded_items.append(StakeholderIntelItem(**data))
                        break
        session.commit()
    return loaded_items


# ── Plan 05: Persistent dossier ───────────────────────────────────────────────


def load_known_intel_items(username: str, up_to_phase: Optional[int] = None) -> List[StakeholderIntelItem]:
    """Return all intel items the player has ever collected, across all phases.

    If `up_to_phase` is given, only items with `discovered_phase_id <= up_to_phase` are returned
    (items without the field are always included for backward compatibility).
    """
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == get_user_id(session, username))
        ).all()
        items: List[StakeholderIntelItem] = []
        for r in records:
            if not isinstance(r.intel_item_data, dict):
                continue
            try:
                item = StakeholderIntelItem(**r.intel_item_data)
            except Exception:
                continue
            if up_to_phase is not None and item.discovered_phase_id is not None:
                if item.discovered_phase_id > up_to_phase:
                    continue
            items.append(item)
        return items


def assemble_chains(
    items: List[StakeholderIntelItem],
) -> List[Dict[str, Any]]:
    """Group items into refinement chains using refines_id links.

    Returns a list of chain dicts:
        {
            "tag": "driver" | ...,
            "stakeholder_id": str | None,
            "target": str | None,       # from asserts or suggested
            "links": [item, ...],       # oldest first
            "status": "open" | "stale" | ...,  # placeholder, computed later with graph state
        }

    Items with no refines_id and not referenced by any other item form single-link chains.
    Items forming a cycle are each placed in their own chain (defensive).
    """
    by_id: Dict[str, StakeholderIntelItem] = {i.id: i for i in items}
    # Build reverse map: item_id → the item that refines it (its successor).
    refined_by: Dict[str, str] = {}
    for item in items:
        if item.refines_id and item.refines_id in by_id:
            refined_by[item.refines_id] = item.id

    visited: set[str] = set()
    chains: List[Dict[str, Any]] = []

    def _follow(root_id: str) -> List[StakeholderIntelItem]:
        chain: List[StakeholderIntelItem] = []
        cur_id: Optional[str] = root_id
        seen: set[str] = set()
        while cur_id and cur_id not in seen:
            seen.add(cur_id)
            node = by_id.get(cur_id)
            if node is None:
                break
            chain.append(node)
            cur_id = refined_by.get(cur_id)
        return chain

    # Roots are the oldest links: an item that refines nothing the player holds. `_follow` then
    # walks forward through the successors, so a chain comes out oldest first.
    roots = [i.id for i in items if not i.refines_id or i.refines_id not in by_id]

    for root_id in roots:
        if root_id in visited:
            continue
        chain_items = _follow(root_id)
        for ci in chain_items:
            visited.add(ci.id)
        if not chain_items:
            continue
        head = chain_items[-1]  # newest = headline
        target = None
        if head.asserts:
            target = head.asserts.target
        elif head.suggested:
            target = head.suggested.target
        chains.append({
            "tag": head.type.value if hasattr(head.type, "value") else str(head.type),
            "stakeholder_id": head.stakeholder_id,
            "target": target,
            "links": chain_items,
            "status": "open",  # caller must enrich with graph state
        })

    # Any remaining items (broken chains, cycles) become lone chains.
    for item in items:
        if item.id not in visited:
            chains.append({
                "tag": item.type.value if hasattr(item.type, "value") else str(item.type),
                "stakeholder_id": item.stakeholder_id,
                "target": None,
                "links": [item],
                "status": "open",
            })

    return chains


# The dossier's environment section rides in the same list as the stakeholder pages, because the
# payload is a list of pages and every screen that shows the dossier just forwards it.
ENVIRONMENT_ENTRY_ID = "__environment__"


def chain_index(items: List[StakeholderIntelItem]) -> Dict[str, Dict[str, Any]]:
    """Per item id: which chain it belongs to and where in it.

    The chain is named after its oldest link, so a chain keeps its identity when a newer
    refinement arrives and the card the player built does not change under them.
    """
    index: Dict[str, Dict[str, Any]] = {}
    for chain in assemble_chains(items):
        links = chain["links"]
        for position, link in enumerate(links):
            index[link.id] = {
                "chain_id": links[0].id,
                "chain_position": position,
                "chain_length": len(links),
                "chain_newest": position == len(links) - 1,
            }
    return index


def authored_successors() -> Dict[str, List[str]]:
    """Which authored items refine which, read straight off the content set."""
    successors: Dict[str, List[str]] = {}
    for req in RequirementFactory.requirements:
        if req.refines_id:
            successors.setdefault(req.refines_id, []).append(req.id)
    return successors


def locked_links_ahead(newest_id: str, held_ids: set, successors: Dict[str, List[str]]) -> int:
    """How many authored refinements sit past the newest link the player holds.

    A count only: the locked row says there is more to learn, never what it says.
    """
    locked = 0
    frontier = [newest_id]
    seen = {newest_id}
    while frontier:
        for nxt in successors.get(frontier.pop(), []):
            if nxt in seen:
                continue
            seen.add(nxt)
            frontier.append(nxt)
            if nxt not in held_ids:
                locked += 1
    return locked


def item_target(item) -> Optional[str]:
    """The graph target an item is about, whichever payload carries it.

    Delegates to `domain.requirement.item_target_and_level` (the single shared implementation -
    a code-review finding, C/G passes) so this, `session.py`, `objections.py` and
    `requirement_factory.py` can never again silently diverge on priority order or field coverage.
    """
    return _shared_item_target(item)


def _graph_snapshot(username: str):
    """(graph, state, evaluation) as the player's graph stands, or None when it cannot be read.

    The dossier is a reading surface. If the graph store is unavailable the notes still have to
    render; they just cannot say yet whether anyone acted on them.
    """
    try:
        from mlops_serious_game.application.graph_service import store as graph_store
        from mlops_serious_game.application.graph_service.view import evaluate_graph
        from mlops_serious_game.domain.graph_factory import GraphFactory

        graph = GraphFactory.get_graph()
        state = graph_store.load_state(username).state
        return graph, state, evaluate_graph(graph, state)
    except Exception:
        return None


def _effective_level(snapshot, target: str) -> Optional[int]:
    graph, _state, evaluation = snapshot
    resolved = graph.resolve(target)
    if graph.is_edge(resolved):
        return evaluation.effective.edges.get(resolved)
    return evaluation.effective.components.get(resolved)


def stage_of_target(snapshot, target: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(stage id, stage name) the target sits in, so Facts can be grouped by stage."""
    if not target or snapshot is None:
        return None, None
    graph = snapshot[0]
    try:
        stage = graph.stage(graph.stage_of(graph.resolve(target)))
        return stage.id, stage.name
    except Exception:
        return None, None


def item_status(item, snapshot) -> str:
    """open, addressed, violated or stale: read off the graph every time, never stored."""
    if snapshot is None:
        return "open"
    graph, state, evaluation = snapshot
    try:
        if item.type == IntelTag.BOUNDARY and item.holds is not None:
            from mlops_serious_game.domain.graph_predicates import evaluate

            holds = evaluate(item.holds, evaluation.context(graph, state)).value
            return "open" if holds else "violated"
        if item.type == IntelTag.FACT and item.asserts is not None and item.asserts.level is not None:
            level = _effective_level(snapshot, item.asserts.target)
            return "stale" if level is not None and level != item.asserts.level else "open"
        if item.type == IntelTag.DRIVER and item.suggested is not None:
            level = _effective_level(snapshot, item.suggested.target)
            return "addressed" if level is not None and level >= item.suggested.level else "open"
    except Exception:
        return "open"
    return "open"


def is_contested(item, conflict) -> bool:
    """True when this challenge's conflict puts somebody on the other side of this very target."""
    if conflict is None or not item.stakeholder_id:
        return False
    sides = {p.stakeholder_id for p in conflict.positions}
    return item.stakeholder_id in sides and item_target(item) == conflict.target


def _archived_items(username: str, up_to_phase: Optional[int]) -> List[StakeholderIntelItem]:
    """Everything the player found in earlier phases (plan 05).

    A failed read must never take the dossier down with it: this challenge's own notes are
    enough to render a page.
    """
    try:
        return load_known_intel_items(username, up_to_phase=up_to_phase)
    except Exception as e:
        print(f"[Dossier] could not read the intel archive: {e}")
        return []


# ── End Plan 05 ───────────────────────────────────────────────────────────────


async def store_intel_item(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Stores or updates an intel item in the database.

    A note is stamped with the phase it was picked up in the first time it is written, and keeps
    that stamp afterwards: it is where the player found it, not where they last looked at it.
    """
    if intel_item.discovered_phase_id is None:
        intel_item.discovered_phase_id = curr_challenge.phase_id
        intel_item.discovered_challenge_template = curr_challenge.template_id
    with get_session() as session:
        username = ws.query_params["username"]
        user_id = get_user_id(session, username)
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == user_id)
        ).all()

        target_record = None
        for record in records:
            if isinstance(record.intel_item_data, dict):
                item_id = record.intel_item_data.get("id")
                if item_id == intel_item.id:
                    target_record = record
                    break

        item_dict = intel_item.model_dump(mode="json") if hasattr(intel_item, "model_dump") else intel_item
        if target_record:
            target_record.intel_item_data = dict(item_dict)
            flag_modified(target_record, "intel_item_data")
        else:
            new_record = IntelItem(
                user_name=username,
                user_id=user_id,
                intel_item_data=dict(item_dict)
            )
            session.add(new_record)
        session.commit()



async def retrieve_intel_items(curr_challenge: Challenge, ws: WebSocket) -> List[StakeholderIntelItem]:
    """Retrieves intel items for the current challenge."""
    intel_items: List[StakeholderIntelItem] = []

    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == get_user_id(session, ws.query_params["username"]))
        ).all()

        for record in records:
            data = record.intel_item_data
            if isinstance(data, dict):
                item = StakeholderIntelItem(**data)
                if item.challenge_id == curr_challenge.id:
                    intel_items.append(item)

    return intel_items



async def handle_intel_item_categorization(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Handles the categorization of intel items using pre-generated descriptions when available."""
    cat_type = intel_item.categorized_type.value if hasattr(intel_item.categorized_type, "value") else str(intel_item.categorized_type)
    true_type = intel_item.type.value if hasattr(intel_item.type, "value") else str(intel_item.type)
    if cat_type == true_type:
        intel_item.categorized_description = intel_item.description
    else:
        wrong_desc = OfflineIntelArtifactFactory.get_wrong_description(
            intel_item.id,
            cat_type,
        )
        if wrong_desc and intel_item.fact:
            # Split wording: only the reading changes with the tag, the fact holds still.
            intel_item.categorized_description = join_wording(intel_item.fact, wrong_desc)
        elif wrong_desc:
            intel_item.categorized_description = wrong_desc
        else:
            intel_item.categorized_description = await create_wrong_intel_item_description(curr_challenge, intel_item)
    await store_intel_item(curr_challenge, ws, intel_item)

async def create_wrong_intel_item_description(curr_challenge: Challenge, intel_item: StakeholderIntelItem) -> str:
    """Creates a wrong description for the given intel item"""
    stakeholder = StakeholderFactory.get_stakeholder(intel_item.stakeholder_id)
    stakeholder_name = stakeholder.name if stakeholder else "Stakeholder"
    stakeholder_profile = (
        f"Responsibilities: {stakeholder.responsibilities}, Priorities: {stakeholder.priorities}"
        if stakeholder else ""
    )

    chain = get_wrong_intel_chain()
    res = await chain.ainvoke({
        "challenge": personalize(curr_challenge.description, resolve_markers=True),
        "stakeholder_name": stakeholder_name,
        "stakeholder_profile": stakeholder_profile,
        "correct_description": intel_item.description,
        "categorized_type": intel_item.categorized_type.value if hasattr(intel_item.categorized_type, "value") else str(intel_item.categorized_type)
    })
    return res.strip()


async def generate_and_save_all_offline_intel_artifacts() -> Dict[str, Any]:
    """Generates offline intel artifacts and all possible miscategorizations for all requirements and saves to config."""
    from pathlib import Path
    import json
    from mlops_serious_game.domain.gameConfigLoader import GameConfigLoader

    existing_artifacts = OfflineIntelArtifactFactory.artifacts_by_requirement
    all_reqs = RequirementFactory.get_requirements()
    if not all_reqs:
        return {"status": "error", "message": "No requirement objects found to generate artifacts for."}

    # Only process requirements that are configured in OfflineIntelArtifactFactory
    reqs_to_process = [r for r in all_reqs if r.id in existing_artifacts] if existing_artifacts else all_reqs

    artifact_types = list(ArtifactType)
    semaphore = asyncio.Semaphore(10)

    async def _process_requirement(req: StakeholderRequirement) -> Dict[str, Any]:
        async with semaphore:
            curr_challenge = PhaseFactory.get_challenge_by_id(req.challenge_id)
            if not curr_challenge:
                phases = PhaseFactory.get_phases()
                curr_challenge = phases[0].challenges[0]
            
            stakeholder = StakeholderFactory.get_stakeholder(req.stakeholder_id)
            existing_art = existing_artifacts.get(req.id)
            art_type = existing_art.artifact_type if existing_art else random.choice(artifact_types)
            art_id = existing_art.id if existing_art else f"art_{req.id}"
            is_known = existing_art.is_known if existing_art is not None else False

            temp_item = StakeholderIntelItem.from_requirement(req)

            # 1. Generate main artifact content
            try:
                content = await generate_intel_item_artifact_content(curr_challenge, temp_item, art_type)
            except Exception as e:
                print(f"[Offline Intel Generator Warning] Content generation failed for {req.id}: {e}")
                content = f"Stakeholder Note from {stakeholder.name}: {req.description}"

            # 2. Generate wrong descriptions for all 3 miscategorizations
            wrong_descriptions: Dict[str, str] = {}
            possible_types = [t for t in IntelTag if t != req.type]

            for wrong_type in possible_types:
                temp_wrong_item = StakeholderIntelItem.from_requirement(req, categorized_type=wrong_type)
                try:
                    wrong_desc = await create_wrong_intel_item_description(curr_challenge, temp_wrong_item)
                except Exception as e:
                    print(f"[Offline Intel Generator Warning] Wrong desc generation failed for {req.id} ({wrong_type.value}): {e}")
                    wrong_desc = f"Misinterpreted Stance regarding {curr_challenge.name}: {req.description}"
                
                wrong_descriptions[wrong_type.value] = wrong_desc

            return {
                "id": art_id,
                "requirement_id": req.id,
                "challenge_id": req.challenge_id,
                "stakeholder_id": req.stakeholder_id,
                "stakeholder_name": stakeholder.name,
                "stakeholder_role": stakeholder.role_description,
                "artifact_type": art_type.value if hasattr(art_type, "value") else str(art_type),
                "content": content,
                "wrong_descriptions": wrong_descriptions,
                "is_known": is_known,
            }

    tasks = [_process_requirement(req) for req in reqs_to_process]
    generated_artifacts = await asyncio.gather(*tasks)

    # Save to gameConfig/OfflineIntelArtifacts.json
    base_dir = Path(__file__).parent
    target_path = (base_dir / "../../../../gameConfig/OfflineIntelArtifacts.json").resolve()
    
    output_data = {
        "artifacts": list(generated_artifacts)
    }

    with target_path.open("w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)

    # Re-initialize GameConfigLoader to refresh in-memory factory
    GameConfigLoader.initialize()

    return {
        "status": "success",
        "count": len(generated_artifacts),
        "message": f"Successfully generated and saved {len(generated_artifacts)} offline intel artifacts to OfflineIntelArtifacts.json!"
    }


async def handle_intel_tagging(
    curr_challenge: Challenge,
    ws: WebSocket,
    requirement_id: str,
    categorized_type: str,
) -> StakeholderIntelItem:
    """Processes tagging or re-tagging of an intel artifact by the player, creating or updating an intel item."""
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    existing_item = next((item for item in collected_items if item.id == requirement_id), None)

    if existing_item:
        item_conf = existing_item.intel_type.value if hasattr(existing_item.intel_type, "value") else str(existing_item.intel_type)
        if item_conf.lower() != "unconfirmed":
            return existing_item
        existing_item.categorized_type = IntelTag(categorized_type)
        req = RequirementFactory.get_requirement(existing_item.id)
        if req:
            existing_item.description = req.description
            existing_item.type = req.type
        intel_item = existing_item
    else:
        req = RequirementFactory.get_requirement(requirement_id)
        if not req:
            all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            req = next((r for r in all_reqs if r.id == requirement_id), None)
        if not req:
            raise ValueError(f"Requirement '{requirement_id}' not found.")
        intel_item = StakeholderIntelItem.from_requirement(
            req,
            intel_type=ConfidenceType.UNCONFIRMED,
            categorized_type=IntelTag(categorized_type),
        )

    await handle_intel_item_categorization(curr_challenge, ws, intel_item)
    return intel_item


async def handle_intel_verification(
    curr_challenge: Challenge,
    ws: WebSocket,
    intel_item_id: str,
) -> Dict[str, Any]:
    """Handles verification of an intel item.
    If correctly categorized: mark as verified.
    If incorrectly categorized: correct the categorized_type to true req.type, set true description, and mark as verified.
    Returns result details for frontend popup.
    """
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    target_item = next(
        (item for item in collected_items if item.id == intel_item_id),
        None
    )
    if not target_item:
        req = RequirementFactory.get_requirement(intel_item_id)
        if not req:
            all_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            req = next((r for r in all_reqs if r.id == intel_item_id), None)

        if not req:
            return {"status": "error", "message": f"Intel requirement '{intel_item_id}' not found."}

        target_item = StakeholderIntelItem.from_requirement(
            req,
            intel_type=ConfidenceType.VERIFIED,
            categorized_type=req.type,
            description=req.description,
            source=IntelSource.INTERVIEW,
        )
    else:
        req = RequirementFactory.get_requirement(target_item.id)

    # A Fact has no stakeholder of its own; the name shown is its narrator's.
    stakeholder = _stakeholder_or_none(speaker_of(target_item))

    old_categorized_type = (
        target_item.categorized_type.value
        if hasattr(target_item.categorized_type, "value")
        else str(target_item.categorized_type)
    )
    true_categorized_type = (
        req.type.value if (req and hasattr(req.type, "value"))
        else (str(req.type) if req else old_categorized_type)
    )

    # Perform verification & correction
    target_item.intel_type = ConfidenceType.VERIFIED
    # Public-record items never reach this phase unverified, so nothing to overwrite there.
    if target_item.source != IntelSource.PUBLIC_RECORD:
        target_item.source = IntelSource.INTERVIEW
    if req:
        target_item.categorized_type = req.type
        target_item.description = req.description
        target_item.categorized_description = req.description

    await store_intel_item(curr_challenge, ws, target_item)

    return {
        "status": "success",
        "old_categorized_type": old_categorized_type,
        "true_categorized_type": true_categorized_type,
        "id": target_item.id,
        "stakeholder_name": stakeholder.name if stakeholder else "",
        "description": target_item.description,
        "intel_item": target_item.model_dump(mode="json"),
    }


def correct_and_verify_intel_item(
    username: str,
    requirement_id: str,
    curr_challenge: Challenge = None,
) -> StakeholderIntelItem:
    """Corrects an intel item in the database and marks it as verified."""
    req = RequirementFactory.get_requirement(requirement_id)
    if not req:
        return None

    with get_session() as session:
        user_id = get_user_id(session, username)
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == user_id)
        ).all()

        target_record = None
        for record in records:
            if isinstance(record.intel_item_data, dict) and record.intel_item_data.get("id") == requirement_id:
                target_record = record
                break

        cat_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)

        if target_record:
            data = dict(target_record.intel_item_data)
            data["intel_type"] = ConfidenceType.VERIFIED.value
            data["categorized_type"] = cat_type_str
            data["description"] = req.description
            data["categorized_description"] = req.description
            if data.get("source") != IntelSource.PUBLIC_RECORD.value:
                data.pop("is_public_record", None)
                data["source"] = IntelSource.DEBATE.value
            target_record.intel_item_data = data
            flag_modified(target_record, "intel_item_data")
            session.commit()
            return StakeholderIntelItem(**data)
        else:
            new_item = StakeholderIntelItem.from_requirement(
                req,
                intel_type=ConfidenceType.VERIFIED,
                categorized_type=req.type,
                description=req.description,
                source=IntelSource.DEBATE,
            )
            new_record = IntelItem(
                user_name=username,
                user_id=user_id,
                intel_item_data=new_item.model_dump(mode="json")
            )
            session.add(new_record)
            session.commit()
            return new_item


def _set_intel_confidence(username: str, item_id: str, confidence: ConfidenceType) -> Optional[StakeholderIntelItem]:
    """Flips a held item's confidence in place, keeping whatever tag the player already filed it
    under - Gather's Test a hypothesis (D49) only ever settles a guess the player already made,
    it never touches the tag itself (Refuted's "free re-tag" is a separate, explicit action)."""
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == get_user_id(session, username))
        ).all()
        for record in records:
            if isinstance(record.intel_item_data, dict) and record.intel_item_data.get("id") == item_id:
                data = dict(record.intel_item_data)
                data["intel_type"] = confidence.value
                record.intel_item_data = data
                flag_modified(record, "intel_item_data")
                session.commit()
                return StakeholderIntelItem(**data)
        return None


def mark_intel_item_inferred(username: str, item_id: str) -> Optional[StakeholderIntelItem]:
    """Test a hypothesis, tag right (D49): tested, not just filed - counts toward pitch readiness
    (Q36/D53) same as Verified."""
    return _set_intel_confidence(username, item_id, ConfidenceType.INFERRED)


def mark_intel_item_refuted(username: str, item_id: str) -> Optional[StakeholderIntelItem]:
    """Test a hypothesis, tag wrong (D49): the guess did not hold up. Never reveals the true tag -
    the player has to re-tag and try again."""
    return _set_intel_confidence(username, item_id, ConfidenceType.REFUTED)


def _resolve_source(item: StakeholderIntelItem) -> IntelSource:
    """Where the item came from, repaired for saves written before provenance was tracked.

    The persisted value only exists on items written since, and the known-intel loader repairs
    items for the *current* challenge only, so saves in progress would keep showing the wrong
    story on earlier challenges. Fall back to the artifact config, which is the source of truth:
    an `is_known` artifact never reaches the player's tagging deck, so it can only be public
    record.
    """
    source = getattr(item, "source", None)
    if source == IntelSource.PUBLIC_RECORD:
        return source
    artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(item.id)
    if artifact and artifact.is_known:
        return IntelSource.PUBLIC_RECORD
    return source or IntelSource.OFFLINE_ARTIFACT


def _artifact_type_for(item: StakeholderIntelItem) -> str:
    """The kind of document the player read this off, for the note's caption.

    Empty when the requirement has no artifact in the config: the caption falls back to a
    generic line rather than naming a document that does not exist.
    """
    artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(item.id)
    if not artifact:
        return ""
    art_type = artifact.artifact_type
    return art_type.value if hasattr(art_type, "value") else str(art_type)


def speaker_of(item) -> Optional[str]:
    """Whose page a note goes on when the player files it as a stance: its stakeholder, or the
    narrator a Fact was voiced by. None for a Fact nobody voices."""
    if item.stakeholder_id:
        return item.stakeholder_id
    artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(item.id)
    return artifact.narrator_id if artifact else None


def _stakeholder_or_none(stakeholder_id: Optional[str]):
    if not stakeholder_id:
        return None
    try:
        return StakeholderFactory.get_stakeholder(stakeholder_id)
    except Exception:
        return None


def _enum_value(value) -> Optional[str]:
    return getattr(value, "value", value) if value is not None else None


def _debug_artifact(requirement_id: str) -> Optional[Dict[str, Any]]:
    """The artifact a note is read off, for the dossier answer key."""
    artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(requirement_id)
    if not artifact:
        return None
    return {
        "id": artifact.id,
        "artifact_type": _enum_value(artifact.artifact_type),
        "speaker_id": artifact.speaker_id,
        "is_known": artifact.is_known,
        "content": artifact.content,
    }


def _debug_requirement(req: StakeholderRequirement) -> Dict[str, Any]:
    """What an authored item really is. Only ever sent when ENABLE_DOSSIER_DEBUG is on."""
    target, level = item_target_and_level(req)
    return {
        "id": req.id,
        "correct_tag": _enum_value(req.type),
        "description": req.description,
        "target": target,
        "level": level,
        "stakeholder_id": req.stakeholder_id,
        "refines_id": req.refines_id,
        "artifact": _debug_artifact(req.id),
    }


def _debug_missing(requirements: List[StakeholderRequirement], held_ids: set) -> List[Dict[str, Any]]:
    return [_debug_requirement(r) for r in requirements if r.id not in held_ids]


async def retrieve_dossier_data(curr_challenge: Challenge, ws: WebSocket) -> List[Dict[str, Any]]:
    """Retrieves full dossier summary data for all stakeholders in the current challenge.

    The dossier is persistent (plan 05): notes found in earlier phases stay, notes on the same
    target chain into one growing card, and anything the player filed as a Fact goes to its own
    environment page grouped by stage. Placement follows the player's own tag, never the true
    one, so the page a note sits on can never give the answer away.
    """
    username = ws.query_params["username"]
    collected_items = await retrieve_intel_items(curr_challenge, ws)
    # This challenge's notes win where the archive holds the same id: they are the fresher read.
    items_by_id: Dict[str, StakeholderIntelItem] = {
        i.id: i for i in _archived_items(username, getattr(curr_challenge, "phase_id", None))
    }
    items_by_id.update({i.id: i for i in collected_items})
    all_items = list(items_by_id.values())

    snapshot = _graph_snapshot(username)
    chains = chain_index(all_items)
    successors = authored_successors()
    held_ids = set(items_by_id)
    conflict = getattr(curr_challenge, "conflict", None)
    focus_stage_ids = list(getattr(curr_challenge, "focus_stage_ids", None) or [])
    # Read once per call so tests can flip the flag on the settings object.
    debug_on = settings.ENABLE_DOSSIER_DEBUG

    def _entry(item: StakeholderIntelItem) -> Dict[str, Any]:
        intel_type_val = item.intel_type.value if hasattr(item.intel_type, "value") else str(item.intel_type)
        cat_type_val = item.categorized_type.value if hasattr(item.categorized_type, "value") else str(item.categorized_type)
        is_verified = (item.intel_type == ConfidenceType.VERIFIED or str(item.intel_type).lower() == "verified")
        display_desc = item.description if is_verified else (item.categorized_description if item.categorized_description else item.description)
        shown_fact, shown_reading = item.shown_parts()
        chain = chains.get(item.id, {})
        target = item_target(item)
        stage_id, stage_name = stage_of_target(snapshot, target)
        debug_fields = {"debug": _debug_requirement(item)} if debug_on else {}
        return {
            **debug_fields,
            "id": item.id,
            "intel_type": intel_type_val,
            "categorized_type": cat_type_val,
            "description": display_desc,
            "fact": shown_fact,
            "reading": shown_reading,
            "is_correct": item.is_correct_intel(),
            "source": _resolve_source(item).value,
            "artifact_type": _artifact_type_for(item),
            "refines_id": item.refines_id,
            "chain_id": chain.get("chain_id", item.id),
            "chain_position": chain.get("chain_position", 0),
            "chain_length": chain.get("chain_length", 1),
            # Only the newest link carries the locked count, because that is the row it draws.
            "locked_links": (
                locked_links_ahead(item.id, held_ids, successors)
                if chain.get("chain_newest", True) else 0
            ),
            # Notes stored before the stamp existed still know which challenge they belong to.
            "discovered_phase_id": (
                item.discovered_phase_id
                if item.discovered_phase_id is not None
                else _phase_of_challenge(item.challenge_id)
            ),
            "target": target,
            "stage_id": stage_id,
            "stage_name": stage_name,
            "status": item_status(item, snapshot),
            "contested": is_contested(item, conflict),
        }

    stakeholder_intel_map: Dict[str, List[Dict[str, Any]]] = {}
    environment_entries: List[Dict[str, Any]] = []
    for item in all_items:
        filed_as_fact = item.categorized_type == IntelTag.FACT
        # A Fact filed as a stance goes on its narrator's page. On the System page it would give
        # the true tag away.
        page = None if filed_as_fact else speaker_of(item)
        if page:
            stakeholder_intel_map.setdefault(page, []).append(_entry(item))
        else:
            environment_entries.append(_entry(item))



    session_archs = {}
    if username:
        from mlops_serious_game.infrastructure.websocket.handlers.game_handler import get_or_create_game_session
        with get_session() as db_session:
            sess_rec = get_or_create_game_session(username, db_session)
            session_archs = dict(sess_rec.stakeholder_archetypes or {})

    phase = PhaseFactory.get_phases()[curr_challenge.phase_id]
    ph_st_map = {ps.stakeholder_id: ps for ps in phase.stakeholders}
    active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id) or StakeholderFactory.get_available_stakeholders()

    dossier_list = []
    for st_id in active_st_ids:
        st = StakeholderFactory.get_stakeholder(st_id)
        if not st:
            continue
        ch_st = ph_st_map.get(st.id)
        intel_entries = stakeholder_intel_map.get(st_id, [])

        st_arch_entry = session_archs.get(st_id, {})
        cat_arch = st_arch_entry.get("categorized_archetype")
        real_arch = st_arch_entry.get("real_archetype") or getattr(st, 'convincer_archetype', '')
        # Verified comes from the pitch, never from the tag matching: that would give the answer away.
        is_val = bool(cat_arch and st_arch_entry.get("verified"))
        status = "validated" if is_val else ("unconfirmed" if cat_arch else "unknown")
        st_pool = RequirementFactory.get_requirements_for_stakeholder_in_challenge(curr_challenge.id, st.id)

        debug_fields = {}
        if debug_on:
            arch_artifact = ConvincerArchetypeArtifactFactory.get_artifact_for_archetype(real_arch)
            debug_fields = {"debug": {
                "real_archetype": real_arch or None,
                "player_archetype": cat_arch,
                "archetype_hint": (
                    arch_artifact.convincer_archetype_artifact.replace("{stakeholder_name}", st.name)
                    if arch_artifact else None
                ),
                "missing_intel": _debug_missing(st_pool, held_ids),
            }}

        dossier_list.append({
            **debug_fields,
            "stakeholder_id": st.id,
            "name": st.name,
            "responsibilities": st.responsibilities,
            "priorities": st.priorities,
            "constraints": getattr(st, 'constraints', getattr(st, 'requirements', "")),
            "role_description": st.role_description,
            "metric_id": st.metric_id,
            "convincer_archetype": cat_arch or "",
            "is_validated": is_val,
            "convincer_status": status,
            "power": ch_st.power if ch_st else "low",
            "interest": ch_st.interest if ch_st else "low",
            "intel_items": intel_entries,
            # The whole pool for this challenge, found or not, so the dossier can show how much
            # is still out there. A count only: nothing about what the missing items say. Notes
            # carried over from earlier phases are already found, so they can only raise it.
            "intel_total": max(len(st_pool), len(intel_entries)),
            "focus_stage_ids": focus_stage_ids,
        })

    if environment_entries:
        fact_pool = [
            r for r in RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            if r.type == IntelTag.FACT
        ]
        debug_fields = {"debug": {"missing_intel": _debug_missing(fact_pool, held_ids)}} if debug_on else {}
        dossier_list.append({
            **debug_fields,
            "stakeholder_id": ENVIRONMENT_ENTRY_ID,
            "is_environment": True,
            "name": "The System",
            "role_description": "What you have found out about the pipeline itself",
            "responsibilities": "",
            "priorities": "",
            "constraints": "",
            "metric_id": "",
            "intel_items": environment_entries,
            "intel_total": max(len(fact_pool), len(environment_entries)),
            "focus_stage_ids": focus_stage_ids,
        })

    return dossier_list


def determine_dialogue_options(
    discovered_intel_items: Optional[list[Any]] = None,
) -> list[DialogueOption]:
    """Determines 4 distinct dialogue options (intel-based and corporate noise) for the player outside of LangGraph.

    Selects up to 2 discovered intel items and fills the remaining slots with random corporate noise archetypes.
    Concrete prompts are NOT generated here; they are determined dynamically inside the debate graph once chosen.
    """
    options: list[DialogueOption] = []
    items = list(discovered_intel_items or [])
    selected_intels = []

    if items:
        k = min(2, len(items))
        selected_intels = random.sample(items, k)
        for idx, item in enumerate(selected_intels, 1):
            if isinstance(item, dict):
                item_id = item.get("id")
                item_desc = item.get("categorized_description") or item.get("description", "")
                st_id = item.get("stakeholder_id")
                intel_type = (
                    item.get("intel_type")
                    or item.get("categorized_type")
                )
            else:
                item_id = getattr(item, "id", None)
                item_desc = getattr(item, "categorized_description", "") or getattr(item, "description", "")
                st_id = getattr(item, "stakeholder_id", None)
                intel_type = (
                    getattr(item, "intel_type", None)
                    or getattr(item, "categorized_type", None)
                )

            if hasattr(intel_type, "value"):
                intel_type = intel_type.value

            if not item_id:
                item_id = f"intel_{st_id}_{idx}" if st_id else f"intel_{idx}"

            st_obj = None
            if st_id:
                try:
                    st_obj = StakeholderFactory.get_stakeholder(st_id)
                except Exception:
                    st_obj = None

            if st_obj:
                st_name = st_obj.name
            elif st_id:
                st_name = " ".join([w.capitalize() for w in st_id.split("_")])
            else:
                st_name = "Stakeholder"

            options.append(
                DialogueOption(
                    id=f"opt_intel_{idx}_{uuid.uuid4().hex[:6]}",
                    type="intel",
                    text=None,
                    intel_item_id=str(item_id) if item_id else None,
                    intel_description=str(item_desc) if item_desc else None,
                    intel_stakeholder_id=str(st_id) if st_id else None,
                    intel_stakeholder_name=str(st_name) if st_name else None,
                    intel_type=str(intel_type) if intel_type else None,
                )
            )

    all_archetypes = list(EmotionFactory.get_convincer_archetypes().values())
    needed_noise = 4 - len(selected_intels)
    assigned_archetypes = random.sample(
        all_archetypes, min(needed_noise, len(all_archetypes))
    )

    for idx, arch in enumerate(assigned_archetypes, 1):
        options.append(
            DialogueOption(
                id=f"opt_noise_{idx}_{uuid.uuid4().hex[:6]}",
                type="corporate_noise",
                text=None,
                archetype=arch,
            )
        )

    random.shuffle(options)
    return options

def fact_targets_to_observe(items: List[StakeholderIntelItem]) -> List[str]:
    """Graph targets revealed by Facts the player filed as Facts. A Fact filed under a person
    reveals nothing: the player treated it as someone's opinion, not as the state of the system."""
    targets: List[str] = []
    for item in items:
        if item.type == IntelTag.FACT and item.categorized_type == IntelTag.FACT and item.asserts:
            if item.asserts.target not in targets:
                targets.append(item.asserts.target)
    return targets


def observe_tagged_facts(curr_challenge: Challenge, username: str) -> list["GameEvent"]:
    """Lifts the fog on what correctly tagged Facts describe. Runs once when the player leaves
    offline intel gathering, so the graph does not reveal which tags were right while tagging.

    Returns the event log's record of it (plan 11, step 10) - empty when there was nothing to
    reveal, or when this challenge's facts were already observed on an earlier call."""
    from mlops_serious_game.application.graph_service import store as graph_store
    from mlops_serious_game.domain.event import GameEvent
    from mlops_serious_game.domain.graph import GraphOp

    source_id = f"facts:{curr_challenge.template_id}"
    if graph_store.has_batch(username, source_id):
        return []
    with get_session() as session:
        records = session.scalars(
            select(IntelItem).where(IntelItem.user_id == get_user_id(session, username))
        ).all()
        items = []
        for r in records:
            if isinstance(r.intel_item_data, dict) and r.intel_item_data.get("challenge_id") == curr_challenge.id:
                try:
                    items.append(StakeholderIntelItem(**r.intel_item_data))
                except Exception:
                    continue
    targets = fact_targets_to_observe(items)
    if not targets:
        return []
    graph_store.append_ops(
        username,
        [GraphOp(kind="observe", target=t, source_kind="intel", source_id=source_id) for t in targets],
        phase_index=curr_challenge.phase_id,
        challenge_template=curr_challenge.template_id,
        source_kind="intel",
        source_id=source_id,
    )
    return [GameEvent(
        step="offline", kind="graph", direction="none", cause="graph.facts_observed",
        params={"n": str(len(targets))},
    )]
