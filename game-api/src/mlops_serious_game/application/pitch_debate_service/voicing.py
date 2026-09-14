"""Face the room voicing (plan 11, step 5): the LLM only ever puts a decided answer into words.

The mechanic decides everything first - `session.answer_objection` - this module only asks the
LLM to say it out loud, once, in each direction: the player's answer, then the stakeholder's
reply. Either call failing falls back to a plain template line; the caller never waits on this
(run it from a background task, plan 11's "mechanics never wait on it").
"""

from __future__ import annotations

from typing import Optional

from langchain_core.output_parsers import StrOutputParser
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.application.pitch_debate_service.voicing_prompts import (
    PLAYER_ANSWER_PROMPT,
    STAKEHOLDER_REPLY_PROMPT,
)
from mlops_serious_game.config import settings

_FALLBACK_PLAYER_LINE = {
    "amend": "Let me address that directly: {item_context}",
    "reframe": "Think of it this way: {archetype_strategy}",
    "stonewall": "I hear you, but the card stands as it is.",
    "emergency_addendum": "I don't have that locked down yet, but I will get you a firm answer.",
    "concede_correction": "You're right, I filed that under the wrong category. Let me fix that.",
}


def _get_chat_model(temperature: float = 0.6) -> ChatOpenAI | ChatGroq:
    """Its own copy of the provider fallback chain (WestAI/Mistral proxy, else Groq), matching
    the pattern every other service module in this codebase already keeps separately - kept out
    of `chains.py` on purpose, since that module is on plan 11's deletion list (step 11)."""
    if settings.MISTRAL_API_KEY:
        return ChatOpenAI(
            api_key=settings.MISTRAL_API_KEY, base_url=settings.MISTRAL_API_BASE,
            model_name=settings.MISTRAL_LLM_MODEL, temperature=temperature,
        )
    if settings.WESTAI_API_KEY:
        return ChatOpenAI(
            api_key=settings.WESTAI_API_KEY, base_url=settings.WESTAI_API_BASE,
            model_name=settings.WESTAI_LLM_MODEL, temperature=temperature,
        )
    return ChatGroq(api_key=settings.GROQ_API_KEY, model_name=settings.GROQ_LLM_MODEL, temperature=temperature)


def get_player_answer_chain():
    return PLAYER_ANSWER_PROMPT | _get_chat_model(temperature=0.6) | StrOutputParser()


def get_stakeholder_reply_chain():
    return STAKEHOLDER_REPLY_PROMPT | _get_chat_model(temperature=0.7) | StrOutputParser()


def _fallback_player_line(option: str, item_context: str, archetype_strategy: str) -> str:
    template = _FALLBACK_PLAYER_LINE.get(option, "Here is my answer.")
    try:
        return template.format(item_context=item_context or "what I have on hand", archetype_strategy=archetype_strategy or "how this room thinks")
    except (KeyError, IndexError):
        return template


def _fallback_stakeholder_line(stakeholder_name: str, outcome_hint: str) -> str:
    return f"{stakeholder_name}: {outcome_hint}" if outcome_hint else f"{stakeholder_name} takes that in."


def outcome_hint_from(cause_texts: list[str], cleared: bool, reframe_result: Optional[str]) -> str:
    """What the stakeholder line has to agree with - built from the same cause text the event
    log shows, so the voiced line and the logged reason can never say different things."""
    parts = list(cause_texts)
    if reframe_result:
        parts.insert(0, reframe_result.replace("_", " "))
    if not parts:
        parts.append("cleared" if cleared else "not cleared")
    return "; ".join(parts)


async def voice_answer(
    *,
    challenge: str,
    option: str,
    stakeholder_name: str,
    stakeholder_role: str,
    archetype_label: str,
    archetype_strategy: str,
    objection_text: str,
    item_context: Optional[str] = None,
    chosen_archetype_name: Optional[str] = None,
    chosen_archetype_strategy: Optional[str] = None,
    cleared: bool = False,
    reframe_result: Optional[str] = None,
    cause_texts: Optional[list[str]] = None,
) -> tuple[str, str]:
    """Returns (player_line, stakeholder_line). Never raises."""
    outcome_hint = outcome_hint_from(cause_texts or [], cleared, reframe_result)
    fallback_archetype_strategy = chosen_archetype_strategy or archetype_strategy

    try:
        player_line = await get_player_answer_chain().ainvoke({
            "challenge": challenge,
            "target_stakeholder_name": stakeholder_name,
            "target_stakeholder_role": stakeholder_role,
            "objection_text": objection_text,
            "option_type": option,
            "item_context": item_context or "",
            "archetype_name": chosen_archetype_name or "",
            "archetype_strategy": chosen_archetype_strategy or "",
        })
        player_line = (player_line or "").strip() or _fallback_player_line(option, item_context or "", fallback_archetype_strategy)
    except Exception:
        player_line = _fallback_player_line(option, item_context or "", fallback_archetype_strategy)

    try:
        stakeholder_line = await get_stakeholder_reply_chain().ainvoke({
            "stakeholder_name": stakeholder_name,
            "archetype_label": archetype_label,
            "archetype_strategy": archetype_strategy,
            "player_line": player_line,
            "outcome_hint": outcome_hint,
        })
        stakeholder_line = (stakeholder_line or "").strip() or _fallback_stakeholder_line(stakeholder_name, outcome_hint)
    except Exception:
        stakeholder_line = _fallback_stakeholder_line(stakeholder_name, outcome_hint)

    return player_line, stakeholder_line
