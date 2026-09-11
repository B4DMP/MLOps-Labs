"""Stage 2: the intel items of a challenge. Stances (Driver, Boundary, Trade-off) for the people in the
room, Facts about the focus stage. Checked with the same payload gate the game loads with."""

import re
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.stages.common import GAME_RULES, WISH_WORDS, op_dict, parse_json_field, render, text_errors, tokenize_names

KEY = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
LEVEL_TALK = re.compile(r"\blevels?\b|\b[0-4]\b")
LEVEL_NUMBERS = re.compile(r"\b[0-4]\b")  # readings may say "governed", never "level 4"
BECAUSE = re.compile(r"\b(because|so that|in order to)\b", re.I)  # not "since": usually about time
# A stance fact must read the same whatever the tag: how much they care belongs in the reading.
STANCE_WORDS = re.compile(r"\b(refuses?|will not|won't|never|could accept|can accept|accepts?|can live|willing|insists?|demands?|must not|cannot)\b", re.I)
EXAMPLE_READINGS = {
    "the more detail it shows, the better his forecasts get.",
    "he will not present to the board without it.",
    "he would give it up if the reporting budget is needed elsewhere.",
}


class StanceOp(BaseModel):
    kind: Literal["raise_to", "set_trigger", "set_attr"]
    target: str
    value: Union[int, str]
    attr: Optional[str] = None


class Readings(BaseModel):
    driver: str = Field(description="how it reads if they want it and more is better")
    boundary: str = Field(description="how it reads if it is a line they will not cross")
    trade_off: str = Field(description="how it reads if it is something they would give up")
    fact: str = Field(description="how it reads if it is simply the state of the system, nobody's wish")


TAGS = ("driver", "boundary", "trade_off", "fact")


class ItemOut(BaseModel):
    key: str = Field(description="short snake_case key, unique in this challenge")
    tag: Literal["driver", "boundary", "trade_off", "fact"]
    stakeholder_id: Optional[str] = Field(default=None, description="null for a fact")
    fact: str = Field(description="first sentence: what they want or did, never why and never how much they care")
    readings: Readings = Field(description="the second sentence for each of the four tags; the item's tag picks the true one")
    metric_id: Optional[str] = None
    suggested_target: Optional[str] = None
    suggested_level: Optional[int] = None
    holds: Any = Field(default=None, description="boundary only: predicate object that must hold")
    ops: list[StanceOp] = Field(default_factory=list)
    concedes_metric: Optional[str] = None
    concedes_loss: Optional[int] = None
    concedes_target: Optional[str] = None
    concedes_max_level: Optional[int] = None
    asserts_target: Optional[str] = None
    asserts_level: Optional[int] = None
    asserts_trigger: Optional[str] = None


class ItemsOut(BaseModel):
    items: list[ItemOut]


SYSTEM = GAME_RULES + """

Write the intel items for one challenge. Each item is one thing the player can find out.

Every item is one fact sentence plus four reading sentences, one per tag. The fact says what the
stakeholder proposed or observed, never why and never how much they care: it has to fit all four
readings. Each reading is the second sentence the player would see under that tag. The item's tag
says which reading is true; the other three are what a player who picked the wrong tag would think.
Neutral fact verbs: asked for, proposed, brought up, suggested, mentioned, noted. Never in a fact:
insists, refuses, will not, willing, accepts, can live with, demands, never, must not, cannot. Those
belong in readings. A fact item's fact sentence names no person and uses no wish words.
Never mention levels or numbers in any text: say broken, missing, done by hand, automated, governed.

The fact must say WHAT happened or what the system state is, never WHY. Wrong: "{data_dave} asked
for cost savings in experiment tracking." Right: "{data_dave} proposed keeping experiment tracking
done by hand."

Example from an unrelated project — stance item, to show the shape only:
  fact      "{sales_sam} asked for a weekly dashboard of lost deals."
  driver    "The more detail it shows, the better his forecasts get."
  boundary  "He will not present to the board without it."
  trade_off "He would give it up if the reporting budget is needed elsewhere."
  fact      "That is simply what the reporting setup produces today."

For a fact item, the fact sentence describes a current system state with no person in it. All four
readings must be SPECIFIC to this item — they must name the component, pipeline, or behaviour this
fact is about. Generic phrases like "someone on the team wants it this way" or "they will not
accept changes" are wrong: they could apply to any item and tell the player nothing useful. Example:
  fact      "Data validation runs against a static schema written two years ago."
  driver    "Updating the schema would catch the class of errors that reached production last month."
  boundary  "Any schema change requires a compliance sign-off that blocks an immediate fix."
  trade_off "Migrating to automated validation would mean rewriting those rules, which costs a sprint."
  fact      "That is simply how the validation setup works today."

Tags and payloads:
- driver: something a stakeholder wants improved, more is better. Needs metric_id (one of the
  metrics given), suggested_target (a component or edge in the focus stage) and suggested_level
  (higher than its current level). The reading is a direction: more is better."
- boundary: a line a stakeholder will not cross. Needs holds, a JSON predicate that must be
  true after the player's proposal (e.g. {"component": "data.validation", "op": "gte", "level": 3}),
  and ops that make it true (e.g. raise_to data.validation 3). The reading is a refusal.
- trade_off: something a stakeholder would give up or accept losing. Needs concedes_metric with
  concedes_loss (1 to 10), or concedes_target with concedes_max_level. May carry ops such as
  set_attr sourcing bought. The reading is acceptance of a cost.
- fact: how the system is right now, nobody's wish. stakeholder_id null. Needs asserts_target (a
  focus stage component or edge) and asserts_level equal to its CURRENT level given below (and
  asserts_trigger for edges if you state it). Neutral wording with no wishes or opinions.

Predicate language: {"component": id, "op": "gte"|"lte"|..., "level": 0..4}, {"edge": id, ...},
{"all": [...]}, {"any": [...]}, {"not": {...}}. Ops: raise_to (value = level), set_trigger (value
= trigger), set_attr (attr = attribute name, value = one of its values)."""


