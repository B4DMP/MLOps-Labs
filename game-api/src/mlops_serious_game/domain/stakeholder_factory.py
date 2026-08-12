from pathlib import Path
import json

from mlops_serious_game.domain.exceptions import (
    StakeholderNameNotFound,
)

from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.phase_factory import PhaseFactory


class StakeholderFactory:
    stakeholders: list[Stakeholder] = []

    @classmethod
    def get_available_stakeholders(cls) -> list[str]:
        return [st.id for st in cls.stakeholders]

    @classmethod
    def get_active_stakeholders(cls, phase_id: int, selectionmask: list[str]) -> list[str]:
        if not selectionmask:
            return []
        selected_set = set(selectionmask)
        return [
            st.id
            for st in cls.stakeholders
            if st.active[phase_id] and st.id in selected_set
        ]

    @classmethod
    def get_stakeholder(cls, id: str) -> Stakeholder:
        for st in cls.stakeholders:
            if st.id == id or st.name == id:
                return st
        raise StakeholderNameNotFound(id)

    @classmethod
    def load_stakeholders(cls, stakeholder_config: Path) -> None:
        with stakeholder_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.stakeholders.clear()

        for j in data["stakeholders"]:
            name = j["name"]
            st_id = j["id"]
            
            def to_str(val):
                if isinstance(val, list):
                    return " ".join(val)
                return str(val or "")

            st = Stakeholder(
                id=st_id,
                name=name,
                responsibilities=to_str(j["responsibilities"]),
                priorities=to_str(j["priorities"]),
                requirements=to_str(j["requirements"]),
                role_description=to_str(j["role_description"]),
                metric_id=j["metric_id"],
                stakeholder_color=j["stakeholder_color"],
                metric_expertise_values=j["metric_expertise_values"],
                active=j["active"]
            )
            cls.stakeholders.append(st)
