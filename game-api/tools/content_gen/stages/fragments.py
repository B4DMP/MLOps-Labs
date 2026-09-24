"""Stage 5: story fragments, one line per allowed level of every target in the scope's stages.

These replace the generic per-level templates for the targets the player will actually look at."""

from typing import Optional

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.stages.common import GAME_RULES, LEVEL_NAMES, player_text_errors, render, system_for, text_errors


class FragmentsOut(BaseModel):
    level_0: Optional[str] = Field(default=None, description="broken")
    level_1: Optional[str] = Field(default=None, description="absent")
    level_2: Optional[str] = Field(default=None, description="manual")
    level_3: Optional[str] = Field(default=None, description="automated")
    level_4: Optional[str] = Field(default=None, description="governed")


SYSTEM = GAME_RULES + """

Write one short sentence per level describing how this part of the MLOps system looks at that
level, concretely, as a project manager would notice it. Plain present tense, 6 to 22 words."""


class FragmentsStage:
    name = "fragments"
    prompt_version = "f1"
    upstream = None

    def plan(self, ctx) -> list[WorkItem]:
        g = ctx.graph
        stage_ids = {ctx.stage_for_phase(p) for p in ctx.scope["phases"]}
        items = []
        for c in g.components:
            if c.stage_id in stage_ids:
                items.append(WorkItem(self.name, f"fragments:{c.id}", {
                    "target": c.id, "kind": "component", "name": c.name, "levels": narrative_tiers(c),
                }))
        for e in g.edges:
            if e.kind == "pipeline" and g.stage_of(e.id) in stage_ids:
                items.append(WorkItem(self.name, f"fragments:{e.id}", {
                    "target": e.id, "kind": "edge", "levels": narrative_tiers(e),
                    "name": f"hand over from {g.component(e.from_id).name} to {g.component(e.to_id).name}",
                }))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        user = "\n".join([
            f"Target: {i['name']} ({i['kind']}).",
            "Write lines for these levels only: " + render({lv: LEVEL_NAMES[lv] for lv in i["levels"]}),
            *feedback,
        ])
        out, usage = await llm.structured(FragmentsOut, system_for(ctx, SYSTEM), user, tags={"item_id": item.item_id})
        return out.model_dump(), usage

    def check(self, output: dict, item, ctx) -> list[str]:
        errors = []
        for lv in item.inputs["levels"]:
            text = output.get(f"level_{lv}")
            errors += text_errors(f"level_{lv}", text, 5, 26) + player_text_errors(f"level_{lv}", text)
        return errors

    def summary(self, output: dict) -> str:
        return " / ".join(v for v in output.values() if v)[:120]


def narrative_tiers(target) -> list[int]:
    """The 0-4 storytelling tiers a target can reach from its two axes, the same set the game's
    fragment gate (story.missing_specific_fragments) asks lines for."""
    from mlops_serious_game.domain.graph import narrative_tier

    return sorted({narrative_tier(a, g) for a in target.allowed_automation for g in target.allowed_governance})
