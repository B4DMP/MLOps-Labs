"""Campaign-level statistics over finished runs (docs/plans/results-screen.md, section 5).

Pure, like `compute`: it takes the results payloads `build_results` produced and folds them into the
numbers the admin Results page shows. The database half (which runs count, which accounts are
excluded as playtest data) lives in `admin_service`; nothing here knows about either.

A payload is used as-is, so a run's grade in the aggregate is the grade its player saw. Every
section tolerates a payload that lacks a field (an old cached run, a campaign with the
questionnaire off) by skipping it rather than counting it as zero: an absent reading is not a bad
one, and averaging it in would drag the whole campaign down for reasons unrelated to how anyone
played.
"""

from __future__ import annotations

import statistics
from typing import Any, Iterable, Optional

GRADE_ORDER = ("S", "A", "B", "C", "D", "E")
OUTCOMES = ("PASS", "SOFT_PASS", "VETO")
PILLAR_IDS = ("pipeline_health", "stakeholder_relations", "intel_accuracy", "decision_quality")


def describe(values: Iterable[Optional[float]]) -> dict[str, Optional[float]]:
    """Mean, spread and range of the readings that exist.

    `stdev` is the sample standard deviation, and is None below two readings rather than 0: one
    reading has no spread, and reporting zero would claim everyone played identically.
    """
    readings = [float(v) for v in values if isinstance(v, (int, float))]
    if not readings:
        return {"n": 0, "mean": None, "median": None, "stdev": None, "min": None, "max": None}
    return {
        "n": len(readings),
        "mean": round(statistics.fmean(readings), 4),
        "median": round(statistics.median(readings), 4),
        "stdev": round(statistics.stdev(readings), 4) if len(readings) > 1 else None,
        "min": round(min(readings), 4),
        "max": round(max(readings), 4),
    }


def _pillar_scores(payloads: list[dict], pillar_id: str) -> list[Optional[float]]:
    scores: list[Optional[float]] = []
    for payload in payloads:
        match = next((p for p in payload.get("pillars", []) if p.get("id") == pillar_id), None)
        scores.append(match.get("score") if match else None)
    return scores


def _pillar_detail(payloads: list[dict], pillar_id: str, key: str) -> list[Optional[float]]:
    values: list[Optional[float]] = []
    for payload in payloads:
        match = next((p for p in payload.get("pillars", []) if p.get("id") == pillar_id), None)
        values.append((match or {}).get("detail", {}).get(key))
    return values


def grade_distribution(payloads: list[dict]) -> dict[str, int]:
    """How many runs earned each grade, best first, with an entry for every grade so an empty band
    shows as a zero rather than disappearing from the chart."""
    counts = {grade: 0 for grade in GRADE_ORDER}
    for payload in payloads:
        grade = (payload.get("grade") or {}).get("grade")
        if grade in counts:
            counts[grade] += 1
    return counts


def outcome_mix(payloads: list[dict]) -> dict[str, int]:
    """Every challenge outcome across the campaign. A challenge that never reached a commit is
    `unfinished`, kept apart from a veto: it is a run that stopped, not a proposal that failed."""
    counts = {name: 0 for name in OUTCOMES}
    counts["unfinished"] = 0
    for payload in payloads:
        for decision in payload.get("decisions", []):
            outcome = decision.get("outcome")
            counts[outcome if outcome in OUTCOMES else "unfinished"] += 1
    return counts


def challenge_difficulty(payloads: list[dict], top: Optional[int] = None) -> list[dict[str, Any]]:
    """Per challenge: how often it was played and how often the room vetoed it, hardest first.

    A challenge that was never finished is not counted as played. Ranking by veto *rate* rather
    than count keeps a challenge that few people reached from looking easy, and one that everyone
    reached from looking hard, purely because of how many saw it.
    """
    by_name: dict[str, dict[str, int]] = {}
    for payload in payloads:
        for decision in payload.get("decisions", []):
            outcome = decision.get("outcome")
            if outcome not in OUTCOMES:
                continue
            row = by_name.setdefault(decision.get("name", "Unknown"), {"played": 0, "vetoes": 0, "soft": 0})
            row["played"] += 1
            row["vetoes"] += outcome == "VETO"
            row["soft"] += outcome == "SOFT_PASS"

    rows = [
        {
            "name": name,
            "played": counts["played"],
            "vetoes": counts["vetoes"],
            "soft_passes": counts["soft"],
            "veto_rate": round(counts["vetoes"] / counts["played"], 4),
        }
        for name, counts in by_name.items()
    ]
    rows.sort(key=lambda r: (-r["veto_rate"], -r["played"], r["name"]))
    return rows[:top] if top else rows