class ItemsStage:
    name = "items"
    prompt_version = "i8"
    upstream = "templates"

    def plan(self, ctx) -> list[WorkItem]:
        from content_gen.stages.templates import TemplatesStage

        tstage = TemplatesStage()
        items = []
        for record in ctx.approved("templates"):
            template_item = WorkItem(stage="templates", item_id=record["item_id"], inputs=record["inputs"])
            challenge = tstage.to_challenge(record["output"], template_item)
            phase_id = challenge["phase_id"]
            stage_id = challenge["focus_stage_ids"][0]
            items.append(WorkItem(
                stage=self.name,
                item_id=f"items:{challenge['template_id']}",
                depends_on=[record["item_id"]],
                inputs={
                    "challenge": challenge,
                    "roster": ctx.roster(phase_id),
                    "graph": ctx.graph_slice(stage_id),
                    "current": current_levels(ctx, challenge),
                    "metrics": sorted(ctx.metric_ids - {"efficiency_intro", "model_intro"}),
                    "counts": {"stances": ctx.scope["stances_per_template"], "facts": ctx.scope["facts_per_template"]},
                },
            ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        c = i["challenge"]
        conflict = c["conflict"]
        sides = " or ".join(p["stakeholder_id"] for p in conflict["positions"])
        rule = (
            f"whichever of {sides} the description shows could compromise needs a trade_off about "
            f"{conflict['target']} (concedes_target)."
            if conflict["type"] == "soft"
            else f"whichever of {sides} the description shows will not move needs a boundary whose holds "
            f"refers to {conflict['target']}."
        )
        user = "\n".join([
            f"Challenge: {c['name']}. {c['description']} {c['roundIntroduction']}",
            f"Conflict ({conflict['type']}) on {conflict['target']}: " + render(conflict["positions"]) + f" Rule: {rule}",
            f"Write {i['counts']['stances'][0]} to {i['counts']['stances'][1]} stance items (every stakeholder in the "
            f"room gets at least one; at least one driver, one boundary, one trade_off overall) and "
            f"{i['counts']['facts'][0]} to {i['counts']['facts'][1]} facts.",
            "Stakeholders in the room:", render(i["roster"]),
            "Metrics:", render(i["metrics"]),
            "Focus stage graph:", render(i["graph"]),
            "Current levels and triggers right after the challenge starts (facts must match these):", render(i["current"]),
            *feedback,
        ])
        out, usage = await llm.structured(ItemsOut, SYSTEM, user, tags={"item_id": item.item_id})
        data = out.model_dump()
        for it in data["items"]:
            it["fact"] = tokenize_names(it["fact"], ctx.stakeholders)
            it["readings"] = {t: tokenize_names(r, ctx.stakeholders) for t, r in it["readings"].items()}
        return data, usage

    # ---- conversion and checks ----

    @staticmethod
    def to_requirements(output: dict, challenge: dict, challenge_id: int = -1) -> list:
        from mlops_serious_game.domain.requirement import StakeholderRequirement

        slug = challenge["template_id"].removeprefix("ch_")
        reqs = []
        for it in output["items"]:
            holds, _ = parse_json_field("holds", it.get("holds"))
            data = {
                "id": f"gen_{slug}_{it['key']}",
                "challenge_id": challenge_id,
                "stakeholder_id": it.get("stakeholder_id") if it["tag"] != "fact" else None,
                "type": it["tag"],
                "fact": it["fact"],
                "reading": it["readings"][it["tag"]],
                "metric_id": it.get("metric_id"),
                "holds": holds,
                "ops": [op_dict(o) for o in it.get("ops") or []],
            }
            if it.get("suggested_target") is not None and it.get("suggested_level") is not None:
                data["suggested"] = {"target": it["suggested_target"], "level": it["suggested_level"]}
            if any(it.get(k) is not None for k in ("concedes_metric", "concedes_target")):
                data["concedes"] = {
                    "metric_id": it.get("concedes_metric"),
                    "loss": it.get("concedes_loss"),
                    "target": it.get("concedes_target"),
                    "accepts_max_level": it.get("concedes_max_level"),
                }
            if it.get("asserts_target") is not None:
                data["asserts"] = {"target": it["asserts_target"], "level": it.get("asserts_level"),
                                   "trigger": it.get("asserts_trigger")}
            reqs.append(StakeholderRequirement.model_validate(data))
        return reqs

    def check(self, output: dict, item, ctx) -> list[str]:
        from mlops_serious_game.domain.graph_predicates import validate_predicate
        from mlops_serious_game.domain.pattern import predicate_targets
        from mlops_serious_game.domain.requirement_factory import payload_errors

        g = ctx.graph
        i = item.inputs
        c = i["challenge"]
        stage_id = c["focus_stage_ids"][0]
        roster = {r["stakeholder_id"] for r in i["roster"]}
        current = i["current"]
        errors: list[str] = []

        keys = [it["key"] for it in output["items"]]
        for k in keys:
            if not KEY.match(k or ""):
                errors.append(f"key '{k}' must be short snake_case")
        if len(keys) != len(set(keys)):
            errors.append("keys must be unique")
        for it in output["items"]:
            if it["tag"] == "boundary" and it.get("holds"):
                holds, perr = parse_json_field(f"{it['key']} holds", it["holds"])
                errors += perr
                if holds is not None and not perr:
                    errors += [f"{it['key']} holds: {e}" for e in validate_predicate(holds, g)]
        if errors:
            return errors
        try:
            reqs = self.to_requirements(output, c)
        except Exception as e:
            return [f"items do not form valid intel: {e}"]
        errors += payload_errors(reqs, g, ctx.metric_ids, set(ctx.stakeholders))

        stances = [r for r in reqs if r.type != "fact"]
        true_readings: list[str] = []
        for it in output["items"]:
            variants = [it["readings"][t].strip().lower() for t in TAGS]
            if len(set(variants)) != len(variants):
                errors.append(f"{it['key']}: the four readings must all be different")
            for t in TAGS:
                text = it["readings"][t]
                errors += text_errors(f"{it['key']} reading {t}", text, 3, 22)
                if LEVEL_NUMBERS.search(text or ""):
                    errors.append(f"{it['key']}: reading {t} names a level number; say broken, missing, manual, "
                                  "automated or governed instead")
                if t != "fact" and text.strip().lower() in EXAMPLE_READINGS:
                    errors.append(f"{it['key']}: reading {t} copies the prompt's example; write one about this item")
            if it["tag"] != "fact":
                true_readings.append(it["readings"][it["tag"]].strip().lower())
        dupes = sorted({x for x in true_readings if true_readings.count(x) > 1})
        if dupes:
            errors.append(f"true readings must be specific to their item; repeated: {dupes}")
        fact_texts = [it["fact"].strip().rstrip(".").lower() for it in output["items"]]
        dupe_facts = sorted({f for f in fact_texts if fact_texts.count(f) > 1})
        if dupe_facts:
            errors.append(f"fact sentences must be distinct across items; repeated: {dupe_facts[:3]}")
        facts = [r for r in reqs if r.type == "fact"]
        lo, hi = i["counts"]["stances"]
        if not lo <= len(stances) <= hi:
            errors.append(f"write {lo} to {hi} stance items, not {len(stances)}")
        lo, hi = i["counts"]["facts"]
        if not lo <= len(facts) <= hi:
            errors.append(f"write {lo} to {hi} facts, not {len(facts)}")
        for tag in ("driver", "boundary", "trade_off"):
            if not any(r.type == tag for r in stances):
                errors.append(f"at least one {tag} is missing")
        for sid in roster:
            if not any(r.stakeholder_id == sid for r in stances):
                errors.append(f"{sid} is in the room but has no stance")

        stage_targets = {t for t in current}
        for r in reqs:
            where = r.id.removeprefix(f"gen_{c['template_id'].removeprefix('ch_')}_")
            errors += text_errors(f"{where} fact", r.fact, 4, 25)
            if r.fact and LEVEL_TALK.search(r.fact):
                errors.append(f"{where}: the fact mentions levels or numbers; say broken, missing, manual, automated")
            if r.type != "fact" and r.fact and STANCE_WORDS.search(r.fact):
                errors.append(f"{where}: the fact says how much they care ({STANCE_WORDS.search(r.fact).group(0)!r}); "
                              "keep it neutral and move that into the reading")
            if r.fact and BECAUSE.search(r.fact):
                errors.append(f"{where}: the fact says what, never why; move the reason into the reading")
            if r.fact and r.reading and r.fact.strip().rstrip(".").lower() in r.reading.lower():
                errors.append(f"{where}: the reading must not repeat the fact")
            if r.type == "fact":
                if WISH_WORDS.search(r.description):
                    errors.append(f"{where}: a fact states no wishes or refusals, rewrite it neutrally")
                a = r.asserts
                if a and a.target in current:
                    if a.level is not None and a.level != current[a.target]["level"]:
                        errors.append(f"{where}: {a.target} is at level {current[a.target]['level']}, not {a.level}")
                    if a.trigger is not None and a.trigger != current[a.target].get("trigger"):
                        errors.append(f"{where}: {a.target} trigger is {current[a.target].get('trigger')}, not {a.trigger}")
                elif a:
                    errors.append(f"{where}: facts must be about the focus stage ({stage_id})")
                continue
            if r.stakeholder_id not in roster:
                errors.append(f"{where}: {r.stakeholder_id} is not in the room")
            if f"{{{r.stakeholder_id}}}" not in (r.fact or ""):
                errors.append(f"{where}: the fact must name the stakeholder as {{{r.stakeholder_id}}}")
            if r.type == "driver":
                if not (r.metric_id and r.suggested):
                    errors.append(f"{where}: a driver needs metric_id and a suggested target and level")
                elif r.suggested.target in current and r.suggested.level <= current[r.suggested.target]["level"]:
                    errors.append(f"{where}: suggested level must be above the current level {current[r.suggested.target]['level']}")
                elif r.suggested.target not in stage_targets:
                    errors.append(f"{where}: suggested target must be in the focus stage")
            if r.type == "boundary" and (r.holds is None or not r.ops):
                errors.append(f"{where}: a boundary needs holds and the ops that satisfy it")
            if r.type == "trade_off" and r.concedes is None:
                errors.append(f"{where}: a trade_off needs what it concedes")

        conflict = c["conflict"]
        sides = {p["stakeholder_id"] for p in conflict["positions"]}
        if conflict["type"] == "soft":
            ok = any(
                r.type == "trade_off" and r.stakeholder_id in sides and r.concedes
                and (r.concedes.target == conflict["target"] or any(o.get("target") == conflict["target"] for o in r.ops))
                for r in reqs
            )
            if not ok:
                errors.append(f"soft conflict: one of {sorted(sides)} needs a trade_off conceding on {conflict['target']}")
        else:
            ok = any(
                r.type == "boundary" and r.stakeholder_id in sides and conflict["target"] in predicate_targets(r.holds)
                for r in reqs
            )
            if not ok:
                errors.append(f"hard conflict: one of {sorted(sides)} needs a boundary whose holds refers to {conflict['target']}")
        return errors

    def summary(self, output: dict) -> str:
        from collections import Counter

        tags = Counter(it["tag"] for it in output["items"])
        return ", ".join(f"{n} {t}" for t, n in sorted(tags.items()))


def current_levels(ctx, challenge: dict) -> dict:
    """Nominal level and trigger of every focus stage target right after the challenge's world event."""
    from mlops_serious_game.application.graph_service.apply import apply_ops
    from mlops_serious_game.domain.graph import GraphOp

    g = ctx.graph
    state = apply_ops(g, ctx.start_state(), [GraphOp.model_validate(o) for o in challenge["on_enter_ops"]]).state
    stage_id = challenge["focus_stage_ids"][0]
    out = {}
    for comp in g.components:
        if comp.stage_id == stage_id:
            out[comp.id] = {"level": state.level(comp.id)}
    for e in g.edges:
        if g.stage_of(e.id) == stage_id:
            out[e.id] = {"level": state.level(e.id), "trigger": state.edge_triggers.get(e.id)}
    return out


def wrong_readings(output: dict, requirement_id: str) -> dict:
    """The readings of an item for the tags it is not: what a player with each wrong tag sees."""
    for it in output["items"]:
        if requirement_id.endswith("_" + it["key"]):
            return {t: it["readings"][t] for t in TAGS if t != it["tag"]}
    return {}
