"""Writes approved content into gameConfig. Generated entries are marked so re-assembly replaces
exactly them; hand-written content is never touched."""

import json
from pathlib import Path

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

    missing = []
    challenges = []
    requirements = []
    tstage = STAGES["templates"]
    for rec in templates:
        ch = tstage.to_challenge(rec["output"], WorkItem("templates", rec["item_id"], rec["inputs"]))
        challenges.append(ch)
        irec = items.get(ch["template_id"])
        if irec is None:
            missing.append(f"items for {ch['template_id']}")
            continue
        for req in ItemsStage.to_requirements(irec["output"], ch):
            requirements.append((ch["template_id"], req))
            readings_by_req[req.id] = wrong_readings(irec["output"], req.id)
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
        if per_phase.get(phase_id, 0) != ctx.scope["templates_per_phase"]:
            missing.append(f"phase {phase_id} has {per_phase.get(phase_id, 0)} approved templates, "
                           f"scope wants {ctx.scope['templates_per_phase']}")
    if missing:
        raise AssemblyError("not everything is approved yet:\n  " + "\n  ".join(missing))
    return {"challenges": challenges, "requirements": requirements, "artifacts": artifacts,
            "objections": objections, "fragments": fragments, "wrong_readings": readings_by_req}


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
    progression["challenges"] = hand_written + sorted(generated, key=lambda c: c["id"])
    for phase in progression["phases"]:
        if phase["id"] in ctx.scope["phases"]:
            phase["challenges_per_phase"] = ctx.scope["templates_per_phase"]

    reqs = _load(cfg / "RequirementObjects.json")
    reqs["requirements"] = [r for r in reqs["requirements"] if not str(r["id"]).startswith("gen_")]
    arts = _load(cfg / "OfflineIntelArtifacts.json")
    arts["artifacts"] = [a for a in arts["artifacts"] if not str(a["id"]).startswith("art_gen_")]
    known_done: set[str] = set()
    for template_id, req in data["requirements"]:
        req = req.model_copy(update={"challenge_id": ids[template_id]})
        reqs["requirements"].append(req.model_dump(mode="json", exclude_none=True, exclude_defaults=False))
        art = data["artifacts"][req.id]
        # One artifact per challenge is already on the public record, as an example of a finished call.
        is_known = req.type == "driver" and template_id not in known_done
        if is_known:
            known_done.add(template_id)
        arts["artifacts"].append({
            "id": f"art_{req.id}",
            "requirement_id": req.id,
            "challenge_id": ids[template_id],
            "stakeholder_id": req.stakeholder_id,
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
