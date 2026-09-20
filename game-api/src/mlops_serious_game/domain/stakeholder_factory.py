from pathlib import Path
import json
import random
from typing import Optional

from mlops_serious_game.domain.exceptions import (
    StakeholderNameNotFound,
)

from mlops_serious_game.domain.persona import Persona
from mlops_serious_game.domain.persona_resolver import PersonaMap, current_personas
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
        personas = current_personas()
        for st in cls.stakeholders:
            if cls._matches(st, id, personas):
                return st.with_persona((personas or {}).get(st.id), personas)
        raise StakeholderNameNotFound(id)

    @classmethod
    def get_all_stakeholders(cls) -> list[Stakeholder]:
        """Every stakeholder, wearing the current player's personas."""
        personas = current_personas()
        return [st.with_persona((personas or {}).get(st.id), personas) for st in cls.stakeholders]

    @staticmethod
    def _matches(st: Stakeholder, id: str, personas: Optional[PersonaMap]) -> bool:
        """Resolves an id, the canonical name, or the name the player is seeing.

        The last case matters because a language model only ever hears the
        personalized name and will hand it back that way.
        """
        if st.id == id or st.name == id:
            return True
        persona = (personas or {}).get(st.id)
        return bool(persona and persona.name == id)

    @classmethod
    def choose_personas(cls, player: str, existing: Optional[dict] = None) -> dict[str, str]:
        """Deals one persona key per stakeholder for `player`.

        Seeded per stakeholder so that the draw is reproducible if a session
        record is ever lost, and so that adding a stakeholder later back-fills
        that one alone instead of recasting the whole team mid-game. Keys that
        are no longer in the config are re-drawn.
        """
        chosen = dict(existing or {})
        for st in cls.stakeholders:
            if not st.personas:
                chosen.pop(st.id, None)
                continue
            available = {p.key for p in st.personas}
            if chosen.get(st.id) in available:
                continue
            rng = random.Random(f"{player}:{st.id}")
            chosen[st.id] = rng.choice(sorted(available))
        return chosen

    @classmethod
    def resolve_personas(cls, chosen: Optional[dict]) -> PersonaMap:
        """Turns a stored {stakeholder_id: persona_key} map into Persona objects."""
        resolved: PersonaMap = {}
        for st in cls.stakeholders:
            key = (chosen or {}).get(st.id)
            for persona in st.personas:
                if persona.key == key:
                    resolved[st.id] = persona
                    break
        return resolved

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
                introduction=to_str(j.get("introduction", "")),
                metric_id=j.get("metric_id", ""),
                voice=j.get("voice", "neutral"),
                avatar=j.get("avatar", {}),
                personas=[
                    Persona(
                        key=str(p["key"]),
                        name=str(p["name"]),
                        avatar=p.get("avatar", {}),
                    )
                    for p in j.get("personas", [])
                ],
            )
            cls.stakeholders.append(st)
