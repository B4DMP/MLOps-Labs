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
        return [st.stakeholder_index for st in cls.stakeholders]

    @classmethod
    def get_active_stakeholders(cls, phase_id: int, selectionmask: list[str]) -> list[str]:
        if not selectionmask:
            return []
        selected_set = set(selectionmask)
        return [
            st.stakeholder_index
            for st in cls.stakeholders
            if st.active[phase_id] and st.stakeholder_index in selected_set
        ]

    @classmethod
    def get_stakeholder(cls, id: str) -> Stakeholder:
        for st in cls.stakeholders:
            if st.id == id or st.stakeholder_index == id or st.name == id:
                return st
        raise StakeholderNameNotFound(id)

    @classmethod
    def load_stakeholders(cls, stakeholder_config: Path) -> None:
        with stakeholder_config.open("r", encoding="utf-8") as f:
            data = json.load(f)

        cls.stakeholders.clear()

        for j in data["stakeholders"]:
            st_idx = j.get("stakeholder_index") or f"{j['stakeholder_name'].lower().replace(' ', '_')}_{j['stakeholder_division_name'].lower().replace(' ', '_').replace('/', '_')}"
            st = Stakeholder(
                id=st_idx,
                stakeholder_index=st_idx,
                name=j["stakeholder_name"],
                division=j["stakeholder_division_name"],
                responsibilities=j["stakeholder_responsibilities"],
                priorities=j["stakeholder_priorities"],
                requirements=j["stakeholder_requirements"],
                division_description=j["stakeholder_division_name_desc"],
                metric_id=j["metric_id"],
                stakeholder_color=j["stakeholder_color"],
                metric_expertise_values=j["metric_expertise_values"],
                active=j["active"]
            )
            cls.stakeholders.append(st)
