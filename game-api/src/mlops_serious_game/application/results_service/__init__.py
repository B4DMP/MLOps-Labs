"""End-of-game results: the four pillars, the grade, and the detail sections behind them.

`compute` is pure and testable on hand-built inputs; `service` loads a run's rows and calls it.
See docs/plans/results-screen.md.
"""

from mlops_serious_game.application.results_service.service import (
    build_results,
    load_cached,
    results_for,
    store_results,
)
from mlops_serious_game.application.results_service.compute import (
    Grade,
    Pillar,
    decision_quality,
    grade_for,
    intel_accuracy,
    knowledge_delta,
    metric_summary,
    outcomes_from_events,
    overall_score,
    pipeline_health,
    stakeholder_relations,
)

__all__ = [
    "build_results",
    "load_cached",
    "results_for",
    "store_results",
    "Grade",
    "Pillar",
    "decision_quality",
    "grade_for",
    "intel_accuracy",
    "knowledge_delta",
    "metric_summary",
    "outcomes_from_events",
    "overall_score",
    "pipeline_health",
    "stakeholder_relations",
]
