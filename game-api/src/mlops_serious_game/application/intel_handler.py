
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
    TradeOffBranch,
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
from mlops_serious_game.application.pitch_debate_service.chains import (
    get_wrong_intel_chain,
    get_intel_artifact_chain,
)
from mlops_serious_game.application.pitch_debate_service.state import DialogueOption
from mlops_serious_game.application.services.auth_service import PLAYER_COOKIE_NAME, verify_player_token
from mlops_serious_game.infrastructure.database import IntelItem, GameSession, get_session, get_user_id
from mlops_serious_game.infrastructure.database.run_scope import current_run_index, run_chain
from mlops_serious_game.config import settings


def _username_from_ws(ws: WebSocket) -> str:
    """The websocket handshake authenticates off the `mlops_player` cookie alone now, not a
    `username` query param (docs/plans/session-persistence-and-url-routing.md, D-ws-cookie) - this
    is the one place left that re-derives it from the connection instead of taking it as an
    already-resolved argument."""
    username = verify_player_token(ws.cookies.get(PLAYER_COOKIE_NAME))
    if username is None:
        raise ValueError("No valid player session on this websocket connection.")
    return username


def intel_rows(session, user_id: int, run_index: Optional[int] = None):
    """Every intel row this run can see (docs/plans/results-screen.md, D11).

    Scoped to the run chain rather than a single run: a fresh start opens an empty dossier, a
    spiral run keeps the notes that explain the system it carried over, and the results screen
    can read a finished run by passing its `run_index`.
    """
    return session.scalars(
        select(IntelItem).where(
            IntelItem.user_id == user_id,
            IntelItem.run_index.in_(run_chain(session, user_id, run_index)),
        )
    ).all()


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


# The deck stays short: a few stances. Facts never reach it - the player cannot tag one.
MAX_STANCE_ARTIFACTS = 3


def deal_unconfirmed_artifacts(curr_challenge: Challenge, artifacts: list) -> list:
    """The artifacts the player tags themselves: up to three stances, never a Fact."""
    stances = []
    for art in artifacts:
        req = RequirementFactory.get_requirement(art.requirement_id)
        if req is None or req.type != IntelTag.FACT:
            stances.append(art)
    return stances[:MAX_STANCE_ARTIFACTS]


def _deck_debug(requirement_id: str) -> Dict[str, Any]:
    """Answer key for one card in the offline deck. Empty unless ENABLE_DOSSIER_DEBUG is on."""
    if not settings.ENABLE_DOSSIER_DEBUG:
        return {}
    req = RequirementFactory.get_requirement(requirement_id)
    return {"debug": _debug_requirement(req)} if req else {}


