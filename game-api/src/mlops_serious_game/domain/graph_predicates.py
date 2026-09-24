"""Boolean predicate trees over the graph. Shared by patterns, Boundaries and challenge preconditions.

Clauses:
    {"component": id, "axis": "automation" | "governance", "op": "gte", "level": "automated", "on": "effective" | "nominal"}
    {"edge": id, "axis": "governance", "op": "lte", "level": "partial_1", "on": ...}
    {"edge": id, "trigger": "eq" | "ne", "value": "on_alert"}
    {"attr": "stage.component.attr", "op": "eq" | "ne", "value": "public_cloud"}
    {"instance": {"kind": "model", "state": "active", "component": id, "op": "exists",
                  "where": {"performance": {"op": "lte", "value": "fair"}}}}
    {"instance": {"kind": "model", "op": "count", "cmp": "gte", "n": 2}}
Instance property comparisons use the order of the property's values in the config.
    {"pattern": id}
Combinators: {"all": [...]}, {"any": [...]}, {"not": {...}}. Literal true / false allowed.
"""

import operator
from dataclasses import dataclass, field
from typing import Any, Callable

from mlops_serious_game.domain.graph import Axis, EffectiveView, GraphState, TechnicalGraph, parse_axis_level

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    "eq": operator.eq,
    "ne": operator.ne,
    "lt": operator.lt,
    "lte": operator.le,
    "gt": operator.gt,
    "gte": operator.ge,
}
_EQUALITY = ("eq", "ne")
_AXES = ("automation", "governance")


class PredicateError(ValueError):
    pass


@dataclass
class PredicateContext:
    graph: TechnicalGraph
    state: GraphState
    effective: EffectiveView
    patterns: frozenset[str] = field(default_factory=frozenset)


@dataclass
class PredicateResult:
    value: bool
    trace: dict


def _cmp(op: str, actual: Any, expected: Any) -> bool:
    if op not in _OPS:
        raise PredicateError(f"unknown op '{op}'")
    return _OPS[op](actual, expected)


def _level_of(ctx: PredicateContext, target: str, on: str, axis: Axis) -> int:
    if on == "nominal":
        return ctx.state.value(target, axis)
    if on == "effective":
        return ctx.effective.value(target, axis)
    raise PredicateError(f"unknown 'on' value '{on}'")


def evaluate(pred: Any, ctx: PredicateContext) -> PredicateResult:
    if isinstance(pred, bool):
        return PredicateResult(pred, {"literal": pred, "result": pred})
    if not isinstance(pred, dict) or not pred:
        raise PredicateError(f"invalid predicate: {pred!r}")

    if "all" in pred:
        parts = [evaluate(p, ctx) for p in pred["all"]]
        value = all(p.value for p in parts)
        return PredicateResult(value, {"all": [p.trace for p in parts], "result": value})
    if "any" in pred:
        parts = [evaluate(p, ctx) for p in pred["any"]]
        value = any(p.value for p in parts)
        return PredicateResult(value, {"any": [p.trace for p in parts], "result": value})
    if "not" in pred:
        inner = evaluate(pred["not"], ctx)
        return PredicateResult(not inner.value, {"not": inner.trace, "result": not inner.value})

    if "pattern" in pred:
        value = pred["pattern"] in ctx.patterns
        return PredicateResult(value, {**pred, "result": value})

    if "attr" in pred:
        component, attr = pred["attr"].rsplit(".", 1)
        op = pred.get("op", "eq")
        if op not in _EQUALITY:
            raise PredicateError(f"attr clauses only support eq / ne, got '{op}'")
        actual = ctx.state.attrs.get(component, {}).get(attr)
        value = _cmp(op, actual, pred["value"])
        return PredicateResult(value, {**pred, "actual": actual, "result": value})

    if "edge" in pred and "trigger" in pred:
        op = pred["trigger"]
        if op not in _EQUALITY:
            raise PredicateError(f"trigger clauses only support eq / ne, got '{op}'")
        actual = ctx.state.edge_triggers.get(pred["edge"])
        value = _cmp(op, actual, pred["value"])
        return PredicateResult(value, {**pred, "actual": actual, "result": value})

    for key in ("component", "edge"):
        if key in pred:
            axis = pred.get("axis")
            if axis not in _AXES:
                raise PredicateError(f"'{key}' clause needs an 'axis' of 'automation' or 'governance', got {axis!r}")
            actual = _level_of(ctx, pred[key], pred.get("on", "effective"), axis)
            expected = parse_axis_level(axis, pred["level"])
            value = _cmp(pred.get("op", "gte"), actual, expected)
            return PredicateResult(value, {**pred, "actual": actual, "result": value})

    if "instance" in pred:
        spec = pred["instance"]
        where = spec.get("where", {})

        def props_match(inst) -> bool:
            for prop, cond in where.items():
                actual = inst.props.get(prop)
                if actual is None:
                    return False
                rank = ctx.graph.prop_rank(inst.kind, prop, actual)
                if not _cmp(cond.get("op", "eq"), rank, ctx.graph.prop_rank(inst.kind, prop, cond["value"])):
                    return False
            return True

        matches = [
            i
            for i in ctx.state.instances.values()
            if ("kind" not in spec or i.kind == spec["kind"])
            and ("state" not in spec or i.state == spec["state"])
            and ("component" not in spec or i.component_id == spec["component"])
            and props_match(i)
        ]
        mode = spec.get("op", "exists")
        if mode == "exists":
            value = bool(matches)
        elif mode == "count":
            value = _cmp(spec.get("cmp", "gte"), len(matches), spec.get("n", 1))
        else:
            raise PredicateError(f"unknown instance op '{mode}'")
        return PredicateResult(value, {**pred, "actual": len(matches), "result": value})

    raise PredicateError(f"unknown clause: {pred!r}")


