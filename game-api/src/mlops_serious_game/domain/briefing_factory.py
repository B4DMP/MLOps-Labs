import json
from pathlib import Path
from mlops_serious_game.domain.exceptions import (
    QuestionNameNotFound
)

from mlops_serious_game.domain.question import Question

class BriefingFactory:
    briefing={}

    @classmethod
    def load_briefing(cls, briefing_config: Path) -> None:
        with briefing_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.briefing.clear()
        cls.briefing= data["briefing"]