async def generate_offline_intel_artifacts(curr_challenge: Challenge, username: str = None) -> List[Dict[str, Any]]:
    """Loads offline intel artifacts for the current challenge.

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


def load_known_intel_items_for_challenge(
    curr_challenge: Challenge, username: str
) -> tuple[List[StakeholderIntelItem], List[StakeholderIntelItem]]:
    """Loads all is_known==True intel items for the current challenge into the DB as verified.

    Returns `(all_known_items, newly_added_items)`: the first is every known item for this
    challenge (freshly added or already on record), the same as this function always returned;
    the second is only the ones actually written to the DB by this call, so a caller that wants to
    log "this just went on the record" doesn't repeat itself on every re-entry into the same
    challenge (e.g. `handle_get_offline_artifacts` firing again on a reconnect).
    """
    known_artifacts = [
        art for art in OfflineIntelArtifactFactory.get_artifacts_for_challenge(curr_challenge.id)
        if art.is_known
    ]
    if not known_artifacts:
        return [], []

    loaded_items: List[StakeholderIntelItem] = []
    newly_added: List[StakeholderIntelItem] = []
    with get_session() as session:
        user_id = get_user_id(session, username)
        records = intel_rows(session, user_id)
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
                    run_index=current_run_index(session, user_id),
                    intel_item_data=new_item.model_dump(mode="json"),
                )
                session.add(new_record)
                existing_ids.add(req.id)
                loaded_items.append(new_item)
                newly_added.append(new_item)
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
    return loaded_items, newly_added


# ── Plan 05: Persistent dossier ───────────────────────────────────────────────


def _left_behind_demo(item: StakeholderIntelItem, current_phase: int) -> bool:
    """Whether the note came from a demo phase the player has since moved past. Those rows stay
    in the database for the results screens, but the dossier starts empty once the demo is over."""
    phase_id = item.discovered_phase_id
    if phase_id is None:
        try:
            phase_id = PhaseFactory.get_challenge_by_id(item.challenge_id).phase_id
        except ValueError:
            return False
    return phase_id in PhaseFactory.demo_phase_ids() and phase_id < current_phase


def load_known_intel_items(username: str, up_to_phase: Optional[int] = None) -> List[StakeholderIntelItem]:
    """Return all intel items the player has ever collected, across all phases.

    If `up_to_phase` is given, only items with `discovered_phase_id <= up_to_phase` are returned
    (items without the field are always included for backward compatibility).
    """
    with get_session() as session:
        records = intel_rows(session, get_user_id(session, username))
        items: List[StakeholderIntelItem] = []
        dirty = False
        for r in records:
            if not isinstance(r.intel_item_data, dict):
                continue
            try:
                item = StakeholderIntelItem(**r.intel_item_data)
            except Exception:
                continue
            # Heal items where branch_x/branch_y are set but the categorized_type is not trade_off.
            if item.categorized_type != IntelTag.TRADE_OFF and (item.branch_x or item.branch_y):
                item.branch_x = None
                item.branch_y = None
                data = dict(r.intel_item_data)
                data.pop("branch_x", None)
                data.pop("branch_y", None)
                r.intel_item_data = data
                flag_modified(r, "intel_item_data")
                dirty = True
            # Heal items that are verified-and-tagged-trade_off but whose true type is not trade_off.
            # This can happen when verification set intel_type=verified without correcting categorized_type.
            elif (
                item.categorized_type == IntelTag.TRADE_OFF
                and str(getattr(item.intel_type, "value", item.intel_type)).lower() == "verified"
            ):
                req = RequirementFactory.get_requirement(item.id)
                if req and req.type != IntelTag.TRADE_OFF:
                    data = dict(r.intel_item_data)
                    true_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)
                    data["categorized_type"] = true_type_str
                    data["description"] = req.description
                    data["categorized_description"] = req.description
                    data.pop("branch_x", None)
                    data.pop("branch_y", None)
                    r.intel_item_data = data
                    flag_modified(r, "intel_item_data")
                    item.categorized_type = req.type
                    item.description = req.description
                    item.categorized_description = req.description
                    item.branch_x = None
                    item.branch_y = None
                    dirty = True
            if up_to_phase is not None and item.discovered_phase_id is not None:
                if item.discovered_phase_id > up_to_phase:
                    continue
            if up_to_phase is not None and _left_behind_demo(item, up_to_phase):
                continue
            items.append(item)
        if dirty:
            session.commit()
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


# The Challenge-Intel page rides in the same list as the stakeholder pages, because the payload
# is a list of pages and every screen that shows the dossier just forwards it.
CHALLENGE_INTEL_ENTRY_ID = "__challenge_intel__"


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


def _effective_level(snapshot, target: str, axis: str) -> Optional[int]:
    graph, _state, evaluation = snapshot
    resolved = graph.resolve(target)
    source = evaluation.effective.automation if axis == "automation" else evaluation.effective.governance
    return source.get(resolved)


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
    """open, addressed or stale: read off the graph every time, never stored."""
    if snapshot is None:
        return "open"
    try:
        if item.type == IntelTag.FACT and item.asserts is not None and item.asserts.level is not None:
            level = _effective_level(snapshot, item.asserts.target, item.asserts.axis)
            return "stale" if level is not None and level != item.asserts.level else "open"
        if item.type == IntelTag.DRIVER and item.suggested is not None:
            level = _effective_level(snapshot, item.suggested.target, item.suggested.axis)
            return "addressed" if level is not None and level >= item.suggested.level else "open"
    except Exception:
        return "open"
    return "open"


def _holds_op(item) -> Optional[str]:
    """The comparator a Boundary's `holds` was authored with, if any."""
    holds = getattr(item, "holds", None)
    if isinstance(holds, dict):
        return holds.get("op")
    return getattr(holds, "op", None) if holds is not None else None