def intel_summary(payloads: list[dict]) -> dict[str, Any]:
    """Accuracy, coverage, and how much of each stakeholder's intel players tend to find."""
    per_stakeholder: dict[str, list[float]] = {}
    for payload in payloads:
        for row in (payload.get("intel") or {}).get("per_stakeholder", []):
            if row.get("available"):
                per_stakeholder.setdefault(row["id"], []).append(row["gathered"] / row["available"])

    return {
        "accuracy": describe(_pillar_detail(payloads, "intel_accuracy", "accuracy")),
        "coverage": describe(_pillar_detail(payloads, "intel_accuracy", "coverage")),
        "coverage_by_stakeholder": {
            stakeholder_id: describe(values) for stakeholder_id, values in sorted(per_stakeholder.items())
        },
    }


def knowledge_summary(payloads: list[dict]) -> dict[str, Any]:
    """The before/after read across the campaign, in the questionnaire's own terms.

    Only runs that were actually measured contribute. `by_run` is the mean outro score for a
    player's first, second, third finished run: a campaign that allows replay gets a learning curve
    out of it, which is the point of storing every run's answers.
    """
    intro, latest, deltas, delta_percents = [], [], [], []
    by_run: dict[int, list[float]] = {}

    for payload in payloads:
        knowledge = payload.get("knowledge") or {}
        intro_percent = (knowledge.get("intro") or {}).get("percent")
        outros = [r for r in knowledge.get("outro_per_run", []) if r.get("percent") is not None]

        if intro_percent is not None:
            intro.append(intro_percent)
        if outros:
            latest.append(outros[-1]["percent"])
        for entry in outros:
            by_run.setdefault(int(entry["run"]), []).append(entry["percent"])
        if knowledge.get("delta") is not None:
            deltas.append(knowledge["delta"])
        if knowledge.get("delta_percent") is not None:
            delta_percents.append(knowledge["delta_percent"])

    return {
        "intro_percent": describe(intro),
        "latest_outro_percent": describe(latest),
        "delta": describe(deltas),
        "delta_percent": describe(delta_percents),
        "outro_percent_by_run": {run: describe(values) for run, values in sorted(by_run.items())},
    }


def metric_summary(payloads: list[dict]) -> dict[str, dict[str, Optional[float]]]:
    """Where each gauge ended, as a share of its maximum, averaged over the campaign."""
    by_metric: dict[str, list[float]] = {}
    for payload in payloads:
        for metric in (payload.get("metrics") or {}).get("metrics", []):
            by_metric.setdefault(metric["id"], []).append(metric.get("ratio"))
    return {metric_id: describe(values) for metric_id, values in by_metric.items()}


def aggregate_results(payloads: list[dict], *, top: int = 5) -> dict[str, Any]:
    """Everything the admin Results page shows for one set of runs."""
    overall = [(p.get("grade") or {}).get("overall") for p in payloads]
    spiral = sum(1 for p in payloads if p.get("is_spiral"))
    difficulty = challenge_difficulty(payloads)

    return {
        "runs": len(payloads),
        "fresh_runs": len(payloads) - spiral,
        "spiral_runs": spiral,
        "overall": describe(overall),
        "grades": grade_distribution(payloads),
        "pillars": {pillar_id: describe(_pillar_scores(payloads, pillar_id)) for pillar_id in PILLAR_IDS},
        "outcomes": outcome_mix(payloads),
        "hardest_challenges": [row for row in difficulty if row["vetoes"]][:top],
        "challenges": difficulty,
        "intel": intel_summary(payloads),
        "knowledge": knowledge_summary(payloads),
        "metrics": metric_summary(payloads),
    }
