"""The fictional world every piece of content is set in, loaded from gameConfig/Setting.json.

Both halves of the game read it: the content generation harness writes its snippets, challenges and
objections in this world, and the live stakeholder agents speak inside it. Keeping it in one config
file is what stops the two halves drifting into different stories.

The setting is optional. Without it the blocks render empty and everything behaves as before.
"""

import hashlib
import json
from pathlib import Path
from typing import Any


def _bullets(items: Any) -> str:
    return "\n".join(f"  {line}" for line in (items or []))


class SettingFactory:
    setting: dict = {}

    @classmethod
    def load(cls, setting_config: Path) -> None:
        with setting_config.open("r", encoding="utf-8") as f:
            data = json.load(f)
        cls.setting = data.get("setting") or {}

    @classmethod
    def clear(cls) -> None:
        cls.setting = {}

    @classmethod
    def as_dict(cls) -> dict:
        return dict(cls.setting)

    @classmethod
    def digest(cls) -> str:
        """Short fingerprint of the setting. Part of the content harness' input hashes, so editing
        the setting marks generated content stale instead of silently leaving it in the old world."""
        if not cls.setting:
            return "none"
        raw = json.dumps(cls.setting, sort_keys=True, ensure_ascii=False)
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]

    @classmethod
    def company(cls) -> str:
        return cls.setting.get("company", "")

    @classmethod
    def system(cls) -> str:
        return cls.setting.get("system", "")

    @classmethod
    def short_block(cls) -> str:
        """Two or three sentences for prompts that pay for every token, such as the live agents."""
        s = cls.setting
        if not s:
            return ""
        parts = [
            f"The setting: {s.get('company_description', '')}",
            s.get("system_description", ""),
            s.get("cadence", ""),
            f"Never name a real retailer, brand or product, and never use an example from another "
            f"machine learning domain such as fraud, churn or credit scoring. Everything is about "
            f"{s.get('company', 'this company')} and {s.get('system', 'this system')}.",
        ]
        return "\n".join(p for p in parts if p)

    @classmethod
    def full_block(cls) -> str:
        """Everything a writer needs, for the content generation harness."""
        s = cls.setting
        if not s:
            return ""
        vocab = s.get("vocabulary") or {}
        examples = s.get("examples") or {}
        sections = [
            f"THE SETTING. Every line you write is set here, with no exceptions.",
            f"Company: {s.get('company', '')}. {s.get('company_description', '')}",
            f"The ML system: {s.get('system', '')}. {s.get('system_description', '')}",
            f"The player: {s.get('player_role', '')}",
            f"How it runs: {s.get('cadence', '')}",
            f"What hurts today: {s.get('current_pain', '')}",
        ]
        if s.get("product_users"):
            sections.append("People who use its output:\n" + _bullets(s["product_users"]))
        if s.get("data_sources"):
            sections.append("Data it runs on:\n" + _bullets(s["data_sources"]))
        if s.get("business_metrics"):
            sections.append("What the business measures:\n" + _bullets(s["business_metrics"]))
        if s.get("governance_hooks"):
            sections.append("Why governance matters here:\n" + _bullets(s["governance_hooks"]))
        if examples:
            sections.append("How the recurring ideas look here:\n" + _bullets(
                f"{k}: {v}" for k, v in examples.items()))
        if vocab.get("use"):
            sections.append("Words of this world, use them:\n" + _bullets(vocab["use"]))
        if vocab.get("avoid"):
            sections.append("Never write:\n" + _bullets(vocab["avoid"]))
        return "\n\n".join(sections)