def carried_over_status(item, snapshot) -> str:
    """addressed or stale for a note left over from an earlier challenge (Dossier phase scoping).

    A note whose challenge has already passed is never still "open" for the current one: either
    the graph shows its condition was met (DONE) or it wasn't and the moment for it has gone
    (OUT OF DATE). Reuses the existing addressed/stale vocabulary and badges rather than inventing
    a parallel status the frontend would need new handling for.
    """
    target, level, axis = item_target_and_level(item)
    if snapshot is None or target is None or level is None or axis is None:
        return "stale"
    try:
        effective = _effective_level(snapshot, target, axis)
        if effective is None:
            return "stale"
        if item.type == IntelTag.FACT:
            return "addressed" if effective == level else "stale"
        op = _holds_op(item) if item.type == IntelTag.BOUNDARY else None
        if op == "eq":
            met = effective == level
        elif op == "lte":
            met = effective <= level
        else:
            met = effective >= level
        return "addressed" if met else "stale"
    except Exception:
        return "stale"


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
        username = _username_from_ws(ws)
        user_id = get_user_id(session, username)
        records = intel_rows(session, user_id)

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
                run_index=current_run_index(session, user_id),
                intel_item_data=dict(item_dict)
            )
            session.add(new_record)
        session.commit()



async def retrieve_intel_items(curr_challenge: Challenge, ws: WebSocket) -> List[StakeholderIntelItem]:
    """Retrieves intel items for the current challenge."""
    intel_items: List[StakeholderIntelItem] = []

    with get_session() as session:
        records = intel_rows(session, get_user_id(session, _username_from_ws(ws)))

        dirty = False
        for record in records:
            data = record.intel_item_data
            if isinstance(data, dict):
                item = StakeholderIntelItem(**data)
                # Heal items where branch_x/branch_y are set but categorized_type is not trade_off.
                if item.categorized_type != IntelTag.TRADE_OFF and (item.branch_x or item.branch_y):
                    item.branch_x = None
                    item.branch_y = None
                    clean_data = dict(data)
                    clean_data.pop("branch_x", None)
                    clean_data.pop("branch_y", None)
                    record.intel_item_data = clean_data
                    flag_modified(record, "intel_item_data")
                    dirty = True
                # Heal verified items still tagged as trade_off when true type is not trade_off.
                elif (
                    item.categorized_type == IntelTag.TRADE_OFF
                    and str(getattr(item.intel_type, "value", item.intel_type)).lower() == "verified"
                ):
                    req = RequirementFactory.get_requirement(item.id)
                    if req and req.type != IntelTag.TRADE_OFF:
                        true_type_str = req.type.value if hasattr(req.type, "value") else str(req.type)
                        clean_data = dict(data)
                        clean_data["categorized_type"] = true_type_str
                        clean_data["description"] = req.description
                        clean_data["categorized_description"] = req.description
                        clean_data.pop("branch_x", None)
                        clean_data.pop("branch_y", None)
                        record.intel_item_data = clean_data
                        flag_modified(record, "intel_item_data")
                        item.categorized_type = req.type
                        item.description = req.description
                        item.categorized_description = req.description
                        item.branch_x = None
                        item.branch_y = None
                        dirty = True
                if item.challenge_id == curr_challenge.id:
                    intel_items.append(item)
        if dirty:
            session.commit()

    return intel_items



