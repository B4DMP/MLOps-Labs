"""Stage 4: pre-authored objection lines, fired deterministically in the pitch (plan 06).

One work item per stance item (its main objection plus the mis-tag correction) and one per focus
stage component (the owner's technical objection when a change there would be capped)."""

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.stages.common import GAME_RULES, render, text_errors, tokenize_names

KIND_FOR_TAG = {"driver": "stance", "boundary": "boundary", "trade_off": "price"}


class StanceObjection(BaseModel):
    objection: str = Field(description="one or two sentences the stakeholder says in the meeting")
    correction: str = Field(description="one or two sentences correcting a player who mis-read this item")


class TechnicalObjection(BaseModel):
    line: str = Field(description="one or two sentences; must contain {target} and {cause} placeholders")


SYSTEM = GAME_RULES + """

Write spoken lines for a stakeholder in a project meeting, in first person, plainly, no more than
two sentences each. Keep placeholders in braces exactly as given."""

GUIDE = {
    "stance": "The proposal does not do enough for what they want. They push for more, without refusing.",
    "boundary": "The proposal crosses their line. They refuse, clearly and without drama.",
    "price": "The proposal takes something from them without saying so. They ask for it to be acknowledged.",
}


class ObjectionsStage:
    name = "objections"
    prompt_version = "o3"
    upstream = "items"

    def plan(self, ctx) -> list[WorkItem]:
        from content_gen.stages.items import ItemsStage

        items = []
        stages_done: set[str] = set()
        for record in ctx.approved("items"):
            challenge = record["inputs"]["challenge"]
            for req in ItemsStage.to_requirements(record["output"], challenge):
                if req.type == "fact":
                    continue
                st = ctx.stakeholders[req.stakeholder_id]
                items.append(WorkItem(
                    stage=self.name,
                    item_id=f"objections:{req.id}",
                    depends_on=[record["item_id"]],
                    inputs={
                        "kind": KIND_FOR_TAG[req.type],
                        "requirement": req.model_dump(mode="json"),
                        "speaker": {"id": st.id, "name": st.name, "role": st.role_description},
                    },
                ))
            stages_done.add(challenge["focus_stage_ids"][0])
        for stage_id in sorted(stages_done):
            for comp in ctx.graph.components:
                if comp.stage_id != stage_id:
                    continue
                owner = ctx.stakeholders.get(ctx.graph.owner_of(comp.id))
                items.append(WorkItem(
                    stage=self.name,
                    item_id=f"objections:technical:{comp.id}",
                    inputs={
                        "kind": "technical",
                        "component": {"id": comp.id, "name": comp.name},
                        "speaker": {"id": owner.id, "name": owner.name, "role": owner.role_description},
                    },
                ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        if i["kind"] == "technical":
            user = "\n".join([
                f"Speaker: {render(i['speaker'])}",
                f"They own {i['component']['name']}. The proposal wants to improve {{target}}, but it will not "
                "deliver, because {cause} upstream is not good enough yet. Write their objection. Use the "
                "placeholders {target} and {cause} literally.",
                *feedback,
            ])
            out, usage = await llm.structured(TechnicalObjection, SYSTEM, user, tags={"item_id": item.item_id})
        else:
            req = i["requirement"]
            user = "\n".join([
                f"Speaker: {render(i['speaker'])}",
                f"What they told us ({req['type']}): {req['description']}",
                f"Objection: {GUIDE[i['kind']]}",
                "Correction: the player filed this under the wrong kind of intel. The speaker sets the "
                "record straight about what they actually meant.",
                "Write the speaker's name as the placeholder given, e.g. {data_dave}, if they refer to themselves by name.",
                *feedback,
            ])
            out, usage = await llm.structured(StanceObjection, SYSTEM, user, tags={"item_id": item.item_id})
        data = out.model_dump()
        return {k: tokenize_names(v, ctx.stakeholders) if k != "line" else v for k, v in data.items()}, usage

    def check(self, output: dict, item, ctx) -> list[str]:
        if item.inputs["kind"] == "technical":
            errors = text_errors("line", output["line"], 8, 55)
            for ph in ("{target}", "{cause}"):
                if ph not in (output["line"] or ""):
                    errors.append(f"line must contain the placeholder {ph} exactly once")
            return errors
        return text_errors("objection", output["objection"], 6, 55) + text_errors("correction", output["correction"], 6, 55)

    def summary(self, output: dict) -> str:
        return output.get("line") or output.get("objection", "")
