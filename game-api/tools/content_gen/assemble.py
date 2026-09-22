"""Writes approved content into gameConfig. Generated entries are marked so re-assembly replaces
exactly them; hand-written content is never touched."""

import json
from pathlib import Path
from typing import Optional

from content_gen.ledger import WorkItem
from content_gen.stages import STAGES
from content_gen.stages.items import ItemsStage, wrong_readings

ID_LOCK = "assembly_ids.json"


class AssemblyError(RuntimeError):
    pass


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def collect(ctx) -> dict:
    """Everything approved, checked for completeness. Raises with the list of what is missing."""
    templates = ctx.approved("templates")
    items = {r["inputs"]["challenge"]["template_id"]: r for r in ctx.approved("items")}
    readings_by_req: dict[str, dict] = {}
    artifacts = {r["inputs"]["requirement"]["id"]: r for r in ctx.approved("artifacts")}
    objections = {r["item_id"].removeprefix("objections:"): r for r in ctx.approved("objections")}
    fragments = ctx.approved("fragments")
    # Gists (D52) are optional: a stance item with none yet uses the runtime fallback, so nothing
    # here is added to `missing` for it.
    gists = {r["item_id"].removeprefix("gists:"): r for r in ctx.approved("gists")}

    missing = []
    challenges = []
    requirements = []
    tstage = STAGES["templates"]
    seen_templates: dict[str, str] = {}
    for rec in templates:
        ch = tstage.to_challenge(rec["output"], WorkItem("templates", rec["item_id"], rec["inputs"]))
        # Two templates with one id would share a single items record, so the second challenge would
        # silently be dealt with the first one's intel. Refuse rather than assemble that.
        if ch["template_id"] in seen_templates:
            raise AssemblyError(
                f"two approved templates both call themselves {ch['template_id']}: "
                f"{seen_templates[ch['template_id']]} and {rec['item_id']}. Reject one of them with a note "
                "to pick a different problem, then rerun the templates stage."
            )
        seen_templates[ch["template_id"]] = rec["item_id"]
        challenges.append(ch)
        irec = items.get(ch["template_id"])
        if irec is None:
            missing.append(f"items for {ch['template_id']}")
            continue
        for req in ItemsStage.to_requirements(irec["output"], ch):
            requirements.append((ch["template_id"], req))
            readings_by_req[req.id] = wrong_readings(irec["output"], req.id, ch["template_id"].removeprefix("ch_"))
            if req.id not in artifacts:
                missing.append(f"artifact for {req.id}")
            if req.type != "fact" and req.id not in objections:
                missing.append(f"objection for {req.id}")
    stage_ids = {c["focus_stage_ids"][0] for c in challenges}
    for comp in ctx.graph.components:
        if comp.stage_id in stage_ids and f"technical:{comp.id}" not in objections:
            missing.append(f"technical objection for {comp.id}")
    per_phase: dict[int, int] = {}
    for ch in challenges:
        per_phase[ch["phase_id"]] = per_phase.get(ch["phase_id"], 0) + 1
    for phase_id in ctx.scope["phases"]:
        wanted = ctx.templates_for_phase(phase_id)
        if per_phase.get(phase_id, 0) != wanted:
            missing.append(f"phase {phase_id} has {per_phase.get(phase_id, 0)} approved templates, "
                           f"scope wants {wanted}")
    if missing:
        raise AssemblyError("not everything is approved yet:\n  " + "\n  ".join(missing))
    return {"challenges": challenges, "requirements": requirements, "artifacts": artifacts,
            "objections": objections, "fragments": fragments, "wrong_readings": readings_by_req, "gists": gists}


def _conflict_target(challenge: dict):
    conflict = challenge.get("conflict")
    return conflict.get("target") if isinstance(conflict, dict) else getattr(conflict, "target", None)


def _conflict_stakeholder_ids(challenge: dict) -> set[str]:
    conflict = challenge.get("conflict")
    if conflict is None:
        return set()
    positions = conflict.get("positions") if isinstance(conflict, dict) else getattr(conflict, "positions", None)
    return {p.get("stakeholder_id") if isinstance(p, dict) else p.stakeholder_id for p in (positions or [])}


