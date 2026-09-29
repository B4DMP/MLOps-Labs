"""Emotion-conditioned humor for pitch-debate dialogue (docs/plans/... via
game-ui/.../humor-memo/Correction.tsx - keep the prompt text and per-state menu in sync with
that page by hand, same as content_gen's own stages/humor.py; there is no build-time link
between any of these three copies.

Gated on intensity (a turn's emotion vector distance from neutral) so most turns say nothing -
"a few gems, not everywhere," never a joke on every single line. Devices are the same technique-5
catalog content_gen's humor stage uses, restricted to the ones that compress to one clause (this
device list intentionally excludes anything needing the full ~150 words to sustain itself)."""

from typing import Optional

from mlops_serious_game.domain.emotion_factory import EmotionFactory

# Same one-line descriptions as game-api/tools/content_gen/stages/humor.py's DEVICE_DESCRIPTIONS,
# for the subset that fits in a single clause.
DEVICE_DESCRIPTIONS = {
    "recursive bureaucracy": "a process needs its own meta-process (a form to approve the form).",
    "personification": "an inanimate process or object is described as having its own attitude toward the rule it's bound by.",
    "a gap left idling with a pet's patience": "an automation gap, anthropomorphized as waiting patiently for a human to notice.",
    "a health check that asks the wrong question": "a shallow check (did it run) stands in for the real one (is it correct).",
    "silence mistaken for testimony": "an absence gets treated as a deliberate, on-purpose data point.",
    "retroactively-satisfiable criterion": "a vague trade-off condition that can always be declared met after the fact.",
    "a reviewer who is also the author": "independent review turns out to be the same person checking their own work under a different hat.",
    "a label unrevised by the reality it names": "a status label keeps claiming something already visibly false.",
}

# Per-emotion device menu (Correction.tsx's canonical copy). apathetic/neutral carry no entry -
# absence from this dict means "never inject", checked below rather than listed as "none".
PER_STATE_DEVICES: dict[str, list[str]] = {
    "overwhelmed": ["recursive bureaucracy"],
    "skeptical": ["personification"],
    "frustrated": ["a gap left idling with a pet's patience"],
    "anxious": ["a health check that asks the wrong question"],
    "angry": ["silence mistaken for testimony"],
    "enthusiastic": ["retroactively-satisfiable criterion"],
    "relieved": ["a reviewer who is also the author", "a label unrevised by the reality it names"],
}

REGISTER_BY_STATE: dict[str, str] = {
    "angry": "blunt, short, one sharp idiom at most.",
    "anxious": "escalate via one concrete catastrophic-but-plausible image, never via history/precedent.",
    "skeptical": "dry, deflating.",
    "relieved": "light, satisfied, doesn't gloat over whoever lost the point.",
    "enthusiastic": "light, satisfied, doesn't gloat over whoever lost the point.",
    "overwhelmed": "pile-up, not sharpness.",
    "frustrated": "pile-up, not sharpness.",
}

# Mean absolute distance from the 0.5 neutral baseline, across every configured dimension, scaled
# to [0, 1]. Below this, a turn gets no humor instruction at all regardless of emotion state - most
# turns should be flat, per the memo's own "a few gems, not everywhere" design goal.
INTENSITY_THRESHOLD = 0.3


def intensity(emotion_values) -> float:
    dims = EmotionFactory.get_available_dimensions()
    if not dims:
        return 0.0
    total = sum(abs(getattr(emotion_values, dim, 0.5) - 0.5) for dim in dims)
    return min(1.0, (total / len(dims)) * 2)


def humor_directive(emotion_state: str, emotion_values) -> Optional[str]:
    """The HUMOR block to append to emotion_instruction, or None if this turn should stay flat
    (apathetic/neutral, or intensity below threshold - most turns)."""
    devices = PER_STATE_DEVICES.get(emotion_state)
    if not devices or intensity(emotion_values) < INTENSITY_THRESHOLD:
        return None

    menu = "; ".join(f"{d} ({DEVICE_DESCRIPTIONS[d]})" for d in devices)
    register = REGISTER_BY_STATE.get(emotion_state, "dry, understated.")
    return (
        "\n\nHUMOR (this turn's emotional intensity earned it - most turns should NOT include "
        "this): add ONE short clause (roughly 8-20 words) inside the point you're already making. "
        "Do not add a separate sentence, do not soften or replace the substantive negotiating "
        "content - the clause rides inside the existing point.\n"
        "The joke is about the actual MLOps mechanism you're discussing this turn (validation, "
        "registry, monitoring, whatever it is) - NEVER about the negotiation itself, prior rounds, "
        "or repetition (\"this happened before,\" \"here we go again\"). Ground it the way a real "
        "technical complaint would: one concrete, specific, absurd-but-plausible detail - not a "
        "vague escalation.\n"
        "Never target the other stakeholder in the room. The target is always the system, "
        "process, or specific technical gap you're already reacting to.\n"
        f"Device(s) available for {emotion_state}: {menu}\n"
        f"Register: {register}\n"
        "If nothing lands in one clause without forcing it, skip the joke and make the point "
        "straight - a flat turn beats a forced one."
    )
