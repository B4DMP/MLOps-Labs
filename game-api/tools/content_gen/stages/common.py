"""Checks and conversions shared by the stages."""

import json
import re
from typing import Any, Optional

from pydantic import BaseModel

DASHES = re.compile(r"—|–|--")
MARKDOWN = re.compile(r"(\*\*|__|^#+\s|^\s*[-*]\s)", re.M)
WISH_WORDS = re.compile(r"\b(want|wants|wish|prefer|prefers|insist|insists|refuse|refuses|demand|demands|hope|hopes)\b", re.I)
LEVEL_NAMES = ["broken", "absent", "manual", "automated", "governed"]

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


def tokenize_names(text: str, stakeholders: dict, style: str = "brace") -> str:
    """Rewrites plain stakeholder names into the tokens the game renders per player, so persona
    names stay consistent: {data_dave} in intel text, #data_dave# in challenge descriptions.
    Deterministic, so the model does not spend attempts on it."""
    if not text:
        return text
    for sid, st in sorted(stakeholders.items(), key=lambda kv: -len(kv[1].name or "")):
        if not st.name:
            continue
        token = f"{{{sid}}}" if style == "brace" else f"#{sid}#"
        text = re.sub(re.escape(st.name), token, text, flags=re.I)
    return text
