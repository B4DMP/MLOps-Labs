from langgraph.graph import END

from mlops_serious_game.application.pitch_debate_service.state import PitchDebateState


def has_more_stakeholders(state: PitchDebateState) -> str:
    """Determines whether there are remaining stakeholders to respond in the current turn.

    If more stakeholders are queued in `stakeholder_ids`, routes to `emotion_node`.
    Otherwise, terminates the turn at END. Dialogue options for the next turn are determined
    outside of the LangGraph.
    """
    if len(state.get("stakeholder_ids", [])) > 0:
        return "emotion_node"
    return END