def invent_trade_off_branches(
    curr_challenge: Challenge,
    intel_item: StakeholderIntelItem,
    req: Optional[StakeholderRequirement] = None,
) -> tuple[TradeOffBranch, TradeOffBranch, str]:
    """Invents two believable commitment branches when an item is miscategorized as a trade-off."""
    stakeholder = StakeholderFactory.get_stakeholder(intel_item.stakeholder_id) if intel_item.stakeholder_id else None
    st_name = stakeholder.name if stakeholder else "The team"

    primary_target, primary_level, primary_axis = item_target_and_level(req or intel_item)
    if not primary_target:
        primary_target = "data.validation"
        primary_level = 3
        primary_axis = "automation"
    else:
        primary_level = primary_level if primary_level is not None else 3
        primary_axis = primary_axis or "automation"

    # Find an alternative component target in the challenge
    all_challenge_reqs = RequirementFactory.get_requirements_for_challenge(curr_challenge.id) if curr_challenge else []
    alt_target = None
    alt_level = 2
    alt_axis = "automation"
    for r in all_challenge_reqs:
        t, l, a = item_target_and_level(r)
        if t and t != primary_target:
            alt_target = t
            alt_level = l if l is not None else 2
            alt_axis = a or "automation"
            break

    if not alt_target:
        alt_target = "ops.alerting" if primary_target != "ops.alerting" else "req.acceptance_criteria"
        alt_level = 2
        alt_axis = "automation"

    def _pretty_name(target_str: str) -> str:
        parts = target_str.split(".")
        return parts[-1].replace("_", " ").title()

    t1_name = _pretty_name(primary_target)
    t2_name = _pretty_name(alt_target)

    branch_x_desc = f"automating {t1_name.lower()}"
    branch_y_desc = f"maintaining basic {t2_name.lower()}"

    branch_x = TradeOffBranch(
        name=f"Automate {t1_name}",
        description=branch_x_desc,
        target=primary_target,
        level=primary_level,
        ops=[{"kind": "raise_to", "target": primary_target, "axis": primary_axis, "value": primary_level}],
        atoms=[f"raise_to({primary_target}, {primary_level})"],
    )

    branch_y = TradeOffBranch(
        name=f"Basic {t2_name}",
        description=branch_y_desc,
        target=alt_target,
        level=alt_level,
        ops=[{"kind": "raise_to", "target": alt_target, "axis": alt_axis, "value": alt_level}],
        atoms=[f"raise_to({alt_target}, {alt_level})"],
    )

    description = f"{st_name} would compromise {branch_x_desc} for {branch_y_desc}."
    return branch_x, branch_y, description


async def handle_intel_item_categorization(curr_challenge: Challenge, ws: WebSocket, intel_item: StakeholderIntelItem) -> None:
    """Handles the categorization of intel items using pre-generated descriptions when available."""
    cat_type = intel_item.categorized_type.value if hasattr(intel_item.categorized_type, "value") else str(intel_item.categorized_type)
    true_type = intel_item.type.value if hasattr(intel_item.type, "value") else str(intel_item.type)
    req = RequirementFactory.get_requirement(intel_item.id)

    if cat_type == "trade_off":
        if true_type == "trade_off" and req and req.branch_x and req.branch_y:
            intel_item.branch_x = req.branch_x
            intel_item.branch_y = req.branch_y
            intel_item.categorized_description = req.description
        else:
            intel_item.branch_x, intel_item.branch_y, intel_item.categorized_description = invent_trade_off_branches(
                curr_challenge, intel_item, req
            )
    else:
        intel_item.branch_x = None
        intel_item.branch_y = None
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
    if categorized_type == IntelTag.FACT.value:
        raise ValueError("Facts cannot be tagged by the player.")
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
        if req.type == IntelTag.TRADE_OFF:
            target_item.branch_x = req.branch_x
            target_item.branch_y = req.branch_y
        else:
            target_item.branch_x = None
            target_item.branch_y = None
    elif target_item.categorized_type != IntelTag.TRADE_OFF:
        target_item.branch_x = None
        target_item.branch_y = None

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
        records = intel_rows(session, user_id)

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
            if cat_type_str == "trade_off":
                if req.branch_x:
                    data["branch_x"] = req.branch_x.model_dump(mode="json") if hasattr(req.branch_x, "model_dump") else req.branch_x
                if req.branch_y:
                    data["branch_y"] = req.branch_y.model_dump(mode="json") if hasattr(req.branch_y, "model_dump") else req.branch_y
            else:
                data.pop("branch_x", None)
                data.pop("branch_y", None)
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


