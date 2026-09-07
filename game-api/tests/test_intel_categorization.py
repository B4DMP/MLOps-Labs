import pytest
from mlops_serious_game.application.online_intel_service.nodes import _format_revealed_intel_item
from mlops_serious_game.domain.prompts import STAKEHOLDER_CHARACTER_CARD, ONLINE_INTEL_STAKEHOLDER_PROMPT
from mlops_serious_game.domain.requirement import RequirementType


def test_format_revealed_intel_item_negotiable_preference():
    item = {
        "categorized_type": RequirementType.NEGOTIABLE_PREFERENCE,
        "description": "Automation Alex prefers containers and Docker for runtime packaging consistency.",
    }
    formatted = _format_revealed_intel_item(item)
    assert "Negotiable Preference" in formatted
    assert "NOT non-negotiable" in formatted
    assert "Automation Alex prefers containers and Docker for runtime packaging consistency." in formatted


def test_format_revealed_intel_item_core_requirement():
    item = {
        "categorized_type": "requirement",
        "description": "Deployment templates must use standard IaC declarations.",
    }
    formatted = _format_revealed_intel_item(item)
    assert "Core Requirement" in formatted
    assert "mandatory" in formatted


def test_format_revealed_intel_item_personal_friction():
    item = {
        "categorized_type": "personal_friction",
        "description": "Automation Alex is frustrated when custom platform designs ignore operational automation.",
    }
    formatted = _format_revealed_intel_item(item)
    assert "Personal Friction" in formatted
    assert "interpersonal tension" in formatted


def test_prompts_contain_stance_category_consistency():
    card_prompt = STAKEHOLDER_CHARACTER_CARD.prompt
    assert "STANCE CATEGORY CONSISTENCY" in card_prompt
    assert "NEVER claim, imply, or state that a negotiable preference is non-negotiable" in card_prompt

    online_prompt = ONLINE_INTEL_STAKEHOLDER_PROMPT.prompt
    assert "NEVER state or imply that a negotiable preference is non-negotiable" in online_prompt
