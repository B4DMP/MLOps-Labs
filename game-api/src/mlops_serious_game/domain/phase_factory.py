import json
from pathlib import Path

from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.Phase import Phase, PhaseStakeholder


class PhaseFactory:
    phases: list[Phase] = []
    action_card_images: list[dict] = []

    @classmethod
    def get_phases(cls) -> list[Phase]:
        return cls.phases

    @classmethod
    def get_challenge_by_id(cls, challenge_id: int) -> Challenge:
        for phase in cls.phases:
            for challenge in phase.challenges:
                if challenge.id == challenge_id:
                    return challenge
        raise ValueError(f"Challenge with ID {challenge_id} not found.")

    #provisory function, will be replaced by challengeScheduler
    @classmethod
    def translate_challenge_index(cls, phase_index: int, challenge_index: int) -> Challenge | None:
        if phase_index >= len(cls.phases):
            return None
        phase = cls.phases[phase_index]
        for challenge in phase.challenges:
            if challenge.id == challenge_index:
                return challenge
        if challenge_index < len(phase.challenges):
            return phase.challenges[challenge_index]
        return cls.translate_challenge_index(phase_index + 1, 0)

    @classmethod
    def load_phases(cls, phases_config: Path) -> None:
        with phases_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.phases.clear()
        cls.action_card_images.clear()

        for i in data.get("ActionCardImages", []):
            cls.action_card_images.append(i)

        # Load challenges first
        all_challenges = []
        for c in data.get("challenges", []):
            challenge_obj = Challenge.model_validate(c)
            all_challenges.append(challenge_obj)

        # Load phases and assign challenges + stakeholders
        for p_data in data.get("phases", []):
            phase_challenges = [ch for ch in all_challenges if ch.phase_id == p_data["id"]]
            phase_stakeholders = [
                PhaseStakeholder(
                    stakeholder_id=st["stakeholder_id"],
                    power=st["power"],
                    interest=st["interest"],
                )
                for st in p_data.get("stakeholders", [])
            ]
            p = Phase(
                id=p_data["id"],
                name=p_data["name"],
                description=p_data["description"],
                phase_introduction=p_data["phase_introduction"],
                challenges=phase_challenges,
                stakeholders=phase_stakeholders,
                challenges_per_phase=p_data.get("challenges_per_phase"),
            )
            cls.phases.append(p)

    @classmethod
    def get_challenge_by_template(cls, template_id: str) -> Challenge | None:
        for phase in cls.phases:
            for challenge in phase.challenges:
                if challenge.template_id == template_id:
                    return challenge
        return None

    @classmethod
    def validate_templates(cls, graph, pattern_ids: set[str], stakeholder_ids: set[str]) -> None:
        """Config gate for challenge templates. Needs the graph and patterns loaded."""
        from mlops_serious_game.domain.graph import GraphOp
        from mlops_serious_game.domain.graph_factory import GraphConfigError
        from mlops_serious_game.domain.graph_predicates import validate_predicate

        errors: list[str] = []
        seen: set[str] = set()
        stage_ids = {s.id for s in graph.stages}
        for phase in cls.phases:
            if phase.challenges and sum(c.fallback for c in phase.challenges) != 1:
                errors.append(f"phase {phase.id} needs exactly one fallback challenge")
            for c in phase.challenges:
                where = f"challenge '{c.template_id}'"
                if c.template_id in seen:
                    errors.append(f"duplicate template_id '{c.template_id}'")
                seen.add(c.template_id)
                for name in ("preconditions", "excluded_if"):
                    errors += [f"{where} {name}: {e}" for e in validate_predicate(getattr(c, name), graph, pattern_ids)]
                for name in ("on_enter_ops", "on_exit_ops", "stalemate_ops"):
                    for raw in getattr(c, name):
                        try:
                            op = GraphOp.model_validate(raw)
                        except Exception as e:
                            errors.append(f"{where} {name}: {e}")
                            continue
                        if not graph.is_target(graph.resolve(op.target)):
                            errors.append(f"{where} {name}: unknown target '{op.target}'")
                if c.conflict:
                    if not graph.is_target(c.conflict.target):
                        errors.append(f"{where} conflict: unknown target '{c.conflict.target}'")
                    for pos in c.conflict.positions:
                        if pos.stakeholder_id not in stakeholder_ids:
                            errors.append(f"{where} conflict: unknown stakeholder '{pos.stakeholder_id}'")
                        elif graph.is_target(c.conflict.target) and pos.wants not in graph.allowed_levels(c.conflict.target):
                            errors.append(f"{where} conflict: level {pos.wants} not allowed on '{c.conflict.target}'")
                for sid in c.focus_stage_ids:
                    if sid not in stage_ids:
                        errors.append(f"{where}: unknown focus stage '{sid}'")
        if errors:
            raise GraphConfigError("; ".join(errors))