def _stance_target(req) -> Optional[str]:
    """The graph target a stance requirement is about.

    `item_target` (domain.requirement) is the shared runtime resolver, but it does not read a
    Trade-off's `branch_x`/`branch_y` - both branches act on the same component at different
    levels, so either one names it. Kept local to content assembly rather than widened on the
    shared resolver, since that function feeds live pitch/dossier logic this fix doesn't touch.
    """
    from mlops_serious_game.domain.requirement import item_target

    target = item_target(req)
    if target is not None:
        return target
    for branch in (req.branch_x, req.branch_y):
        if branch is not None and getattr(branch, "target", None):
            return branch.target
    return None


def on_record_ids(requirements, artifacts: dict, conflict_targets: dict, conflict_stakeholders: dict) -> set[str]:
    """What each challenge starts with on the public record.

    Both stances that frame the conflict, one per stakeholder on either side, and the challenge
    itself: the first Fact about the disputed component, which the whole team already knows. That
    Fact needs a narrator, since an on-record card is something somebody said openly.

    A conflict stakeholder's stance is matched to the conflict by its graph target when the item
    carries one; some authored Trade-offs concede a metric without naming a target at all (only
    `concedes.metric_id`/`loss`, no `concedes.target`, no `ops`), so a stakeholder in the conflict
    with no target-matched stance still gets their first stance item - they are in the conflict
    either way, and it is the only stance they have to show for it.
    """
    from mlops_serious_game.domain.requirement import STANCE_TAGS

    fact_done: set[str] = set()
    known: set[str] = set()
    matched: dict[str, set[str]] = {}
    fallback: dict[tuple[str, str], str] = {}
    for template_id, req in requirements:
        wanted_stakeholders = conflict_stakeholders.get(template_id, set())
        if req.type in STANCE_TAGS and req.stakeholder_id in wanted_stakeholders:
            fallback.setdefault((template_id, req.stakeholder_id), req.id)
            if _stance_target(req) == conflict_targets.get(template_id):
                done = matched.setdefault(template_id, set())
                if req.stakeholder_id not in done:
                    done.add(req.stakeholder_id)
                    known.add(req.id)
        elif (req.type == "fact" and template_id not in fact_done
              and artifacts[req.id]["inputs"].get("narrator")
              and req.asserts is not None and req.asserts.target == conflict_targets.get(template_id)):
            fact_done.add(template_id)
            known.add(req.id)
    for (template_id, stakeholder_id), req_id in fallback.items():
        if stakeholder_id not in matched.get(template_id, set()):
            known.add(req_id)
    return known


