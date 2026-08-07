from pathlib import Path
import json

from philoagents.domain.exceptions import (
    StakeholderNameNotFound,
)

from philoagents.domain.stakeholder import Stakeholder
from philoagents.domain.phase_factory import PhaseFactory


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
            name = j.get("name") or j.get("stakeholder_name")
            div = j.get("division") or j.get("stakeholder_division_name")
            st_idx = j.get("id") or j.get("stakeholder_index") or f"{name.lower().replace(' ', '_')}_{div.lower().replace(' ', '_').replace('/', '_')}"
            
            def to_str(val):
                if isinstance(val, list):
                    return " ".join(val)
                return str(val or "")

            st = Stakeholder(
                id=st_idx,
                name=name,
                division=div,
                responsibilities=to_str(j.get("responsibilities") or j.get("stakeholder_responsibilities")),
                priorities=to_str(j.get("priorities") or j.get("stakeholder_priorities")),
                requirements=to_str(j.get("requirements") or j.get("stakeholder_requirements")),
                division_description=to_str(j.get("division_description") or j.get("stakeholder_division_name_desc")),
                metric_id=j["metric_id"],
                stakeholder_color=j["stakeholder_color"],
                metric_expertise_values=j["metric_expertise_values"],
                active=j["active"]
            )
            cls.stakeholders.append(st)