def _branch_payload(branch) -> Optional[Dict[str, Any]]:
    """A stored trade-off branch for the UI, with name tokens rendered for the current player.

    Rows written before branches were personalized still hold raw `{stakeholder_id}` tokens.
    """
    if not branch:
        return None
    data = branch.model_dump(mode="json") if hasattr(branch, "model_dump") else dict(branch)
    data["description"] = personalize(data.get("description"))
    return data


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


def _stakeholder_pool(challenge_id: int, stakeholder_id: str) -> List[StakeholderRequirement]:
    """Everything that can end up on this stakeholder's dossier page for this challenge: their own
    stances. Facts live on the Challenge-Intel page, never here."""
    return RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge_id, stakeholder_id)


def _is_known_fact(req: StakeholderRequirement) -> bool:
    """A pre-authored Fact known from the start of the challenge (Challenge-Intel)."""
    if req.type != IntelTag.FACT:
        return False
    artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(req.id)
    return bool(artifact and artifact.is_known)


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
        "humor_archetype": artifact.humor_archetype,
        "humor_verdict": artifact.humor_verdict,
        "humor_review_reason": artifact.humor_review_reason,
    }


def _debug_requirement(req: StakeholderRequirement) -> Dict[str, Any]:
    """What an authored item really is. Only ever sent when ENABLE_DOSSIER_DEBUG is on."""
    target, level, axis = item_target_and_level(req)
    return {
        "id": req.id,
        "correct_tag": _enum_value(req.type),
        "description": req.description,
        "target": target,
        "level": level,
        "axis": axis,
        "stakeholder_id": req.stakeholder_id,
        "refines_id": req.refines_id,
        "artifact": _debug_artifact(req.id),
    }


def _debug_missing(requirements: List[StakeholderRequirement], held_ids: set) -> List[Dict[str, Any]]:
    return [_debug_requirement(r) for r in requirements if r.id not in held_ids]


