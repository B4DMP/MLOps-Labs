"""Stage 1: challenge templates. A problem that appears in the graph, the world event that starts it,
the two stakeholders who disagree about the fix, and what happens if the meeting stalls."""

import json
import re
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.stages.common import (
    GAME_RULES, LEVEL_TALK, domain_errors, op_dict, ops_errors, parse_json_field, render, system_for,
    text_errors, tokenize_names,
)

SLUG = re.compile(r"^[a-z][a-z0-9_]{2,40}$")
BLAND_NAME = re.compile(r"\b(conflict|debate|dispute|compromise|discussion|disagreement)\b", re.I)
MARKER = re.compile(r"#([a-z_]+)#")

# Where a challenge's trouble comes from. Phrased for any setting, not just the current one, so a
# later change of world keeps the spread. One per slot, so a phase's challenges are not all the
# same story told twice.
ANGLES = [
    "something happening out in the world the product serves: weather, a season, a holiday, a "
    "sudden run on one article",
    "the people who use the system's output not trusting it, working around it or overriding it",
    "personal data, consent, retention or another legal obligation",
    "suppliers, contracts, or money that is already committed and cannot be taken back",
    "a technical failure nobody noticed until its effects showed up in the real world",
    "cost, infrastructure, or the narrow time window the job has to finish inside",
]


class WorldOp(BaseModel):
    kind: Literal["set_to", "set_instance_prop"]
    target: str = Field(description="component id, edge id, or instance id for set_instance_prop")
    value: Union[int, str] = Field(description="new level (0 to 4) for set_to, or the new property value")
    attr: Optional[str] = Field(default=None, description="property name for set_instance_prop")
    reason: str = Field(description="one short in-world reason, e.g. 'the nightly job died'")


class Position(BaseModel):
    stakeholder_id: str
    wants: int = Field(description="the level this stakeholder wants the conflict target at")


class Conflict(BaseModel):
    target: str = Field(description="component or edge id both stakeholders argue about")
    positions: list[Position]


class TemplateOut(BaseModel):
    slug: str = Field(description="snake_case key, e.g. 'feature_drift_scare'")
    name: str = Field(description="challenge title, 2 to 5 words")
    description: str = Field(description="two or three sentences framing the disagreement; refer to stakeholders as #stakeholder_id#")
    round_introduction: str = Field(description="two sentences on what just happened in the project")
    preconditions: Any = Field(description="predicate object over the graph that makes this challenge appear")
    priority: int = Field(description="10 to 90, higher is picked first among eligible challenges")
    on_enter_ops: list[WorldOp] = Field(description="1 to 3 world events that damage the focus stage when the challenge starts")
    stalemate_ops: list[WorldOp] = Field(description="1 or 2 world events that make things worse if the meeting ends in stalemate")
    conflict: Conflict


SYSTEM = GAME_RULES + """

Write one challenge template. A challenge is a problem that appears in the project's MLOps graph.
It starts with a world event that damages the focus stage, and two stakeholders disagree about the
fix: they want different levels for one component or edge (the conflict target).

Predicate language for preconditions (a JSON object):
  {"component": id, "op": "gte"|"lte"|"eq"|"ne"|"lt"|"gt", "level": 0..4}
  {"edge": id, "op": ..., "level": 0..4}
  {"pattern": pattern_id}
  {"instance": {"kind": k, "op": "exists", "where": {prop: {"op": "lte", "value": v}}}}
  {"all": [...]}, {"any": [...]}, {"not": {...}}
The precondition must be true in the starting graph or after small degradations of the focus stage,
and must refer to the graph (never just true).

World events (on_enter_ops, stalemate_ops) use kind "set_to" to lower a component or edge level
(0 breaks it), or "set_instance_prop" to worsen an instance property. They must only touch the
focus stage. on_enter_ops must visibly damage the focus stage."""


