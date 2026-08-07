from pathlib import Path
import json

from philoagents.domain.Challenge import Challenge
from philoagents.domain.exceptions import (
    StakeholderNameNotFound,
)
from philoagents.domain.stakeholder import Stakeholder
from philoagents.domain.Phase import Phase

class PhaseFactory:
    phases: list[Phase] = []
    action_card_images: list[dict] = []


    @classmethod
    def get_phases(cls ) -> list[Phase]:
        return cls.phases
    
    @classmethod
    def get_challenge_by_index(cls, phase_index:int, challenge_index: int ) -> Challenge:
        if phase_index>=len(cls.phases):
            return None
        elif challenge_index>=len(cls.phases[phase_index].challenges):
            return cls.get_challenge_by_index(phase_index=phase_index+1,challenge_index=0)
        else:
            return cls.phases[phase_index].challenges[challenge_index]

    @classmethod
    def load_phases(cls, phases_config: Path) -> None:
        with phases_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.phases.clear()
        cls.action_card_images.clear()

        for i in data["ActionCardImages"]:
            cls.action_card_images.append(i)

        p_id=0
        for j in data["gamePhases"]:
            
            _challenges=[]
            c_id=0
            for c in j["challenges"]:
                _challenges.append(
                    Challenge(  id=c_id,
                                name=c["challenge_title"],
                                description=c["challenge_description"],
                                roundIntroduction=c["round_introduction_text"],
                                metric_changes=c["metric_changes"],
                                phase_id=p_id)
                                
                    )
                c_id+=1

            p = Phase(
                id=p_id,
                name=j["phase_name"],
                description=j["phase_description"],
                phase_introduction=j["phase_introduction"],
                challenges=_challenges
            )
            cls.phases.append(p)
            p_id+=1
