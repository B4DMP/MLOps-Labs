"""Stage: gists (D52, plan 11). What a Gather Generic Question turn tells the player: what a
stance note is about, never how much the stakeholder cares. Depends on `items` only, so no
existing item, artifact or objection goes stale when this stage is added.

The gate is the blind reclassification gate reversed: a second call sees only the gist and must
name the right metric (a match is required, so the gist has to be specific) but must not be able
to commit to one of the four readings (it has to answer "none", so the gist gives no direction away).
"""

from typing import Literal

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.llm import Usage
from content_gen.stages.common import (
    GAME_RULES, bare_stakeholder_id_errors, player_text_errors, render, system_for, text_errors,
    tokenize_names,
)
from content_gen.stages.items import STANCE_WORDS


class GistOut(BaseModel):
    gist: str = Field(description="8 to 25 words, third person, names the topic, never how much they care")


class GistVerdict(BaseModel):
    metric_id: str = Field(description="which metric this gist is about")
    reading: Literal["driver", "boundary", "trade_off", "fact", "none"] = Field(
        description="which of the four readings this gist commits to, or 'none' if it could be any of them"
    )
    reason: str


SYSTEM = GAME_RULES + """

Write one gist: a third-person sentence that says what a stakeholder's note is about, never how
much they care and never which way they lean. A gist names the topic in the player's own words -
the thing, system, or process it concerns - without repeating the fact sentence or the reading.

8 to 25 words. Third person ("keeps coming up", "has been raised"), never "I" or "you". Never
say whether they want more, refuse it, or would accept losing it: a reader must not be able to
tell whether this is a Driver, a Boundary, a Trade-off or a Fact from the gist alone - only what
it concerns.

Example from an unrelated project, to show the shape only:
  note   "{sales_sam} wants a weekly dashboard of lost deals; he will not present without it."
  gist   "Reporting on lost deals keeps coming up whenever you talk to {sales_sam}."
"""

CLASSIFY_GIST = """You read one short gist about an MLOps stakeholder's stance, and nothing else.
Decide two things from the gist alone:
1. Which metric is it about? Answer with exactly one of the given metric ids.
2. Does the gist commit to one of these readings: driver (wants more), boundary (a refusal),
trade_off (accepts a loss), fact (simply how things are)? Answer "none" unless the gist plainly
commits to one of them - naming a topic with no direction is "none".
Answer with the metric id, the reading (or "none"), and one sentence of reasoning.

Metric ids: """


class GistsStage:
    name = "gists"
    prompt_version = "g1"
    upstream = "items"

    def plan(self, ctx) -> list[WorkItem]:
        from mlops_serious_game.domain.requirement import STANCE_TAGS

        from content_gen.stages.items import ItemsStage

        items = []
        for record in ctx.approved("items"):
            challenge = record["inputs"]["challenge"]
            for req in ItemsStage.to_requirements(record["output"], challenge):
                if req.type not in STANCE_TAGS:
                    continue
                st = ctx.stakeholders.get(req.stakeholder_id)
                metric_id = req.metric_id or (getattr(st, "metric_id", None) if st else None)
                items.append(WorkItem(
                    stage=self.name,
                    item_id=f"gists:{req.id}",
                    depends_on=[record["item_id"]],
                    inputs={
                        "requirement_id": req.id,
                        "fact": req.fact or req.description,
                        "metric_id": metric_id,
                        "metric_ids": sorted(ctx.metric_ids - {"efficiency_intro", "model_intro"}),
                        "challenge_name": challenge["name"],
                    },
                ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        user = "\n".join([
            f"Challenge: {i['challenge_name']}",
            f"What this note is about (do not reveal how much they care, or which way they lean): {i['fact']}",
            f"Metric this note is filed under: {i['metric_id']}",
            *feedback,
        ])
        out, u1 = await llm.structured(GistOut, system_for(ctx, SYSTEM), user, tags={"item_id": item.item_id})
        gist = tokenize_names(out.gist, ctx.stakeholders)
        verdict, u2 = await llm.structured(
            GistVerdict, CLASSIFY_GIST + render(i["metric_ids"]), gist,
            tags={"item_id": item.item_id, "gate": "reverse_reclassify"},
        )
        data = {
            "gist": gist,
            "verdict_metric_id": verdict.metric_id,
            "verdict_reading": verdict.reading,
            "verdict_reason": verdict.reason,
        }
        return data, Usage(u1.tokens_in + u2.tokens_in, u1.tokens_out + u2.tokens_out)

    def check(self, output: dict, item, ctx) -> list[str]:
        i = item.inputs
        gist = output.get("gist") or ""
        errors = text_errors("gist", gist, 8, 25)
        errors += player_text_errors("gist", gist)
        errors += bare_stakeholder_id_errors("gist", gist, ctx.stakeholders)
        if match := STANCE_WORDS.search(gist):
            errors.append(f"gist says how much they care ({match.group(0)!r}); say only what it is about")
        if output.get("verdict_metric_id") != i["metric_id"]:
            errors.append(
                f"a blind reader thought this was about '{output.get('verdict_metric_id')}', not '{i['metric_id']}'; "
                "name the topic more clearly"
            )
        if output.get("verdict_reading") != "none":
            errors.append(
                f"a blind reader committed to '{output.get('verdict_reading')}' from the gist alone "
                f"({output.get('verdict_reason')}); rewrite it so it only names the topic, not a direction"
            )
        return errors

    def summary(self, output: dict) -> str:
        return (output.get("gist") or "")[:110]
