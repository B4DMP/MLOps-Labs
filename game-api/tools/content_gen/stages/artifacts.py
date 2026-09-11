"""Stage 3: one artifact per intel item, plus the blind reclassification gate.

A second model call sees only the artifact text and must recover the item's tag. If it cannot,
the artifact is ambiguous and gets rewritten, with the reader's reasoning as feedback.
"""

import hashlib
from typing import Literal, Optional

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.llm import Usage
from content_gen.stages.common import GAME_RULES, WISH_WORDS, render, text_errors

STANCE_TYPES = ["email", "slack_message", "meeting_notes", "document"]
FACT_TYPES = ["runbook", "dashboard_snapshot", "incident_ticket", "ci_log", "architecture_note"]
TAGS = ["driver", "boundary", "trade_off", "fact"]


class ArtifactOut(BaseModel):
    content: str = Field(description="the artifact body, 60 to 150 words, no title or subject line")


class Classification(BaseModel):
    tag: Literal["driver", "boundary", "trade_off", "fact"]
    reason: str


SYSTEM = GAME_RULES + """

Write one in-world artifact the player reads during intel gathering. It must reveal exactly one
intel item, and a careful reader must be able to tell which kind it is:
- driver: the author wants something improved, more is better, and could be talked into less.
- boundary: the author states a line they will not cross; refusal is explicit or clearly implied.
- trade_off: the author says what they would give up or accept losing to get what they want.
- fact: a neutral technical record of how the system is. Nobody's wish, refusal or acceptance.
Stance artifacts are written by the stakeholder in their own voice. Fact artifacts read like
system output or engineering notes. No title, subject line, greeting header or signature block.
"""

CLASSIFY = """You read one workplace artifact from an MLOps project. Decide what it tells you,
using this test in order:
1. Is anyone's wish, refusal or acceptance in it? If no: fact.
2. Does it state something the author would give up or accept losing? If yes: trade_off.
3. It states a need. Would doing more than asked make them happier? yes: driver.
   no, it is a line whose crossing means refusal: boundary.
Answer with the tag and one sentence of reasoning."""


def artifact_type(item_id: str, tag: str) -> str:
    choices = FACT_TYPES if tag == "fact" else STANCE_TYPES
    return choices[int(hashlib.sha256(item_id.encode()).hexdigest(), 16) % len(choices)]


class ArtifactsStage:
    name = "artifacts"
    prompt_version = "a2"
    upstream = "items"

    def plan(self, ctx) -> list[WorkItem]:
        from content_gen.stages.items import ItemsStage

        items = []
        for record in ctx.approved("items"):
            challenge = record["inputs"]["challenge"]
            for req in ItemsStage.to_requirements(record["output"], challenge):
                st = ctx.stakeholders.get(req.stakeholder_id) if req.stakeholder_id else None
                items.append(WorkItem(
                    stage=self.name,
                    item_id=f"artifacts:{req.id}",
                    depends_on=[record["item_id"]],
                    inputs={
                        "requirement": req.model_dump(mode="json"),
                        "artifact_type": artifact_type(req.id, req.type),
                        "author": {"name": st.name, "role": st.role_description} if st else None,
                        "challenge": {"name": challenge["name"], "description": challenge["description"]},
                    },
                ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        req = i["requirement"]
        user = "\n".join([
            f"Challenge: {i['challenge']['name']}. {i['challenge']['description']}",
            f"Artifact type: {i['artifact_type']}",
            f"Author: {render(i['author'])}" if i["author"] else "Author: a system or an engineer writing neutrally",
            f"Intel item ({req['type']}). Fact: {req.get('fact') or req['description']} Reading: {req.get('reading') or ''}",
            "Write the stakeholder's name in full wherever it appears; the braces are placeholders "
            "the game fills in, so keep them exactly as given, e.g. {data_dave}.",
            *feedback,
        ])
        art, u1 = await llm.structured(ArtifactOut, SYSTEM, user, tags={"item_id": item.item_id})
        verdict, u2 = await llm.structured(Classification, CLASSIFY, art.content, tags={"item_id": item.item_id, "gate": "reclassify"})
        out = art.model_dump()
        out["reclassified_as"] = verdict.tag
        out["reclassify_reason"] = verdict.reason
        return out, Usage(u1.tokens_in + u2.tokens_in, u1.tokens_out + u2.tokens_out)

    def check(self, output: dict, item, ctx) -> list[str]:
        req = item.inputs["requirement"]
        tag = req["type"]
        errors = text_errors("content", output["content"], 50, 170)
        first = (output["content"] or "").strip().split("\n", 1)[0].lower()
        if first.startswith(("subject:", "title:", "re:", "from:", "to:")):
            errors.append("start directly with the body, no subject, title or header line")
        if tag == "fact" and WISH_WORDS.search(output["content"] or ""):
            errors.append("a fact artifact states nobody's wishes, preferences or refusals")
        if output.get("reclassified_as") != tag:
            errors.append(
                f"a blind reader classified this as {output.get('reclassified_as')} ({output.get('reclassify_reason')}); "
                f"rewrite it so it clearly reads as a {tag}"
            )
        return errors

    def summary(self, output: dict) -> str:
        return f"reads as {output.get('reclassified_as')}: {output['content'][:90]}"
