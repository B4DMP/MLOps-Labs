from pathlib import Path
import json
from typing import List, Optional
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.requirement import StakeholderRequirement, item_target as _payload_target
from mlops_serious_game.domain.Challenge import Challenge

class RequirementFactory:
    requirements: List[StakeholderRequirement] = []

    @staticmethod
    def _personalized(req: StakeholderRequirement) -> StakeholderRequirement:
        """Renders the stored name tokens for the player currently being served."""
        update = {"description": personalize(req.description)}
        if req.fact:
            update["fact"] = personalize(req.fact)
            update["reading"] = personalize(req.reading) if req.reading else req.reading
        return req.model_copy(update=update)

    @classmethod
    def get_requirements(cls) -> List[StakeholderRequirement]:
        return [cls._personalized(r) for r in cls.requirements]
    @classmethod
    def get_requirement(cls, id:str)->StakeholderRequirement:
        for req in cls.requirements:
            if req.id==id:
                return cls._personalized(req)
        return None

    @classmethod
    def get_requirements_for_challenge(cls, challenge_id: int) -> List[StakeholderRequirement]:
        return [cls._personalized(r) for r in cls.requirements if r.challenge_id == challenge_id]

    @classmethod
    def get_requirements_for_stakeholder_in_challenge(cls, challenge_id: int, stakeholder_id: str) -> List[StakeholderRequirement]:
        return [
            cls._personalized(r)
            for r in cls.requirements
            if r.challenge_id == challenge_id and r.stakeholder_id == stakeholder_id
        ]

    @classmethod
    def load_requirements(cls, requirements_config: Path) -> None:
        with requirements_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.requirements.clear()
        for r_data in data.get("requirements", []):
            if "id" not in r_data:
                raise ValueError("Requirement objects must have a unique 'id' field in the config file.")
            cls.requirements.append(StakeholderRequirement.model_validate(r_data))

    @classmethod
    def validate_requirements(cls, challenges: List[Challenge]) -> None:
        from mlops_serious_game.domain.phase_factory import PhaseFactory

        for challenge in challenges:
            phase = PhaseFactory.get_phases()[challenge.phase_id]
            for ph_st in phase.stakeholders:
                reqs = cls.get_requirements_for_stakeholder_in_challenge(challenge.id, ph_st.stakeholder_id)

                # Everyone in the room needs something the player can find out about them.
                if not any(r.type != "fact" for r in reqs):
                    raise ValueError(
                        f"Stakeholder '{ph_st.stakeholder_id}' in challenge '{challenge.name}' (ID: {challenge.id}) "
                        f"needs at least one stance item. Found {len(reqs)} items."
                    )

    @classmethod
    def validate_payloads(cls, graph, metric_ids: set[str], stakeholder_ids: set[str]) -> None:
        """Config gate: every payload fits its tag and points at things that exist (plan 02)."""
        from mlops_serious_game.domain.graph_factory import GraphConfigError

        errors = payload_errors(cls.requirements, graph, metric_ids, stakeholder_ids)
        if errors:
            raise GraphConfigError("; ".join(errors))


