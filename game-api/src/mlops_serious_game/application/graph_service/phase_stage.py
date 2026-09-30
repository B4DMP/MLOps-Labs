"""Which graph stage a phase plays in. The one place that knows phase 0 is not stage 0."""

from typing import Optional

from mlops_serious_game.domain.graph import Stage, TechnicalGraph
from mlops_serious_game.domain.phase_factory import PhaseFactory


def stage_for_phase(graph: TechnicalGraph, phase_id: Optional[int]) -> Optional[Stage]:
    """The phase's own `graph_stage_id`, else the stage sharing its id. A phase with neither
    (an unconfigured intro) plays in the first lifecycle stage."""
    if phase_id is None:
        return None
    phase = next((p for p in PhaseFactory.get_phases() if p.id == phase_id), None)
    if phase is not None and phase.graph_stage_id:
        return next((s for s in graph.stages if s.id == phase.graph_stage_id), None)
    return next((s for s in graph.stages if s.phase_id == max(1, phase_id)), None)
