"""Checks and conversions shared by the stages."""

import json
import re
from typing import Any, Optional

from pydantic import BaseModel

DASHES = re.compile(r"—|–|--")
MARKDOWN = re.compile(r"(\*\*|__|^#+\s|^\s*[-*]\s)", re.M)
WISH_WORDS = re.compile(r"\b(want|wants|wish|prefer|prefers|insist|insists|refuse|refuses|demand|demands|hope|hopes)\b", re.I)
LEVEL_NAMES = ["broken", "absent", "manual", "automated", "governed"]
# Shared across templates.py and items.py gates (code-review finding: they each had their own,
# identically-named but subtly different, copy of this - templates.py's also matched decimals
# like "2.5", items.py's didn't). One shared, more inclusive pattern for both.
LEVEL_TALK = re.compile(r"\blevels?\b|\b[0-4](\.\d)?\b")
# Players never see the graph, so no text they read may talk about its parts.
GAME_WORDS = re.compile(r"\b(components?|stages?)\b", re.I)

GAME_RULES = """You write content for a serious game about stakeholder management in MLOps projects.
The player is the project manager. The game state is a technical graph of MLOps components and the
workflows (edges) between them. Levels: 0 broken, 1 absent, 2 manual, 3 automated, 4 governed.
Use only ids that appear in the lists you are given. Never invent ids.
Never use dashes of any kind (no em dash, no en dash, no double hyphen). Use commas or periods.
No markdown, no headings, no bullet lists inside text fields."""


def text_errors(label: str, text: Optional[str], min_words: int = 0, max_words: int = 10_000) -> list[str]:
    if not text:
        return [f"{label} is empty"]
    errors = []
    if DASHES.search(text):
        errors.append(f"{label} contains a dash, use commas or periods instead")
    if MARKDOWN.search(text):
        errors.append(f"{label} contains markdown formatting")
    words = len(text.split())
    if words < min_words:
        errors.append(f"{label} is too short ({words} words, at least {min_words})")
    if words > max_words:
        errors.append(f"{label} is too long ({words} words, at most {max_words})")
    return errors


def player_text_errors(label: str, text: Optional[str]) -> list[str]:
    """A line the player reads never talks about the game model: no levels, no components or stages."""
    if not text:
        return []
    errors = []
    if LEVEL_TALK.search(text):
        errors.append(f"{label} mentions levels or numbers; say broken, missing, manual, automated or governed")
    if GAME_WORDS.search(text):
        errors.append(f"{label} says '{GAME_WORDS.search(text).group(0)}'; name the thing itself, "
                      "never a component or stage")
    return errors


def parse_json_field(label: str, raw: Any) -> tuple[Any, list[str]]:
    """Predicates come back as JSON strings, which structured output handles more reliably."""
    if raw is None or raw == "":
        return None, []
    if isinstance(raw, (dict, list, bool)):
        return raw, []
    try:
        return json.loads(raw), []
    except json.JSONDecodeError as e:
        return None, [f"{label} is not valid JSON: {e}"]


def op_dict(op: BaseModel | dict) -> dict:
    d = op.model_dump(exclude_none=True) if isinstance(op, BaseModel) else {k: v for k, v in op.items() if v is not None}
    value = d.get("value")
    if isinstance(value, str) and value.isdigit():
        d["value"] = int(value)
    return d


def ops_errors(label: str, ops: list[dict], graph, allowed_kinds: set[str], allowed_targets: Optional[set[str]] = None) -> list[str]:
    from mlops_serious_game.domain.graph import GraphOp

    errors = []
    for i, raw in enumerate(ops):
        try:
            op = GraphOp.model_validate(raw)
        except Exception as e:
            errors.append(f"{label}[{i}] is invalid: {e}")
            continue
        if op.kind not in allowed_kinds:
            errors.append(f"{label}[{i}] kind '{op.kind}' not allowed here, use one of {sorted(allowed_kinds)}")
            continue
        if op.kind == "set_instance_prop":
            if not any(i.id == op.target for i in graph.initial_instances):
                errors.append(f"{label}[{i}] targets unknown instance '{op.target}'")
            continue
        if not graph.is_target(op.target):
            errors.append(f"{label}[{i}] targets unknown id '{op.target}'")
        elif allowed_targets is not None and op.target not in allowed_targets:
            errors.append(f"{label}[{i}] targets '{op.target}', which is outside the focus stage")
    return errors


