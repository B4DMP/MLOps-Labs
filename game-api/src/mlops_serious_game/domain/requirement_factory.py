from pathlib import Path
import json
from typing import List
from mlops_serious_game.domain.persona_resolver import personalize
from mlops_serious_game.domain.requirement import StakeholderRequirement
from mlops_serious_game.domain.Challenge import Challenge

class RequirementFactory:
    requirements: List[StakeholderRequirement] = []

    @staticmethod
    def _personalized(req: StakeholderRequirement) -> StakeholderRequirement:
        """Renders the stored name tokens for the player currently being served."""
        return req.model_copy(update={"description": personalize(req.description)})

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

                # Check exactly 4 requirements
                if len(reqs) != 4:
                    raise ValueError(
                        f"Stakeholder '{ph_st.stakeholder_id}' in challenge '{challenge.name}' (ID: {challenge.id}) "
                        f"must have exactly 4 requirement objects. Found {len(reqs)}."
                    )

    @classmethod
    def validate_payloads(cls, graph, metric_ids: set[str], stakeholder_ids: set[str]) -> None:
        """Config gate: every payload fits its tag and points at things that exist (plan 02).

        Payloads are optional for stances so legacy content stays loadable; a Fact without
        `asserts` is always an error, because it would have nothing to reveal.
        """
        from mlops_serious_game.domain.graph import GraphOp
        from mlops_serious_game.domain.graph_factory import GraphConfigError
        from mlops_serious_game.domain.graph_predicates import validate_predicate
        from mlops_serious_game.domain.requirement import IntelTag

        errors: list[str] = []
        ids: set[str] = set()
        for r in cls.requirements:
            where = f"intel '{r.id}'"
            if r.id in ids:
                errors.append(f"duplicate intel id '{r.id}'")
            ids.add(r.id)

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
        if errors:
            raise GraphConfigError("; ".join(errors))
