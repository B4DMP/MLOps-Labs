"""Renders stakeholder name tokens in config prose for the current player.

Config text never spells a stakeholder's name out. It writes tokens instead:

    "{model_monica} mandates 95% accuracy, and {model_monica.first} won't budge."

which this module renders against the persona map the current player drew. The
map is carried in a context variable so the domain factories can personalize
their own output without every call site having to thread a player through.
The application layer owns loading and persisting that map; this module only
knows how to apply one.

With no map in context every function is the identity, so anything that runs
outside a player session (tests, config validation, tooling) keeps seeing the
canonical text.
"""

import re
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator, Optional

from mlops_serious_game.domain.persona import Persona

PersonaMap = dict[str, Persona]

_current_personas: ContextVar[Optional[PersonaMap]] = ContextVar(
    "current_personas", default=None
)

# {stakeholder_id} or {stakeholder_id.first}
_TOKEN_RE = re.compile(r"\{([a-z0-9_]+)(\.first)?\}")
# #stakeholder_id# highlight markers used by challenge descriptions
_MARKER_RE = re.compile(r"#([a-z0-9_]+)#")


def current_personas() -> Optional[PersonaMap]:
    """The persona map of the player being served, or None outside a session."""
    return _current_personas.get()


def bind_personas(personas: Optional[PersonaMap]) -> None:
    """Binds a persona map for the rest of the current asyncio task.

    Each websocket connection is served by its own task, and a task copies the
    context when it is created, so binding here reaches that connection's
    handlers and the tasks they spawn without leaking into other players'
    connections.
    """
    _current_personas.set(personas)


@contextmanager
def use_personas(personas: Optional[PersonaMap]) -> Iterator[None]:
    """Binds a persona map for the duration of the block.

    Tasks spawned inside the block inherit the binding, which is what keeps the
    fire-and-forget chat handler personalized.
    """
    token = _current_personas.set(personas)
    try:
        yield
    finally:
        _current_personas.reset(token)


def personalize(
    text: Optional[str],
    personas: Optional[PersonaMap] = None,
    resolve_markers: bool = False,
) -> str:
    """Renders name tokens in `text` for the given (or current) persona map.

    Set `resolve_markers` for text headed to a language model rather than to the
    UI: it turns the `#stakeholder_id#` highlight markers into plain names. The
    UI resolves those markers itself and needs them left intact.
    """
    if not text:
        return text or ""

    personas = personas if personas is not None else current_personas()
    if not personas:
        if resolve_markers:
            return _MARKER_RE.sub(lambda m: m.group(1), text)
        return text

    def render_token(match: re.Match) -> str:
        persona = personas.get(match.group(1))
        if not persona:
            return match.group(0)
        return persona.first_name if match.group(2) else persona.name

    result = _TOKEN_RE.sub(render_token, text)

    if resolve_markers:
        result = _MARKER_RE.sub(
            lambda m: personas[m.group(1)].name if m.group(1) in personas else m.group(1),
            result,
        )

    return result


def personalize_mapping(
    values: Optional[dict[str, str]],
    personas: Optional[PersonaMap] = None,
) -> dict[str, str]:
    """Renders name tokens in every value of a string mapping."""
    if not values:
        return {}
    return {k: personalize(v, personas) for k, v in values.items()}
