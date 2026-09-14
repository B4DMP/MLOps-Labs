"""Stage 3: one artifact per intel item, plus the blind reclassification gate.

A second model call sees only the artifact text and must recover the item's tag. If it cannot,
the artifact is ambiguous and gets rewritten, with the reader's reasoning as feedback.
"""

import hashlib
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

from content_gen.ledger import WorkItem
from content_gen.llm import Usage
from content_gen.stages.common import GAME_RULES, WISH_WORDS, bare_stakeholder_id_errors, render, text_errors, tokenize_names

# Facts come in the same formats as stances. A runbook or a CI log would give the tag away before
# the player read a word, so a Fact is a stakeholder telling you how things stand.
ARTIFACT_TYPES = ["email", "slack_message", "meeting_notes", "document"]


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
- fact: a stakeholder reports how the system is right now. Nobody's wish, refusal or acceptance,
  not even the narrator's own.
Stance artifacts are written by the stakeholder in their own voice. Fact artifacts are written by,
or record what was said by, the narrator you are given, in the same kind of message a stance would
come in. The narrator reports what they see; they do not take a side in this artifact.
No title, subject line, greeting header or signature block.

A second reader will classify your text blind, with this test, in this order:
1. Is anyone's wish, refusal or acceptance in it? If no: fact.
2. Does it state something the author would give up or accept losing? If yes: trade_off.
3. It states a need. Would doing more than asked make them happier? yes: driver.
   no, it is a line whose crossing means refusal: boundary.
So write each kind to pass that test:
- driver: say what they want and that more of it is better; never mention giving anything up and
  never draw a line they would refuse to cross.
- boundary: state the line and that crossing it means they refuse; offer no compromise.
- trade_off: say plainly what they would give up or accept losing, and what they get for it.
- fact: only observations and measurements, in the narrator's voice; no needs, suggestions,
  improvements, costs or opinions, from the narrator or anyone else. Write it as a colleague
  mentioning how things go, in passing, the way a stance would read. Never announce that it is a
  report: no "for the record", "logging the current state", "status update", "I want to note" or
  "I report", and no closing line that sums up the state."""

CLASSIFY = """You read one workplace artifact from an MLOps project. Decide what it tells you,
using this test in order:
1. Is anyone's wish, refusal or acceptance in it? If no: fact.
2. Does it state something the author would give up or accept losing? If yes: trade_off.
3. It states a need. Would doing more than asked make them happier? yes: driver.
   no, it is a line whose crossing means refusal: boundary.