async def retrieve_dossier_data(curr_challenge: Challenge, ws: WebSocket) -> List[Dict[str, Any]]:
    """Retrieves full dossier summary data for all stakeholders in the current challenge.

    The dossier is persistent (plan 05): notes found in earlier phases stay, notes on the same
    target chain into one growing card, and Facts go to their own Challenge-Intel page grouped by
    stage. The player cannot tag a Fact, so the true tag decides the page.
    """
    username = _username_from_ws(ws)
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
    focus_stage_ids = list(getattr(curr_challenge, "focus_stage_ids", None) or [])
    # Read once per call so tests can flip the flag on the settings object.
    debug_on = settings.ENABLE_DOSSIER_DEBUG

    # Per-target totals (analogous to the per-stakeholder `intel_total` below), so the composer
    # and performance dashboard can honestly show "N of M found" for a single component/edge
    # instead of just a found count. Same `max(pool, held)` guard as `intel_total`: notes carried
    # over from an earlier phase can only raise the count, never make it look incomplete.
    target_pool_counts: Dict[str, int] = {}
    for req in RequirementFactory.get_requirements_for_challenge(curr_challenge.id):
        t = item_target(req)
        if t:
            target_pool_counts[t] = target_pool_counts.get(t, 0) + 1
    target_held_counts: Dict[str, int] = {}
    for held_item in all_items:
        t = item_target(held_item)
        if t:
            target_held_counts[t] = target_held_counts.get(t, 0) + 1
    target_intel_totals: Dict[str, int] = {
        t: max(target_pool_counts.get(t, 0), target_held_counts.get(t, 0))
        for t in set(target_pool_counts) | set(target_held_counts)
    }

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
        artifact = OfflineIntelArtifactFactory.get_artifact_for_requirement(item.id)
        artifact_dict = None
        if artifact:
            artifact_dict = {
                "id": artifact.id,
                "requirement_id": artifact.requirement_id,
                "stakeholder_id": artifact.speaker_id,
                "stakeholder_name": artifact.stakeholder_name,
                "stakeholder_role": artifact.stakeholder_role,
                "artifact_type": artifact.artifact_type.value if hasattr(artifact.artifact_type, "value") else str(artifact.artifact_type),
                "content": artifact.content,
                "is_known": artifact.is_known,
            }
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
            "artifact": artifact_dict,
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
            # How many intel items exist about this graph target in total, found or not - the
            # per-target counterpart to the per-stakeholder `intel_total` on the dossier entry.
            "target_total": target_intel_totals.get(target) if target else None,
            "stage_id": stage_id,
            "stage_name": stage_name,
            # A note whose challenge has already passed is never still "open" for this one - it's
            # DONE or OUT OF DATE, not an active stance to weigh here (see carried_over_status).
            "status": (
                carried_over_status(item, snapshot)
                if item.challenge_id != curr_challenge.id
                else item_status(item, snapshot)
            ),
            "branch_x": _branch_payload(item.branch_x) if cat_type_val == "trade_off" else None,
            "branch_y": _branch_payload(item.branch_y) if cat_type_val == "trade_off" else None,
        }

    stakeholder_intel_map: Dict[str, List[Dict[str, Any]]] = {}
    challenge_intel_entries: List[Dict[str, Any]] = []
    for item in all_items:
        is_challenge_intel = item.type == IntelTag.FACT
        page = None if is_challenge_intel else speaker_of(item)
        if page:
            stakeholder_intel_map.setdefault(page, []).append(_entry(item))
        else:
            challenge_intel_entries.append(_entry(item))


    phase = PhaseFactory.get_phases()[curr_challenge.phase_id]
    ph_st_map = {ps.stakeholder_id: ps for ps in phase.stakeholders}
    active_st_ids = StakeholderFactory.get_active_stakeholders(curr_challenge.phase_id) or StakeholderFactory.get_available_stakeholders()
    if not phase.demo:
        # The demo's cast is gone from the dossier once the demo is over.
        gone = PhaseFactory.demo_only_stakeholder_ids()
        active_st_ids = [st_id for st_id in active_st_ids if st_id not in gone]

    dossier_list = []
    for st_id in active_st_ids:
        st = StakeholderFactory.get_stakeholder(st_id)
        if not st:
            continue
        ch_st = ph_st_map.get(st.id)
        intel_entries = stakeholder_intel_map.get(st_id, [])
        st_pool = _stakeholder_pool(curr_challenge.id, st.id)

        debug_fields = {}
        if debug_on:
            debug_fields = {"debug": {
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
            "power": ch_st.power if ch_st else "low",
            "interest": ch_st.interest if ch_st else "low",
            "intel_items": intel_entries,
            # This challenge's own pool only, found or not - the pitch deck's `intel_total` is
            # scoped the same way (`ctx.all_intel` from `get_requirements_for_challenge`), so the
            # two numbers agree. Carryover from earlier phases can still show up in `intel_items`
            # (plan 05), it just no longer inflates the denominator past what this challenge holds.
            "intel_total": len(st_pool),
            "focus_stage_ids": focus_stage_ids,
        })

    if challenge_intel_entries:
        fact_pool = [
            r for r in RequirementFactory.get_requirements_for_challenge(curr_challenge.id)
            if _is_known_fact(r)
        ]
        debug_fields = {"debug": {"missing_intel": _debug_missing(fact_pool, held_ids)}} if debug_on else {}
        dossier_list.append({
            **debug_fields,
            "stakeholder_id": CHALLENGE_INTEL_ENTRY_ID,
            "is_challenge_intel": True,
            "name": "Challenge-Intel",
            "role_description": "Facts about the system that were already on record when the challenge began",
            "responsibilities": "",
            "priorities": "",
            "constraints": "",
            "metric_id": "",
            "intel_items": challenge_intel_entries,
            "intel_total": len(fact_pool),
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

    needed_noise = 4 - len(selected_intels)
    for idx in range(1, needed_noise + 1):
        options.append(
            DialogueOption(
                id=f"opt_noise_{idx}_{uuid.uuid4().hex[:6]}",
                type="corporate_noise",
                text=None,
            )
        )

    random.shuffle(options)
    return options