def payload_errors(requirements, graph, metric_ids: set[str], stakeholder_ids: set[str]) -> list[str]:
    """Every payload fits its tag and points at things that exist. Also used by content generation.

    Payloads are optional for stances so legacy content stays loadable; a Fact without `asserts`
    is always an error, because it would have nothing to reveal.
    """
    from mlops_serious_game.domain.graph import GraphOp
    from mlops_serious_game.domain.graph_predicates import validate_predicate
    from mlops_serious_game.domain.phase_factory import PhaseFactory
    from mlops_serious_game.domain.requirement import IntelTag

    by_id = {r.id: r for r in requirements}
    # challenge_id -> phase index, to check a chain link is authored strictly forward (D42).
    challenge_phase: dict[int, int] = {
        c.id: c.phase_id for phase in PhaseFactory.phases for c in phase.challenges
    }

    errors: list[str] = []
    ids: set[str] = set()
    for r in requirements:
        where = f"intel '{r.id}'"
        if r.id in ids:
            errors.append(f"duplicate intel id '{r.id}'")
        ids.add(r.id)

        if r.refines_id is not None:
            # D42: a chain link must match its parent's target and stakeholder, sit strictly
            # later, and only narrow (same tag, or Driver into Boundary).
            parent = by_id.get(r.refines_id)
            if parent is None:
                errors.append(f"{where}: refines unknown item '{r.refines_id}'")
            else:
                if parent.stakeholder_id != r.stakeholder_id:
                    errors.append(f"{where}: refines '{r.refines_id}' but has a different stakeholder")
                if _payload_target(parent) != _payload_target(r):
                    errors.append(f"{where}: refines '{r.refines_id}' but targets a different part of the graph")
                parent_phase = challenge_phase.get(parent.challenge_id)
                child_phase = challenge_phase.get(r.challenge_id)
                if parent_phase is not None and child_phase is not None and child_phase <= parent_phase:
                    errors.append(f"{where}: refines '{r.refines_id}' but is not in a strictly later phase")
                valid_transition = r.type == parent.type or (
                    parent.type == IntelTag.DRIVER and r.type == IntelTag.BOUNDARY
                )
                if not valid_transition:
                    errors.append(
                        f"{where}: invalid tag transition from '{parent.type.value}' to '{r.type.value}'"
                    )

        if r.type == IntelTag.FACT:
            if r.stakeholder_id is not None and r.stakeholder_id not in stakeholder_ids:
                errors.append(f"{where}: unknown stakeholder '{r.stakeholder_id}'")
            if r.asserts is None:
                errors.append(f"{where}: a Fact needs 'asserts'")
            elif not graph.is_target(graph.resolve(r.asserts.target)):
                errors.append(f"{where}: asserts unknown target '{r.asserts.target}'")
            if r.suggested or r.holds is not None or r.ops or r.concedes:
                errors.append(f"{where}: a Fact carries no stance payload")
            continue

        if r.stakeholder_id not in stakeholder_ids:
            errors.append(f"{where}: stances need a known stakeholder, got '{r.stakeholder_id}'")
        if r.asserts is not None:
            errors.append(f"{where}: only Facts carry 'asserts'")
        if r.metric_id is not None and r.metric_id not in metric_ids:
            errors.append(f"{where}: unknown metric '{r.metric_id}'")
        if r.suggested is not None:
            target = graph.resolve(r.suggested.target)
            if not graph.is_target(target):
                errors.append(f"{where}: suggests unknown target '{r.suggested.target}'")
            elif r.suggested.level not in graph.allowed_levels(target):
                errors.append(f"{where}: level {r.suggested.level} not allowed on '{target}'")
        if r.holds is not None:
            if r.type != IntelTag.BOUNDARY:
                errors.append(f"{where}: only Boundaries carry 'holds'")
            errors += [f"{where} holds: {e}" for e in validate_predicate(r.holds, graph)]
        if r.concedes is not None and r.type != IntelTag.TRADE_OFF:
            errors.append(f"{where}: only Trade-offs carry 'concedes'")
        if r.concedes is not None:
            c = r.concedes
            if c.metric_id is not None and c.metric_id not in metric_ids:
                errors.append(f"{where} concedes: unknown metric '{c.metric_id}'")
            if c.target is not None and not graph.is_target(graph.resolve(c.target)):
                errors.append(f"{where} concedes: unknown target '{c.target}'")
        if (r.branch_x is not None or r.branch_y is not None) and r.type != IntelTag.TRADE_OFF:
            errors.append(f"{where}: only Trade-offs carry 'branch_x'/'branch_y'")
        for branch_name, branch in (("branch_x", r.branch_x), ("branch_y", r.branch_y)):
            if branch is not None and branch.target is not None:
                target = graph.resolve(branch.target)
                if not graph.is_target(target):
                    errors.append(f"{where} {branch_name}: unknown target '{branch.target}'")
                elif branch.level is not None and branch.level not in graph.allowed_levels(target):
                    errors.append(f"{where} {branch_name}: level {branch.level} not allowed on '{branch.target}'")
        for raw in r.ops:
            try:
                op = GraphOp.model_validate(raw)
            except Exception as e:
                errors.append(f"{where} ops: {e}")
                continue
            if op.kind not in ("raise_to", "set_trigger", "set_attr"):
                errors.append(f"{where} ops: stances may only raise, set triggers or set attributes, not '{op.kind}'")
            elif not graph.is_target(graph.resolve(op.target)):
                errors.append(f"{where} ops: unknown target '{op.target}'")
    return errors
