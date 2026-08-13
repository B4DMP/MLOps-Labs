from pathlib import Path
import json
from typing import List
from mlops_serious_game.domain.requirement import StakeholderRequirement
from mlops_serious_game.domain.Challenge import Challenge

class RequirementFactory:
    requirements: List[StakeholderRequirement] = []

    @classmethod
    def get_requirements(cls) -> List[StakeholderRequirement]:
        return cls.requirements

    @classmethod
    def get_requirements_for_challenge(cls, challenge_id: int) -> List[StakeholderRequirement]:
        return [r for r in cls.requirements if r.challenge_id == challenge_id]

    @classmethod
    def get_requirements_for_stakeholder_in_challenge(cls, challenge_id: int, stakeholder_id: str) -> List[StakeholderRequirement]:
        return [r for r in cls.requirements if r.challenge_id == challenge_id and r.stakeholder_id == stakeholder_id]

    @classmethod
    def load_requirements(cls, requirements_config: Path) -> None:
        with requirements_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.requirements.clear()
        for r_data in data.get("requirements", []):
            if "id" not in r_data:
                raise ValueError("Requirement objects must have a unique 'id' field in the config file.")
            req = StakeholderRequirement(
                id=str(r_data["id"]),
                challenge_id=int(r_data["challenge_id"]),
                stakeholder_id=str(r_data["stakeholder_id"]),
                type=str(r_data["type"]),
                description=str(r_data["description"])
            )
            cls.requirements.append(req)

    @classmethod
    def validate_requirements(cls, challenges: List[Challenge]) -> None:
        from mlops_serious_game.domain.requirement import RequirementType
        
        for challenge in challenges:
            for ch_st in challenge.stakeholders:
                reqs = cls.get_requirements_for_stakeholder_in_challenge(challenge.id, ch_st.stakeholder_id)
                
                # Check exactly 4 requirements
                if len(reqs) != 4:
                    raise ValueError(
                        f"Stakeholder '{ch_st.stakeholder_id}' in challenge '{challenge.name}' (ID: {challenge.id}) "
                        f"must have exactly 4 requirement objects. Found {len(reqs)}."
                    )
                
                # Check types and at least one hard constraint
                has_hard_constraint = False
                for req in reqs:
                    if req.type == RequirementType.HARD_CONSTRAINT:
                        has_hard_constraint = True
                
                if not has_hard_constraint:
                    raise ValueError(
                        f"Stakeholder '{ch_st.stakeholder_id}' in challenge '{challenge.name}' (ID: {challenge.id}) "
                        f"must have at least one 'hard_constraint' requirement."
                    )
