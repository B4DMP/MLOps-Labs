import json
import re
from pathlib import Path

from mlops_serious_game.domain.Challenge import Challenge, ChallengeStakeholder
from mlops_serious_game.domain.Phase import Phase


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
        from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

        with phases_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.phases.clear()
        cls.action_card_images.clear()

        for i in data.get("ActionCardImages", []):
            cls.action_card_images.append(i)

        # Load challenges first
        all_challenges = []
        for c in data.get("challenges", []):
            c_stakeholders = []
            for st_data in c.get("stakeholders", []):
                c_stakeholders.append(
                    ChallengeStakeholder(
                        stakeholder_id=st_data["stakeholder_id"],
                        power=st_data["power"],
                        interest=st_data["interest"]
                    )
                )

            # Automatically set high interest for stakeholders mentioned in description
            mentioned_names = re.findall(r'#([^#]+)#', c.get("description", ""))
            for name in mentioned_names:
                st_obj = StakeholderFactory.get_stakeholder(name.strip())
                found = False
                for ch_st in c_stakeholders:
                    if ch_st.stakeholder_id == st_obj.id:
                        ch_st.interest = "high"
                        found = True
                        break
                if not found:
                    c_stakeholders.append(
                        ChallengeStakeholder(
                            stakeholder_id=st_obj.id,
                            power="low",
                            interest="high"
                        )
                    )

            # Validate: At least one stakeholder with high power in every challenge
            has_high_power = any(ch_st.power == "high" for ch_st in c_stakeholders)
            if not has_high_power:
                raise ValueError(
                    f"Challenge '{c.get('name')}' (ID: {c.get('id')}) must have at least one stakeholder with high power."
                )

            challenge_obj = Challenge(
                id=c["id"],
                phase_id=c["phase_id"],
                name=c["name"],
                description=c["description"],
                roundIntroduction=c["roundIntroduction"],
                metric_changes=c["metric_changes"],
                stakeholders=c_stakeholders,
                attention_tokens=c["attention_tokens"],
            )
            all_challenges.append(challenge_obj)

        # Load phases and assign challenges
        for p_data in data.get("phases", []):
            phase_challenges = [ch for ch in all_challenges if ch.phase_id == p_data["id"]]
            p = Phase(
                id=p_data["id"],
                name=p_data["name"],
                description=p_data["description"],
                phase_introduction=p_data["phase_introduction"],
                challenges=phase_challenges
            )
            cls.phases.append(p)

