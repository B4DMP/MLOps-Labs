"""Content gates on the assembled config (plan 04). Errors block, warnings are reported.

The game's own loader runs first: graph DAG, payloads, template references, fallbacks. Then the
content-specific gates, scoped to the phases the scope covers."""

import json
from dataclasses import dataclass, field

from content_gen.context import Context
from content_gen.stages.common import DASHES, domain_errors


@dataclass
class GateReport:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def run_gates(config_dir, work_dir, scope: str, scope_data: dict | None = None) -> GateReport:
    report = GateReport()
    try:
        ctx = Context.load(config_dir, work_dir, scope, scope_data)
    except Exception as e:
        report.errors.append(f"game config does not load: {e}")
        return report

    from mlops_serious_game.application.graph_service.apply import apply_ops
    from mlops_serious_game.application.graph_service.scheduler import select_in_phase
    from mlops_serious_game.application.graph_service.story import missing_specific_fragments
    from mlops_serious_game.domain.graph import GraphOp
    from mlops_serious_game.domain.requirement_factory import RequirementFactory

    g = ctx.graph
    progression = json.loads((ctx.config_dir / "GameProgression.json").read_text(encoding="utf-8"))
    generated = [c for c in progression["challenges"] if c.get("generated")]
    gen_ids = {c["id"] for c in generated}
    stage_ids = {ctx.stage_for_phase(p) for p in ctx.scope["phases"]}
    reqs = [r for r in RequirementFactory.requirements if r.challenge_id in gen_ids]

    # 1. Blind reclassification, recorded at generation time.
    for rec in ctx.approved("artifacts"):
        tag = rec["inputs"]["requirement"]["type"]
        if rec["output"].get("reclassified_as") != tag:
            report.errors.append(f"reclassification: {rec['item_id']} reads as {rec['output'].get('reclassified_as')}, not {tag}")

    # 3. Orphans: every component and pipeline edge in scope is something a Driver can ask for.
    asked = {r.suggested.target for r in reqs if r.type == "driver" and r.suggested}
    asked |= {op["target"] for r in reqs for op in r.ops}
    in_scope = [c.id for c in g.components if c.stage_id in stage_ids]
    in_scope += [e.id for e in g.pipeline_edges() if g.stage_of(e.id) in stage_ids]
    orphans = [t for t in in_scope if t not in asked]
    if orphans:
        (report.errors if ctx.scope.get("orphans_block") else report.warnings).append(
            f"orphans: nothing in the generated content asks for {orphans}"
        )

    # 4. Story fragments for every reachable level in scope.
    missing = [(t, lv) for t, lv in missing_specific_fragments(g) if t in set(in_scope)]
    if missing:
        report.errors.append(f"fragments: {len(missing)} target levels in scope only have the generic line, e.g. {missing[:5]}")

    # 6. Objection coverage.
    obj_path = ctx.config_dir / "MlopsObjections.json"
    objections = json.loads(obj_path.read_text(encoding="utf-8")) if obj_path.exists() else {"stance": [], "technical": []}
    covered = {o["intel_id"] for o in objections["stance"]}
    for r in reqs:
        if r.type != "fact" and r.id not in covered:
            report.errors.append(f"objections: no objection line for {r.id}")
    technical = {o["component_id"] for o in objections["technical"]}
    for c in g.components:
        if c.stage_id in stage_ids and c.id not in technical:
            report.errors.append(f"objections: no technical objection for {c.id}")

    # 7. Conflict sanity is enforced per template at the items stage; here: every generated
    #    template has one, and its type is one the scope asks for.
    for c in generated:
        if not c.get("conflict") or c["conflict"]["type"] not in ctx.scope["conflict_types"]:
            report.errors.append(f"conflict: {c['template_id']} has no usable conflict")

    # 7b. The incident is on record: what the opening world event broke is a Fact the player can read
    #     from the start, however the conflict is framed.
    on_record_reqs = {
        a["requirement_id"]
        for a in json.loads((ctx.config_dir / "OfflineIntelArtifacts.json").read_text(encoding="utf-8"))["artifacts"]
        if a.get("is_known")
    }
    for c in generated:
        broken = {op["target"] for op in c.get("on_enter_ops") or [] if op.get("target")}
        if broken and not any(
            r.challenge_id == c["id"] and r.type == "fact" and r.asserts is not None
            and r.asserts.target in broken and r.id in on_record_reqs
            for r in reqs
        ):
            report.errors.append(
                f"incident: {c['template_id']} opens by breaking {sorted(broken)} but no Fact about it is on record at the start"
            )

    # 8. Voice: no dashes anywhere in generated text.
    texts = [(c["template_id"], c["description"] + " " + c["roundIntroduction"] + " " + c["name"]) for c in generated]
    texts += [(r.id, r.description) for r in reqs]
    arts = json.loads((ctx.config_dir / "OfflineIntelArtifacts.json").read_text(encoding="utf-8"))["artifacts"]
    texts += [(a["id"], a["content"] + " " + " ".join(a["wrong_descriptions"].values()))
              for a in arts if str(a["id"]).startswith("art_gen_")]
    texts += [(o["intel_id"], o["text"] + " " + o["correction"]) for o in objections["stance"]]
    for where, text in texts:
        if DASHES.search(text):
            report.errors.append(f"voice: {where} contains a dash")
        report.errors += [f"setting: {e}" for e in domain_errors(where, text)]

    # 8b. Stance mix: the player needs more to bargain with than to work around, so trade-offs
    #     outnumber red lines across the generated content.
    from content_gen.stages.items import DEFAULT_STANCE_MIX

    mix = ctx.scope.get("stance_mix", DEFAULT_STANCE_MIX)
    stance_reqs = [r for r in reqs if r.type != "fact"]
    if stance_reqs:
        share = {tag: sum(1 for r in stance_reqs if r.type == tag) / len(stance_reqs)
                 for tag in ("driver", "boundary", "trade_off")}
        n = len(stance_reqs)
        if share["trade_off"] < mix.get("trade_off_min_share", 0):
            report.errors.append(
                f"stance mix: only {share['trade_off']:.0%} of the {n} generated stances are trade_offs, "
                f"the scope asks for at least {mix.get('trade_off_min_share', 0):.0%}")
        if share["trade_off"] > mix.get("trade_off_max_share", 1):
            report.errors.append(
                f"stance mix: {share['trade_off']:.0%} of the {n} generated stances are trade_offs, the scope "
                f"allows at most {mix.get('trade_off_max_share', 1):.0%}; the rooms need people pushing too")
        if share["driver"] < mix.get("driver_min_share", 0):
            report.errors.append(
                f"stance mix: only {share['driver']:.0%} of the {n} generated stances are drivers, the scope "
                f"asks for at least {mix.get('driver_min_share', 0):.0%}; drivers are what proposals are built from")
        if share["boundary"] > mix.get("boundary_max_share", 1):
            report.errors.append(
                f"stance mix: {share['boundary']:.0%} of the {n} generated stances are boundaries, "
                f"the scope allows at most {mix.get('boundary_max_share', 1):.0%}")

    # 8c. Per challenge: items per stakeholder by quadrant, hand-over and composite coverage. Warnings
    #     until content is regenerated under the new shape; `shape_blocks` turns them into errors.
    from content_gen.solvability import repair_errors, room_of, veto_free_errors
    from content_gen.stages.items import (
        DEFAULT_STANCE_SHAPE, challenge_state, shape_errors, stance_quotas,
    )
    from mlops_serious_game.domain.requirement import self_contradictions

    shape = {**DEFAULT_STANCE_SHAPE, **ctx.scope.get("stance_shape", {})}
    shape_report = report.errors if ctx.scope.get("shape_blocks") else report.warnings
    for c in generated:
        stances = [r for r in reqs if r.challenge_id == c["id"] and r.type != "fact"]
        roster = ctx.roster(c["phase_id"])
        for sid, quota in stance_quotas(ctx.scope, roster, c["template_id"]).items():
            have = sum(1 for r in stances if r.stakeholder_id == sid)
            if have != quota:
                shape_report.append(f"shape: {c['template_id']}: {sid} has {have} stance items, needs {quota}")
        stage_id = c["focus_stage_ids"][0]
        stage_edges = {e.id for e in g.edges if g.stage_of(e.id) == stage_id}
        shape_report += [f"shape: {c['template_id']}: {e}" for e in shape_errors(stances, g, shape, stage_edges)]

        # 8d. No stakeholder's items undo each other (always blocking).
        report.errors += [f"contradiction: {c['template_id']}: {m}" for m in self_contradictions(stances)]

        # 8e. The challenge can be passed without a veto (always blocking).
        report.errors += [f"veto: {c['template_id']}: {m}" for m in veto_free_errors(ctx, c, roster, stances)]
        report.errors += [
            f"repair: {c['template_id']}: {m}"
            for m in repair_errors(ctx.graph, challenge_state(ctx, c), stances, room_of(roster), c, c.get("par_outcome", "PASS"))
        ]

    # 9. Voiced Facts: a Fact is dealt under its narrator's name, so the narrator must be in the room.
    phase_of = {c["id"]: c["phase_id"] for c in generated}
    fact_ids = {r.id for r in reqs if r.type == "fact"}
    for a in arts:
        if a["requirement_id"] not in fact_ids or a["challenge_id"] not in phase_of:
            continue
        roster = {ps.stakeholder_id for ps in ctx.phase(phase_of[a["challenge_id"]]).stakeholders}
        if a.get("narrator_id") not in roster:
            report.errors.append(f"narrator: {a['id']} has no narrator from phase {phase_of[a['challenge_id']]}'s room")

    # 10. Selection: every generated template can actually be dealt.
    start = ctx.start_state()
    samples = [start]
    for c in generated:
        samples.append(apply_ops(g, start, [GraphOp.model_validate(o) for o in c["on_enter_ops"]]).state)
    for t in sorted(in_scope):
        if g.is_component(t):
            samples.append(apply_ops(g, start, [GraphOp(kind="set_to", target=t, axis="automation", value=0)]).state)
    contexts = [ctx.evaluate(s).context(g, s) for s in samples]
    for phase_id in ctx.scope["phases"]:
        phase = ctx.phase(phase_id)
        reached: set[str] = set()
        # Deal the phase's whole quota per sampled state, not only its first challenge.
        for pctx in contexts:
            for seed in ("a", "b", "c", "d"):
                played: set[str] = set()
                for _ in range(phase.challenge_quota):
                    pick = select_in_phase(phase, pctx, played, seed)
                    if pick is None:
                        break
                    played.add(pick.template_id)
                reached |= played
        for c in phase.challenges:
            if not c.fallback and c.template_id not in reached:
                report.errors.append(f"selection: {c.template_id} is never dealt in sampled graph states")
    return report