def validate_predicate(pred: Any, graph: TechnicalGraph, pattern_ids: set[str] | None = None) -> list[str]:
    """Static check for config gates: every reference exists and every op is known."""
    errors: list[str] = []

    def walk(p: Any) -> None:
        if isinstance(p, bool):
            return
        if not isinstance(p, dict) or not p:
            errors.append(f"invalid predicate {p!r}")
            return
        if "all" in p or "any" in p:
            for sub in p.get("all", p.get("any", [])):
                walk(sub)
            return
        if "not" in p:
            walk(p["not"])
            return
        if "pattern" in p:
            if not isinstance(p["pattern"], str):
                errors.append(f"'pattern' must be a pattern id, got {p['pattern']!r}")
            elif pattern_ids is not None and p["pattern"] not in pattern_ids:
                errors.append(f"unknown pattern '{p['pattern']}'")
            return
        if "attr" in p:
            if not isinstance(p["attr"], str):
                errors.append(f"'attr' must be a 'component.attribute' string, got {p['attr']!r}")
                return
            component, _, attr = p["attr"].rpartition(".")
            if p.get("op", "eq") not in _EQUALITY:
                errors.append(f"attr clauses only support eq / ne, got '{p.get('op')}'")
            if not graph.is_component(component) or attr not in graph.component(component).attributes:
                errors.append(f"unknown attribute '{p['attr']}'")
            elif p.get("value") not in graph.component(component).attributes[attr].values:
                errors.append(f"value '{p.get('value')}' not allowed for '{p['attr']}'")
            return
        if "edge" in p and "trigger" in p:
            if p["trigger"] not in _EQUALITY:
                errors.append(f"trigger clauses only support eq / ne, got '{p['trigger']!r}'")
            if not isinstance(p["edge"], str) or not graph.is_edge(p["edge"]):
                errors.append(f"unknown edge '{p['edge']}'")
            elif p.get("value") not in graph.triggers:
                errors.append(f"unknown trigger '{p.get('value')}'")
            return
        for key, exists in (("component", graph.is_component), ("edge", graph.is_edge)):
            if key in p:
                if not isinstance(p[key], str):
                    errors.append(f"'{key}' must be an id string, got {p[key]!r}")
                    return
                if not exists(p[key]):
                    errors.append(f"unknown {key} '{p[key]}'")
                if p.get("op", "gte") not in _OPS:
                    errors.append(f"unknown op '{p.get('op')}'")
                axis = p.get("axis")
                if axis not in _AXES:
                    errors.append(f"'{key}' clause needs an 'axis' of 'automation' or 'governance', got {axis!r}")
                else:
                    try:
                        parse_axis_level(axis, p.get("level"))
                    except (ValueError, TypeError):
                        errors.append(f"invalid level {p.get('level')!r} for axis '{axis}'")
                return
        if "instance" in p:
            spec = p["instance"]
            if not isinstance(spec, dict):
                errors.append(f"'instance' must be an object, got {spec!r}")
                return
            if "kind" in spec and spec["kind"] not in graph.instance_kinds:
                errors.append(f"unknown instance kind '{spec['kind']}'")
                return
            if "state" in spec and spec["state"] not in graph.instance_states:
                errors.append(f"unknown instance state '{spec['state']}'")
            if spec.get("where") and "kind" not in spec:
                errors.append("instance 'where' needs a 'kind'")
                return
            props = graph.instance_kinds[spec["kind"]].properties if "kind" in spec else {}
            for prop, cond in spec.get("where", {}).items():
                if prop not in props:
                    errors.append(f"unknown property '{prop}' on '{spec['kind']}'")
                elif cond.get("value") not in props[prop].values:
                    errors.append(f"unknown value '{cond.get('value')}' for '{spec['kind']}.{prop}'")
                if cond.get("op", "eq") not in _OPS:
                    errors.append(f"unknown op '{cond.get('op')}'")
            mode = spec.get("op", "exists")
            if mode not in ("exists", "count"):
                errors.append(f"unknown instance op '{mode}'")
            elif mode == "count" and spec.get("cmp", "gte") not in _OPS:
                errors.append(f"unknown op '{spec.get('cmp')}'")
            return
        errors.append(f"unknown clause {p!r}")

    walk(pred)
    return errors