Answer with the tag and one sentence of reasoning."""


# A fact about something missing drifts into why it should exist, which a reader takes as a need.
# A Fact that announces itself as a report is tagged by its framing, not its content.
REPORT_FRAMING = re.compile(
    r"\b(for the record|logging the (current )?state|status update|state of things|i (want|wanted) to "
    r"(note|highlight|flag|log|document)|i report|to summari[sz]e|in summary|i am (noting|observing)"
    r"|standard (operating )?procedure|operational state|wanted to flag|passing (this |it )?along|same page"
    # closing lines that sum the state up: "This is how the registry functions right now."
    r"|(it|this|that) is (just |simply |exactly )?(how|what|the (exact |current |observed |existing )?"
    r"(state|way|setup|workflow|configuration|process|arrangement))"
    r"|(observed|exact|current) state of|the (whole |entire )?process (is|remains) (entirely|static)|i am (just )?documenting"
    r"|to document the|operational reality|(remains|operates) in (a|this) (state|mode)|set up that way|no further observations"
    # notes that comment on their own neutrality: "he did not suggest any changes, just described it"
    r"|did not suggest|(simply|just|only) described|current reality)\b",
    re.I,
)
# A Fact states no cost and no judgement; "tedious" or "prone to errors" hands the player a Driver.
FACT_OPINION = re.compile(
    r"\b(tedious|hassle|painful|annoying|frustrat\w*|prone to|error.prone|slow and|a pain|cumbersome|inefficient)\b",
    re.I,
)
# The player never sees the graph; an artifact that talks about it breaks the fiction.
GAME_META = re.compile(
    r"\b(infrastructure graph|the graph|graph node|components?|component level|level [0-4]|topology map|the edge between"
    r"|specific edge|edge in (our|the) pipeline)\b",
    re.I,
)

ABSENT_HINT = ("The fact is that something does not exist. Describe only how the work is done today "
               "without it, as observed events or numbers. No consequences, risks, costs or benefits.")


def _asserts_absent(req) -> bool:
    return req.type == "fact" and req.asserts is not None and req.asserts.level is not None and req.asserts.level <= 1


def _stable_index(key: str, n: int) -> int:
    return int(hashlib.sha256(key.encode()).hexdigest(), 16) % n


def artifact_type(item_id: str) -> str:
    return ARTIFACT_TYPES[_stable_index(item_id, len(ARTIFACT_TYPES))]


def narrator_for(req, roster: list[dict], graph) -> Optional[dict]:
    """Who voices a Fact: the owner of what it describes, when they are in the room, since that is
    who would know. Otherwise someone in the room, picked by item id so a rerun keeps the voice."""
    if not roster:
        return None
    by_id = {r["stakeholder_id"]: r for r in roster}
    target = req.asserts.target if req.asserts else None
    if target and graph.is_target(target) and graph.owner_of(target) in by_id:
        chosen = by_id[graph.owner_of(target)]
    else:
        chosen = roster[_stable_index(req.id, len(roster))]
    return {"id": chosen["stakeholder_id"], "name": chosen["name"], "role": chosen["role"]}


class ArtifactsStage:
    name = "artifacts"
    prompt_version = "a5"
    upstream = "items"

    def plan(self, ctx) -> list[WorkItem]:
        from content_gen.stages.items import ItemsStage

        items = []
        for record in ctx.approved("items"):
            challenge = record["inputs"]["challenge"]
            for req in ItemsStage.to_requirements(record["output"], challenge):
                is_fact = req.type == "fact"
                if is_fact:
                    voice = {"narrator": narrator_for(req, ctx.roster(challenge["phase_id"]), ctx.graph)}
                else:
                    st = ctx.stakeholders.get(req.stakeholder_id) if req.stakeholder_id else None
                    voice = {"author": {"name": st.name, "role": st.role_description} if st else None}
                items.append(WorkItem(
                    stage=self.name,
                    item_id=f"artifacts:{req.id}",
                    depends_on=[record["item_id"]],
                    inputs={
                        "requirement": req.model_dump(mode="json"),
                        "artifact_type": artifact_type(req.id),
                        **voice,
                        # Fact artifacts get no conflict description: given the dispute, the model
                        # narrates it and the fact stops reading as a fact.
                        "challenge": {"name": challenge["name"], "description": "" if is_fact else challenge["description"]},
                        **({"hint": ABSENT_HINT} if _asserts_absent(req) else {}),
                    },
                ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        req = i["requirement"]
        if i.get("narrator"):
            narrator = {"name": i["narrator"]["name"], "role": i["narrator"]["role"]}
            token = "{" + i["narrator"]["id"] + "}"
            if i["artifact_type"] == "meeting_notes":
                person = f"The notes record what {token} reported."
            else:
                person = f"{token} wrote this: first person throughout, never their own name or {token}."
            voice_line = (f"Narrator (reports the fact, takes no side in this artifact): {render(narrator)} "
                          f"{person} Do not reuse any reading of the item as a sentence.")
        elif i.get("author"):
            voice_line = f"Author: {render(i['author'])}"
        else:
            voice_line = "Author: an engineer writing neutrally"
        user = "\n".join([
            f"Challenge: {i['challenge']['name']}. {i['challenge']['description']}".rstrip(". ") + ".",
            f"Artifact type: {i['artifact_type']}",
            voice_line,
            f"Intel item ({req['type']}). Fact: {req.get('fact') or req['description']} Reading: {req.get('reading') or ''}",
            "Write the stakeholder's name in full wherever it appears; the braces are placeholders "
            "the game fills in, so keep them exactly as given, e.g. {data_dave}.",
            *([i["hint"]] if i.get("hint") else []),
            *feedback,
        ])
        art, u1 = await llm.structured(ArtifactOut, SYSTEM, user, tags={"item_id": item.item_id})
        art.content = tokenize_names(art.content, ctx.stakeholders)
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
        if tag == "fact" and (framing := REPORT_FRAMING.search(output["content"] or "")):
            errors.append(f"'{framing.group(0)}' announces a report; mention how things go in passing, as a colleague would")
        if tag == "fact" and (opinion := FACT_OPINION.search(output["content"] or "")):
            errors.append(f"'{opinion.group(0)}' is a judgement or a cost; a fact artifact only says what happens")
        if meta := GAME_META.search(output["content"] or ""):
            errors.append(f"'{meta.group(0)}' talks about the game model; describe the work, never the graph or its levels")
        narrator = item.inputs.get("narrator")
        if narrator and item.inputs["artifact_type"] != "meeting_notes" and f"{{{narrator['id']}}}" in (output["content"] or ""):
            errors.append(f"{{{narrator['id']}}} is the one writing this; refer to them as I, never by name")
        if output.get("reclassified_as") != tag:
            errors.append(
                f"a blind reader classified this as {output.get('reclassified_as')} ({output.get('reclassify_reason')}); "
                f"rewrite it so it clearly reads as a {tag}"
            )
        errors += bare_stakeholder_id_errors("content", output["content"], ctx.stakeholders)
        return errors

    def summary(self, output: dict) -> str:
        return f"reads as {output.get('reclassified_as')}: {output['content'][:90]}"