def assemble(ctx, dry_run: bool = False) -> dict:
    data = collect(ctx)
    cfg = ctx.config_dir
    lock_path = ctx.work_dir / ID_LOCK
    lock = _load(lock_path) if lock_path.exists() else {}

    progression = _load(cfg / "GameProgression.json")
    hand_written = [c for c in progression["challenges"] if not c.get("generated")]
    next_id = max([c["id"] for c in progression["challenges"]] + list(lock.values()) + [99]) + 1
    ids: dict[str, int] = {}
    for ch in sorted(data["challenges"], key=lambda c: c["template_id"]):
        if ch["template_id"] not in lock:
            lock[ch["template_id"]] = next_id
            next_id += 1
        ids[ch["template_id"]] = lock[ch["template_id"]]
    generated = [{"id": ids[ch["template_id"]], **ch, "generated": True} for ch in data["challenges"]]
    assign_fallbacks(generated, [c for c in hand_written if not c.get("retired")])
    progression["challenges"] = hand_written + sorted(generated, key=lambda c: c["id"])
    for phase in progression["phases"]:
        # How many challenges a player gets dealt in a phase is pacing, not content: it is tuned by
        # hand against the target session length, so assembly only fills it in where it is missing.
        # A phase that has never been given one falls back to one challenge, which is how the game
        # was paced before the fallbacks became generated content.
        if phase["id"] in ctx.scope["phases"] and phase.get("challenges_per_phase") is None:
            if any(c["phase_id"] == phase["id"] for c in generated):
                phase["challenges_per_phase"] = 1

    reqs = _load(cfg / "RequirementObjects.json")
    reqs["requirements"] = [r for r in reqs["requirements"] if not str(r["id"]).startswith("gen_")]
    arts = _load(cfg / "OfflineIntelArtifacts.json")
    arts["artifacts"] = [a for a in arts["artifacts"] if not str(a["id"]).startswith("art_gen_")]
    known_ids = on_record_ids(
        data["requirements"], data["artifacts"],
        {ch["template_id"]: _conflict_target(ch) for ch in data["challenges"]},
        {ch["template_id"]: _conflict_stakeholder_ids(ch) for ch in data["challenges"]},
    )
    for template_id, req in data["requirements"]:
        gist_rec = data["gists"].get(req.id)
        update = {"challenge_id": ids[template_id]}
        if gist_rec is not None:
            update["gist"] = gist_rec["output"]["gist"]
        req = req.model_copy(update=update)
        reqs["requirements"].append(req.model_dump(mode="json", exclude_none=True, exclude_defaults=False))
        art = data["artifacts"][req.id]
        is_known = req.id in known_ids
        arts["artifacts"].append({
            "id": f"art_{req.id}",
            "requirement_id": req.id,
            "challenge_id": ids[template_id],
            "stakeholder_id": req.stakeholder_id,
            **({"narrator_id": art["inputs"]["narrator"]["id"]} if art["inputs"].get("narrator") else {}),
            "artifact_type": art["inputs"]["artifact_type"],
            "content": art["output"]["content"],
            # Readings only: the game puts the unchanged fact in front of them (split wording).
            "wrong_descriptions": data["wrong_readings"][req.id],
            "is_known": is_known,
        })

    objections = {"stance": [], "technical": []}
    for key, rec in sorted(data["objections"].items()):
        out, i = rec["output"], rec["inputs"]
        if i["kind"] == "technical":
            objections["technical"].append({"component_id": i["component"]["id"], "stakeholder_id": i["speaker"]["id"],
                                            "text": out["line"]})
        else:
            objections["stance"].append({"intel_id": i["requirement"]["id"], "stakeholder_id": i["speaker"]["id"],
                                         "kind": i["kind"], "text": out["objection"], "correction": out["correction"]})

    fragments = _load(cfg / "MlopsStoryFragments.json")
    added = 0
    for rec in data["fragments"]:
        target = rec["inputs"]["target"]
        slot = fragments["targets"].setdefault(target, {})
        for lv in rec["inputs"]["levels"]:
            text = rec["output"].get(f"level_{lv}")
            if text and str(lv) not in slot:
                slot[str(lv)] = text
                added += 1

    summary = {
        "challenges": {t: i for t, i in sorted(ids.items())},
        "requirements": len(data["requirements"]),
        "artifacts": len(data["requirements"]),
        "objections": {k: len(v) for k, v in objections.items()},
        "fragments_added": added,
    }
    if dry_run:
        return summary
    _save(cfg / "GameProgression.json", progression)
    _save(cfg / "RequirementObjects.json", reqs)
    _save(cfg / "OfflineIntelArtifacts.json", arts)
    _save(cfg / "MlopsObjections.json", objections)
    _save(cfg / "MlopsStoryFragments.json", fragments)
    _save(lock_path, lock)
    return summary


def assign_fallbacks(generated: list[dict], hand_written: list[dict]) -> None:
    """Give every phase exactly one fallback challenge, which the game's loader insists on.

    The fallbacks used to be the six hand written challenges. They were written for a generic ML
    project, carried no intel payloads and between them contained no Trade-offs, so they were
    removed rather than rewritten. Each phase now falls back to one of its own generated
    challenges: the lowest priority one, since the fallback is what the player gets when nothing
    more specific fits the state of the project."""
    phases_covered = {c["phase_id"] for c in hand_written if c.get("fallback")}
    by_phase: dict[int, list[dict]] = {}
    for ch in generated:
        ch["fallback"] = False
        by_phase.setdefault(ch["phase_id"], []).append(ch)
    for phase_id, challenges in by_phase.items():
        if phase_id in phases_covered:  # a hand written fallback still holds this phase
            continue
        fallback = min(challenges, key=lambda c: (c["priority"], c["template_id"]))
        fallback["fallback"] = True
        # A fallback is dealt when nothing else qualifies, so it must not be gated on the graph.
        fallback["preconditions"] = True
