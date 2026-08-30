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
    def get_active_stakeholders(cls, phase_id: int) -> list[str]:
        from mlops_serious_game.domain.metric_factory import MetricFactory
        active_ids = []
        for st in cls.stakeholders:
            is_active = False
            for m in MetricFactory.metrics:
                #account for intro stakeholders
                if m.id == st.metric_id or m.id == f"{st.metric_id}_intro":
                    if phase_id < len(m.phases) and m.phases[phase_id]:
                        is_active = True
                        break
            if is_active:
                active_ids.append(st.id)
        return active_ids

    @classmethod
    def get_stakeholder(cls, id: str) -> Stakeholder:
        for st in cls.stakeholders:
            if st.id == id or st.name == id:
                return st
        raise StakeholderNameNotFound(id)

    @classmethod
    def register_stakeholder(cls, stakeholder: Stakeholder) -> None:
        for i, st in enumerate(cls.stakeholders):
            if st.id == stakeholder.id:
                cls.stakeholders[i] = stakeholder
                return
        cls.stakeholders.append(stakeholder)

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
                responsibilities=to_str(j.get("responsibilities", "")),
                priorities=to_str(j.get("priorities", "")),
                requirements=to_str(j.get("requirements", "")),
                role_description=to_str(j.get("role_description", j.get("division_description", ""))),
                metric_id=j.get("metric_id", ""),
                convincer_archetype=str(j.get("convincer_archetype", "")),
                avatar=j.get("avatar", {})
            )
            cls.stakeholders.append(st)
