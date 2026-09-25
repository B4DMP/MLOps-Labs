"""One event as the client receives it: the record plus its rendered cause text.

Causes are config templates, never LLM text (plan 11, D51), so the frontend never needs its own
copy of `EventCauses.json` to show them. Lives here rather than in the websocket layer so both the
live log (`log_handler`) and the results screen (`results_service`) render events identically.
"""

from mlops_serious_game.domain.event import GameEvent
from mlops_serious_game.domain.event_causes import EventCauseFactory

# Generic stand-ins for params a template has grown since some rows were logged (plan 11): an
# old row's `params` can never gain a key it was never given, so a strict re-render of it against
# today's template would raise and fall back to the bare cause code (`outcome.pass`,
# `intel.artifact_filed`) - worse than a generic sentence. Only used when the strict render fails.
_FALLBACK_PARAMS = {
    "change": "your proposal",
    "tag": "something",
    "st": "someone",
    "detail": "nothing more specific",
    "component": "the system",
}


def serialize_event(event: GameEvent) -> dict:
    params = dict(event.params or {})
    if event.cause == "outcome.veto" and not params.get("st"):
        params["st"] = "the room"
    try:
        text = EventCauseFactory.render(event.cause, params)
    except Exception:
        try:
            text = EventCauseFactory.render(event.cause, {**_FALLBACK_PARAMS, **params})
        except Exception:
            text = event.cause
    return {**event.model_dump(mode="json"), "text": text}
