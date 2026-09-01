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
            challenge_obj = Challenge(
                id=c["id"],
                phase_id=c["phase_id"],
                name=c["name"],
                description=c["description"],
                roundIntroduction=c["roundIntroduction"],
                metric_changes=c["metric_changes"],
                attention_tokens=c["attention_tokens"],
            )
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
            )
            cls.phases.append(p)