def render(obj: Any) -> str:
    return json.dumps(obj, indent=1, ensure_ascii=False)


# The model sometimes drops apostrophes. Only words that are never correct without one.
_CONTRACTIONS = {w.replace("'", ""): w for w in (
    "I've I'm I'd I'll don't doesn't didn't isn't aren't wasn't weren't can't won't shouldn't couldn't "
    "wouldn't haven't hasn't hadn't that's it's they're you're we've they've we're there's what's"
).split() if w.replace("'", "").lower() not in {"its", "were", "well", "id", "ill", "wed", "shed", "hell"}}


def fix_contractions(text: str) -> str:
    if not text:
        return text
    def repl(m: re.Match) -> str:
        word = m.group(0)
        fixed = _CONTRACTIONS.get(word) or _CONTRACTIONS.get(word.lower())
        if fixed is None:
            return word
        return fixed[0].upper() + fixed[1:] if word[0].isupper() else fixed
    return re.sub(r"\b(" + "|".join(map(re.escape, _CONTRACTIONS)) + r")\b", repl, text, flags=re.I)


def tokenize_names(text: str, stakeholders: dict, style: str = "brace") -> str:
    """Rewrites plain stakeholder names into the tokens the game renders per player, so persona
    names stay consistent: {data_dave} in intel text, #data_dave# in challenge descriptions.

    Full names first, then the bare given name (the last word, which is what {id.first} renders).
    Never the first word: "Data", "Model", "Requirements" are role words that also appear as plain
    nouns ("the data labeling process"). Given names match case-sensitively, and never inside an
    existing token. Deterministic, so the model does not spend attempts on it.

    Every generated sentence passes through here, so dropped apostrophes are repaired here too."""
    if not text:
        return text
    text = fix_contractions(text)
    for sid, st in sorted(stakeholders.items(), key=lambda kv: -len(kv[1].name or "")):
        if not st.name:
            continue
        token = f"{{{sid}}}" if style == "brace" else f"#{sid}#"
        first_token = f"{{{sid}.first}}" if style == "brace" else token
        # Any whitespace between the words: models emit non-breaking spaces and line breaks too.
        full = r"\s+".join(re.escape(w) for w in st.name.split())
        text = re.sub(rf"\b{full}\b", token, text)  # case-sensitive: "the model Monica built" is no name
        # Assumes a two-word "Role Given" name (true of every stakeholder today, verified against
        # gameConfig/GameStakeholders.json). A one-word name would make `given` equal the whole
        # name and double-replace it; if that ever happens, branch on len(st.name.split()) here.
        given = st.name.split()[-1]
        if len(given) > 2 and given[0].isupper():
            text = re.sub(rf"(?<![{{#\w.]){re.escape(given)}\b(?![}}#\w.])", first_token, text)
        # A role word left in front of the given-name token is the full name after all.
        if first_token != token and len(st.name.split()) > 1:
            text = re.sub(rf"\b{re.escape(st.name.split()[0])}\s+{re.escape(first_token)}", token, text)
        # Defense in depth (code-review finding): a model sometimes writes the raw internal id
        # itself ("requirements_reuben") as plain prose instead of the name or the brace token.
        # Nothing above catches that - it isn't the stakeholder's rendered name - so re-brace a
        # bare id directly, the same way a bare given name gets re-braced above.
        text = re.sub(rf"(?<![{{#\w.]){re.escape(sid)}\b(?![}}#\w.])", token, text)
    return text


def bare_stakeholder_id_errors(field_label: str, text: str, stakeholders: dict) -> list[str]:
    """Rejects a field that still contains a bare stakeholder id ("requirements_reuben" as plain
    prose) after tokenize_names has run - the id-form gate `ObjectionsStage.check()` and
    `ArtifactsStage.check()` use, alongside tokenize_names' own re-bracing above, so a leak is
    caught even if some future field bypasses tokenize_names (code-review finding: this exact
    leak reached 6 assembled objection records and would have shown up verbatim in the pitch
    room, e.g. "requirements_reuben mentioned governed data quality checks.")."""
    if not text:
        return []
    for sid in stakeholders:
        if re.search(rf"(?<![{{#\w.]){re.escape(sid)}\b(?![}}#\w.])", text):
            return [f"{field_label} contains the raw id {sid!r} as plain text; use the stakeholder's name or the {{{sid}}} token"]
    return []
