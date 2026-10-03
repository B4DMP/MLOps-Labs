"""Every component ships a short plain-language `help`, and the graph payload carries it."""

import re

from mlops_serious_game.application.graph_service.graph_state_view import build_graph_state
from mlops_serious_game.application.graph_service.view import evaluate_graph
from mlops_serious_game.domain.graph import GraphState


def test_every_component_has_clean_help(real):
    assert len(real.components) == 28
    for c in real.components:
        assert c.help, c.id
        assert not re.search(r"\d|%|—", c.help), c.id
        assert len(re.findall(r"[.!?](\s|$)", c.help)) <= 2, c.id


def test_help_reaches_the_client_payload(real):
    state = GraphState.from_config(real)
    ev = evaluate_graph(real, state, [], [])
    view = build_graph_state(real, state, ev.effective, ev.stage_graph, [], [], current_phase_id=None)
    sent = {c["id"]: c.get("help") for tech in view["technical"].values() for c in tech["components"]}
    assert sent["data.ingestion"] == real.component("data.ingestion").help
    assert all(sent.values())