class TemplatesStage:
    name = "templates"
    prompt_version = "t6"
    upstream = None

    def plan(self, ctx) -> list[WorkItem]:
        items = []
        for phase_id in ctx.scope["phases"]:
            phase = ctx.phase(phase_id)
            stage_id = ctx.stage_for_phase(phase_id)
            # The introduction is the player's first meeting and teaches the mechanics, so it gets
            # one challenge with room to bargain rather than the usual pair with a red line in it.
            is_intro = phase_id == ctx.scope.get("intro_phase")
            slots = ["soft"] if is_intro else ctx.scope["conflict_types"][: ctx.templates_for_phase(phase_id)]
            components = [c.id for c in ctx.graph.components if c.stage_id == stage_id]
            for slot, conflict_type in enumerate(slots):
                items.append(WorkItem(
                    stage=self.name,
                    item_id=f"templates:p{phase_id}:s{slot}",
                    inputs={
                        "phase_id": phase_id,
                        "phase_name": phase.name,
                        "phase_description": phase.description,
                        "focus_stage": stage_id,
                        "slot": slot,
                        "conflict_type": conflict_type,
                        "roster": ctx.roster(phase_id),
                        "graph": ctx.graph_slice(stage_id),
                        "patterns": ctx.patterns_touching(stage_id),
                        "world_events": damage_menu(ctx, stage_id),
                        # Templates of one phase argue about different things.
                        "conflict_candidates": components[slot:: len(slots)],
                        "existing_challenges": [c.name for c in phase.challenges],
                        # Slots are written in parallel and cannot see each other, so left alone they
                        # cluster: a first run of the supermarket setting produced four consecutive
                        # challenges about loyalty data consent. Each slot gets its own trouble
                        # source instead.
                        "angle": ANGLES[(phase_id * len(slots) + slot) % len(ANGLES)],
                        "is_intro": is_intro,
                    },
                ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        conflict_rule = (
            "soft: one of the two could accept a compromise; the description shows who."
            if i["conflict_type"] == "soft"
            else "hard: one of the two has a red line and will not move; the description shows who."
        )
        user = "\n".join([
            f"Phase: {i['phase_name']}. {i['phase_description']}",
            f"Focus stage: {i['focus_stage']}. Conflict type {conflict_rule}",
            f"Template slot {i['slot']}; do not repeat these existing challenges: {i['existing_challenges']}",
            f"The trouble in this challenge comes from {i.get('angle', 'the project itself')}. Build the world "
            "event and the disagreement out of that, and leave the other kinds of trouble to other challenges.",
            *(["This is the player's very first meeting in the game, so it has to teach the job rather than "
               "test it. Keep the disagreement small, concrete and easy to picture, keep the damage to the "
               "project mild, and make the round_introduction welcome the player into the project."]
              if i.get("is_intro") else []),
            "Stakeholders in the room (use their ids):", render(i["roster"]),
            "Focus stage graph:", render(i["graph"]),
            "Patterns you may reference:", render(i["patterns"]),
            "World events you can use, with how much each one lowers the focus stage's health. Build "
            "on_enter_ops from these so the total drop is at least 15, and use a different one for stalemate_ops:",
            render(i["world_events"]),
            "The two conflict positions must want levels at least 2 apart, for example 1 and 3, or 2 and 4. "
            "wants means: 1 they do not want it at all, 2 done by hand, 3 automated, 4 automated and governed. "
            "What the description says each of them wants must match these numbers.",
            f"The conflict target must be one of: {i['conflict_candidates']}.",
            "Name the problem, not the argument (e.g. 'The Poisoned Dataset', not 'Data Validation Conflict').",
            "In name, description and round_introduction never mention levels or numbers; say manual, automated, "
            "missing, broken in plain words. The description names exactly the two conflict stakeholders, "
            "always as #stakeholder_id# markers, never by their plain names.",
            "The precondition must be true in the starting graph shown above (use the start_level values).",
            *feedback,
        ])
        out, usage = await llm.structured(TemplateOut, system_for(ctx, SYSTEM), user, tags={"item_id": item.item_id})
        data = out.model_dump()
        for field in ("description", "round_introduction"):
            data[field] = tokenize_names(data[field], ctx.stakeholders, style="marker")
        return data, usage

    # ---- checks ----

    def to_challenge(self, output: dict, item) -> dict:
        """The template in GameProgression shape (ids assigned at assembly)."""
        i = item.inputs
        preconditions, _ = parse_json_field("preconditions", output["preconditions"])
        return {
            "phase_id": i["phase_id"],
            "template_id": f"ch_{output['slug']}",
            "name": output["name"],
            "description": output["description"],
            "roundIntroduction": output["round_introduction"],
            "metric_changes": {},
            "attention_tokens": 20,
            "priority": int(output["priority"]),
            "preconditions": preconditions,
            "fallback": False,
            "on_enter_ops": [op_dict(o) for o in output["on_enter_ops"]],
            "stalemate_ops": [op_dict(o) for o in output["stalemate_ops"]],
            "conflict": {"type": i["conflict_type"], **output["conflict"]},
            "focus_stage_ids": [i["focus_stage"]],
        }

    def check(self, output: dict, item, ctx) -> list[str]:
        from mlops_serious_game.application.graph_service.apply import apply_ops
        from mlops_serious_game.domain.graph import GraphOp
        from mlops_serious_game.domain.graph_predicates import PredicateContext, evaluate, validate_predicate

        g = ctx.graph
        i = item.inputs
        stage_id = i["focus_stage"]
        stage_targets = {c.id for c in g.components if c.stage_id == stage_id} | {
            e.id for e in g.edges if g.stage_of(e.id) == stage_id
        }
        errors: list[str] = []
        if not SLUG.match(output["slug"] or ""):
            errors.append("slug must be snake_case, 3 to 41 characters")
        errors += sibling_collisions(output, item, ctx)
        errors += text_errors("name", output["name"], 2, 6)
        errors += text_errors("description", output["description"], 15, 90)
        errors += text_errors("round_introduction", output["round_introduction"], 10, 70)
        for label in ("name", "description", "round_introduction"):
            errors += domain_errors(label, output[label])
            if LEVEL_TALK.search(output[label] or ""):
                errors.append(f"{label} mentions levels or numbers; describe it in plain words instead")
        if BLAND_NAME.search(output["name"] or ""):
            errors.append("name the problem, not the argument (no 'conflict', 'debate', 'compromise' in the name)")
        if not 10 <= int(output["priority"]) <= 90:
            errors.append("priority must be between 10 and 90")

        roster = {r["stakeholder_id"] for r in i["roster"]}
        conflict = output["conflict"]
        ids = [p["stakeholder_id"] for p in conflict["positions"]]
        if len(ids) != 2 or len(set(ids)) != 2:
            errors.append("conflict needs exactly two different stakeholders")
        for sid in ids:
            if sid not in roster:
                errors.append(f"conflict stakeholder '{sid}' is not in the room, use one of {sorted(roster)}")
            elif f"#{sid}#" not in output["description"]:
                errors.append(f"description must name #{sid}#")
        for label in ("description", "round_introduction"):
            for sid, st in ctx.stakeholders.items():
                if st.name and st.name.lower() in (output[label] or "").lower():
                    errors.append(f"{label} writes '{st.name}' as plain text; refer to people only as #{sid}#")
        extra = set(MARKER.findall(output["description"] or "")) - set(ids)
        if extra:
            errors.append(f"description must be about the two conflict stakeholders only, not also {sorted(extra)}")
        if conflict["target"] not in stage_targets:
            errors.append(f"conflict target '{conflict['target']}' is not in the focus stage")
        elif i.get("conflict_candidates") and conflict["target"] not in i["conflict_candidates"]:
            errors.append(f"conflict target must be one of {i['conflict_candidates']}")
        else:
            allowed = g.allowed_levels(conflict["target"])
            wants = [p["wants"] for p in conflict["positions"]]
            for w in wants:
                if w not in allowed:
                    errors.append(f"wanted level {w} is not allowed on '{conflict['target']}', allowed {allowed}")
            if len(wants) == 2 and abs(wants[0] - wants[1]) < 2:
                errors.append("the two wanted levels must differ by at least 2, otherwise there is no real conflict")

        preconditions, perr = parse_json_field("preconditions", output["preconditions"])
        errors += perr
        if preconditions is True or preconditions is None:
            errors.append("preconditions must refer to the graph, not be empty or true")
        elif not perr:
            errors += [f"preconditions: {e}" for e in validate_predicate(preconditions, g, {p.id for p in ctx.patterns})]

        on_enter = [op_dict(o) for o in output["on_enter_ops"]]
        stalemate = [op_dict(o) for o in output["stalemate_ops"]]
        if not 1 <= len(on_enter) <= 3:
            errors.append("on_enter_ops needs 1 to 3 events")
        if not 1 <= len(stalemate) <= 2:
            errors.append("stalemate_ops needs 1 or 2 events")
        instance_ids = {x.id for x in g.initial_instances if x.component_id in stage_targets}
        errors += ops_errors("on_enter_ops", on_enter, g, {"set_to", "set_instance_prop"}, stage_targets | instance_ids)
        errors += ops_errors("stalemate_ops", stalemate, g, {"set_to", "set_instance_prop"}, stage_targets | instance_ids)
        if errors:
            return errors

        # Behaviour checks on the real game logic.
        start = ctx.start_state()
        samples = [start] + [
            apply_ops(g, start, [GraphOp(kind="set_to", target=t, value=v)]).state
            for t in sorted(stage_targets) for v in (0, 2)
        ]
        if not evaluate(preconditions, ctx.evaluate(start).context(g, start)).value:
            errors.append("preconditions are false in the starting graph, so the challenge is never dealt; "
                          "check them against the start_level values")
        elif all(evaluate(preconditions, ctx.evaluate(s).context(g, s)).value for s in samples):
            errors.append("preconditions are true in every graph state; make them depend on the focus stage")

        before = ctx.stage_health(start, stage_id)
        entered = apply_ops(g, start, [GraphOp.model_validate(o) for o in on_enter]).state
        after = ctx.stage_health(entered, stage_id)
        if before - after < 15:
            errors.append(
                f"on_enter_ops only moves {stage_id} health from {before} to {after}; break something that "
                "matters (set level 0 on a component other things depend on, or worsen an instance property)"
            )
        stalled = apply_ops(g, entered, [GraphOp.model_validate(o) for o in stalemate]).state
        if ctx.stage_health(stalled, stage_id) >= after:
            errors.append("stalemate_ops must make the focus stage worse than the challenge start")
        return errors

    def summary(self, output: dict) -> str:
        c = output["conflict"]
        return f"{output['name']} | conflict on {c['target']}: " + " vs ".join(
            f"{p['stakeholder_id']}={p['wants']}" for p in c["positions"]
        )


def damage_menu(ctx, stage_id: str, limit: int = 10) -> list[dict]:
    """Single world events and how much each lowers the stage's health from the starting graph.
    Computed with the game's own logic, so the model picks from what actually works."""
    from mlops_serious_game.application.graph_service.apply import apply_ops
    from mlops_serious_game.domain.graph import GraphOp

    g = ctx.graph
    start = ctx.start_state()
    base = ctx.stage_health(start, stage_id)
    options: list[dict] = []
    targets = [c.id for c in g.components if c.stage_id == stage_id]
    targets += [e.id for e in g.edges if g.stage_of(e.id) == stage_id]
    for t in targets:
        if 0 not in g.allowed_levels(t):
            continue
        op = {"kind": "set_to", "target": t, "value": "0"}
        after = apply_ops(g, start, [GraphOp.model_validate(op)]).state
        options.append({**op, "health_drop": base - ctx.stage_health(after, stage_id)})
    for inst in g.initial_instances:
        if g.is_component(inst.component_id) and g.component(inst.component_id).stage_id == stage_id:
            for prop, spec in g.instance_kinds[inst.kind].properties.items():
                op = {"kind": "set_instance_prop", "target": inst.id, "attr": prop, "value": spec.values[0]}
                after = apply_ops(g, start, [GraphOp.model_validate(op)]).state
                options.append({**op, "health_drop": base - ctx.stage_health(after, stage_id)})
    options = [o for o in options if o["health_drop"] > 0]
    options.sort(key=lambda o: (-o["health_drop"], o["target"]))
    return options[:limit]


def sibling_collisions(output: dict, item, ctx) -> list[str]:
    """Slugs and names that another template already took.

    Slots are generated in parallel and never see each other, so two of them can land on the same
    story. A duplicate slug is not only dull: assembly keys the items stage by template_id, so the
    second challenge would quietly inherit the first one's intel. Whoever is checked second is
    asked to write something else."""
    errors = []
    slug = (output.get("slug") or "").strip().lower()
    name = (output.get("name") or "").strip().lower()
    out_dir = ctx.work_dir / "out" / "templates"
    if not out_dir.exists():
        return errors
    for path in sorted(out_dir.glob("*.json")):
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):  # a run writing the file right now
            continue
        if record.get("item_id") == item.item_id:
            continue
        other = record.get("output") or {}
        if slug and (other.get("slug") or "").strip().lower() == slug:
            errors.append(f"slug '{output['slug']}' is already used by {record.get('item_id')}; "
                          "this challenge needs its own story, not a second telling of that one")
        if name and (other.get("name") or "").strip().lower() == name:
            errors.append(f"the name '{output['name']}' is already used by {record.get('item_id')}; "
                          "pick a different problem to name")
    return errors
