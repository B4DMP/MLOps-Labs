"""Stage: a comedic rewrite of one artifact already selected by `content_gen select-humor`
(humor_selection.py), in the voice/device assigned there. Mirrors ArtifactsStage's own
two-call shape: one call writes the candidate, a second reads it blind and must confirm it
actually lands as a joke, not just mood - the same self-check pattern ArtifactsStage already
uses for its reclassification gate (see artifacts.py). A weak/reject verdict is a check()
error, so the existing per-item retry loop regenerates with the reviewer's own reason as
feedback - no separate 5-candidates-up-front batch needed, the retry loop *is* the write/review
cycle done by hand in game-ui/src/components/dev/humor-memo/Process.tsx.

Devices, hard constraints and the voice model here are a straight port of that file's
ARTIFACT_WRITER_PROMPT/ARTIFACT_REVIEWER_PROMPT - keep the two in sync by hand; there is no
build-time link between this Python tool and the TSX dev page.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field

from content_gen.humor_selection import ARTIFACT_ARCHETYPES
from content_gen.ledger import WorkItem
from content_gen.llm import Usage
from content_gen.stages.common import (
    GAME_RULES, bare_stakeholder_id_errors, domain_errors, system_for, text_errors, tokenize_names,
)

DEVICE_DESCRIPTIONS = {
    "Retroactively-satisfiable criterion": "a vague trade-off condition that can always be declared met after the fact.",
    "Silence mistaken for testimony": "an absence gets treated as a deliberate, on-purpose data point.",
    "Undetectable falsehood in a plausible dataset": "almost everything checks out, and not knowing which one thing doesn't is the joke.",
    "Recursive bureaucracy": "a process needs its own meta-process (a form to approve the form).",
    "Personification": "an inanimate process or object is described as having its own attitude toward the rule it's bound by.",
    "A health check that asks the wrong question": "a shallow check (did it run) stands in for the real one (is it correct) - land it with one concrete, absurd, still-plausible example of what the shallow check would wave through.",
    "A gap left idling with a pet's patience": "an automation gap, anthropomorphized as waiting patiently for a human to notice.",
}
assert set(DEVICE_DESCRIPTIONS) == set(ARTIFACT_ARCHETYPES), "humor.py device list drifted from humor_selection.py"

VOICE_MODEL = """VOICE MODEL (don't deviate):
- Good Omens (Gaiman/Pratchett): real large stakes sit completely unremarked next to characters' small, petty, in-the-room focus. Never narrated or explained, just placed there.
- Monty Python (Dead Parrot / Ministry of Silly Walks): institutional denial via escalating euphemism; absurd bureaucratic functions treated with total unblinking sincerity.
- Douglas Adams (the Vogons): a bureaucratic process outweighs, in the characters' own minds, the catastrophe the process just caused, irritation about the paperwork inconvenience, not alarm about the disaster."""

# Wikipedia:Signs of AI writing, plus a few tech-corporate clichés (game-ui/.../Slop.tsx). DASHES
# in common.py already bans every dash outright, stricter than just the spaced em dash.
AI_SLOP = re.compile(
    r"\b(delve|boasts?|testament|tapestry|vibrant|underscores?|crucial|robust|seamless|leverage|"
    r"fostering|intricate|nuanced|realm|garnered|notably|multifaceted|streamline|showcase|highlight|"
    r"pivotal|landscape|navigate|journey|unlock|elevate|resonate|ecosystem|load.bearing|table stakes|"
    r"north star|circle back)\b", re.I,
)

WRITE_SYSTEM = GAME_RULES + "\n\n" + VOICE_MODEL + """

Rewrite the artifact below, in this stakeholder's own voice, using ONLY the assigned device (see
user message). Unlike a human writer, you cannot decline and ask for a different device here; if
the fit feels strained, write the most honest, least-forced application of it you can, rather than
reaching for an unrelated device instead. The reviewer pass and the human checkpoint downstream
are what catch a genuine mismatch.

Hard constraints:
1. Preserve every fact from the original. Do not drop or invent a negotiation-relevant detail.
2. Target a process, a form, a deadline, a mismatch of scale, never this stakeholder's own
   competence or personality. No caricature, no verbal tics, no mockery of who they are.
3. Still reads as a comprehensible intel document a player can act on.
4. Any technical, legal or compliance term (consent, audit, governance, ownership, liability)
   keeps referring to who or what it actually refers to, never personified onto the wrong subject.
5. Any metaphor or image must be understandable on a single read.
6. The joke's mechanism must arise from this artifact's own MLOps component, never an invented,
   unconnected mechanism bolted on for a laugh.
7. Mood is not a joke: turning up the emotional temperature of a fact already stated doesn't
   count, it needs a second, incongruous, concrete layer.
8. A gap, shallow check or missing safeguard needs one concrete illustrative instance of what it
   would actually miss or let through. Naming the category of failure is still just the mechanism,
   not a joke yet.
9. Hard cap 150 words.
10. Keep every {stakeholder_id} token exactly as given, never the plain name.
11. The player is an MLOps novice, not a seasoned practitioner. Never rely on the reader already
   recognizing an outside professional or cultural register (corporate jargon, legal procedure,
   a specific sport's officiating rules) to decode the joke - a device that requires that literacy
   obscures the fact instead of sharpening it. Self-contained, universally accessible images only."""

REVIEW_SYSTEM = """You are an adversarial reviewer for comedy writing in a serious game about MLOps.
Be genuinely harsh, assume the candidate fails, and make it prove otherwise. Do not be diplomatic.

Reject (verdict "reject") if any of these hold:
- Drops or changes a fact from the original.
- Targets the stakeholder's own competence or personality instead of a process or system.
- Only turns up emotional temperature with no second incongruous layer (mood, not a joke).
- Describes a gap or shallow check only in the abstract, with no concrete illustrative instance
  of what it would actually miss or let through.
- The metaphor or image needs explaining to land.
- Does not actually use the assigned device.
- Requires the reader to already know an outside professional or cultural register (corporate
  jargon, legal procedure, a sport's officiating rules) to decode it - the player is an MLOps
  novice, and a joke that needs that literacy obscures the fact instead of sharpening it.

Mark "weak" (not necessarily rejected, but flagged) if it uses the assigned device correctly but
isn't genuinely funny, just competent understatement.

Otherwise "strong"."""


class HumorOut(BaseModel):
    content: str = Field(description="the full rewritten artifact, 50 to 150 words")


class HumorVerdict(BaseModel):
    verdict: Literal["strong", "weak", "reject"]
    reason: str
    used_assigned_device: bool


class HumorStage:
    name = "humor"
    prompt_version = "h1"
    upstream = "artifacts"

    def plan(self, ctx) -> list[WorkItem]:
        items = []
        for record in ctx.approved("artifacts"):
            output = record.get("output", {})
            if output.get("humor_status") != "selected":
                continue
            req = record["inputs"]["requirement"]
            items.append(WorkItem(
                stage=self.name,
                item_id=f"humor:{req['id']}",
                depends_on=[record["item_id"]],
                inputs={
                    "original_content": output["content"],
                    "device": output["humor_archetype"],
                    "requirement": req,
                    "challenge": record["inputs"]["challenge"],
                },
            ))
        return items

    async def generate(self, item, ctx, llm, feedback):
        i = item.inputs
        device = i["device"]
        user = "\n".join([
            f"Challenge: {i['challenge']['name']}. {i['challenge']['description']}".rstrip(". ") + ".",
            f"Assigned device: {device} - {DEVICE_DESCRIPTIONS[device]}",
            f"Original artifact:\n{i['original_content']}",
            f"Fact/reading this artifact must preserve: {i['requirement'].get('fact') or i['requirement'].get('description', '')} "
            f"{i['requirement'].get('reading') or ''}",
            *feedback,
        ])
        candidate, u1 = await llm.structured(HumorOut, system_for(ctx, WRITE_SYSTEM), user, tags={"item_id": item.item_id})
        candidate.content = tokenize_names(candidate.content, ctx.stakeholders)

        review_user = f"Assigned device: {device} - {DEVICE_DESCRIPTIONS[device]}\n\nCandidate:\n{candidate.content}"
        verdict, u2 = await llm.structured(HumorVerdict, REVIEW_SYSTEM, review_user, tags={"item_id": item.item_id, "gate": "humor_review"})

        out = candidate.model_dump()
        out["device"] = device
        out["verdict"] = verdict.model_dump()
        return out, Usage(u1.tokens_in + u2.tokens_in, u1.tokens_out + u2.tokens_out)

    def check(self, output: dict, item, ctx) -> list[str]:
        errors = text_errors("content", output["content"], 50, 150)
        errors += bare_stakeholder_id_errors("content", output["content"], ctx.stakeholders)
        errors += domain_errors("content", output["content"])
        if slop := AI_SLOP.search(output["content"] or ""):
            errors.append(f"content contains '{slop.group(0)}', an AI-writing tell; use plainer language")
        verdict = output.get("verdict", {})
        if verdict.get("verdict") == "reject":
            errors.append(f"adversarial review rejected this: {verdict.get('reason')}")
        elif not verdict.get("used_assigned_device", True):
            errors.append(f"did not use the assigned device ({item.inputs['device']}): {verdict.get('reason')}")
        return errors

    def summary(self, output: dict) -> str:
        return f"[{output.get('device')}, {output.get('verdict', {}).get('verdict')}] {output['content'][:80]}"
