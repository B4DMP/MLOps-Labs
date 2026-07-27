import json
from pathlib import Path
from philoagents.domain.exceptions import (
    QuestionNameNotFound
)

from philoagents.domain.question import Question

class BriefingFactory:
    briefing={}

    @classmethod
    def load_briefing(cls, briefing_config: Path) -> None:
        with briefing_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.briefing.clear()
        cls.briefing= data["briefing"]

