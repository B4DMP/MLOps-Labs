import pytest
from langchain_core.messages import AIMessage, HumanMessage

from mlops_serious_game.application.message_parser import (
    sanitize_dashes,
    sanitize_messages,
    sanitize_message_content,
)
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


@pytest.fixture(autouse=True)
def setup_mock_stakeholder():
    test_st = Stakeholder(
        id="test_willis",
        name="Willis Slif",
        responsibilities="Business management",
        priorities="Cost efficiency",
        requirements="Ensure budget compliance",
        role_description="Business Manager",
        metric_id="business",
    )
    StakeholderFactory.register_stakeholder(test_st)


def test_sanitize_message_content_stakeholder():
    content = "[test_willis] We need to make sure this meets budget."
    sanitized = sanitize_message_content(content)
    assert sanitized == "Willis Slif: We need to make sure this meets budget."


def test_sanitize_message_content_no_double_prefix():
    content = "[test_willis] Willis Slif: We need to make sure this meets budget."
    sanitized = sanitize_message_content(content)
    assert sanitized == "Willis Slif: We need to make sure this meets budget."


def test_sanitize_message_content_unknown_stakeholder():
    content = "[unknown_st_id] Some message"
    sanitized = sanitize_message_content(content)
    assert sanitized == "unknown_st_id: Some message"


def test_sanitize_message_content_player_untouched():
    content = "Welcome to the meeting everybody"
    sanitized = sanitize_message_content(content)
    assert sanitized == "Welcome to the meeting everybody"


def test_sanitize_dashes_user_example():
    text = (
        "Great question—we absolutely need access controls for raw and snapshotted data "
        "to ensure security and integrity. Let’s discuss how to balance freshness with stability "
        "while maintaining those protections."
    )
    sanitized = sanitize_dashes(text)
    assert "—" not in sanitized
    assert "–" not in sanitized
    assert "Great question, we absolutely need access controls" in sanitized


def test_sanitize_dashes_punctuation_and_numeric_ranges():
    assert sanitize_dashes("Latency is 10–20ms.") == "Latency is 10-20ms."
    assert sanitize_dashes("Good point! — Let's look into it.") == "Good point! Let's look into it."
    assert sanitize_dashes("Wait — what about governance?") == "Wait, what about governance?"


def test_sanitize_messages_functional_immutability():
    original = [
        HumanMessage(content="Welcome to the meeting everybody"),
        AIMessage(content="[test_willis] We should review the pipeline costs—especially compute."),
    ]
    copy_original = list(original)

    sanitized = sanitize_messages(original)

    # Output should be new list with HumanMessage objects and no dashes
    assert len(sanitized) == 2
    assert sanitized[0].content == "Welcome to the meeting everybody"
    assert sanitized[1].content == "Willis Slif: We should review the pipeline costs, especially compute."

    # Input list and messages should remain unmodified
    assert original == copy_original
    assert original[0].content == "Welcome to the meeting everybody"
    assert original[1].content == "[test_willis] We should review the pipeline costs—especially compute."


def test_sanitize_messages_with_dicts_and_strings():
    messages = [
        {"type": "human", "content": "Let's review options."},
        {"type": "ai", "content": "[test_willis] Understood—proceed."},
        "[test_willis] Plain string statement—confirmed.",
    ]
    sanitized = sanitize_messages(messages)
    assert len(sanitized) == 3
    assert sanitized[0].content == "Let's review options."
    assert sanitized[1].content == "Willis Slif: Understood, proceed."
    assert sanitized[2].content == "Willis Slif: Plain string statement, confirmed."
