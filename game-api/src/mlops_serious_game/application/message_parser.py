import re
from typing import Any
from langchain_core.messages import HumanMessage

from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


def sanitize_dashes(text: str) -> str:
    """Removes EM-dashes (—), EN-dashes (–), and horizontal bars (―),
    converting numeric ranges to hyphens and dialogue interruptions/clauses
    to natural commas or clean spacing."""
    if not text:
        return text
    # Preserve numeric ranges with a standard hyphen: e.g. 10–20 -> 10-20
    text = re.sub(r"(\d+)\s*[—–―]\s*(\d+)", r"\1-\2", text)
    # If preceded by sentence-ending or clause punctuation (e.g. "Sure! — we"), drop the dash
    text = re.sub(r"([,.?!:;])\s*[—–―]\s*", r"\1 ", text)
    # If followed by punctuation, drop the dash
    text = re.sub(r"\s*[—–―]\s*([,.?!:;])", r"\1", text)
    # In conversational text, replace em-dashes / en-dashes with a natural comma and space
    text = re.sub(r"\s*[—–―]\s*", ", ", text)
    # Clean up any potential double commas or extra whitespace
    text = re.sub(r",\s*,+", ", ", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def sanitize_message_content(content: str) -> str:
    """Sanitizes a single message content string, replacing any [stakeholder_id]
    prefix with the real stakeholder's name and replacing any EM/EN dashes."""
    content = sanitize_dashes(content)
    match = re.match(r"^\s*\[(.*?)\]\s*(.*)$", content, re.DOTALL)
    if match:
        st_id, text = match.groups()
        st_id = st_id.strip()
        text = text.strip()
        try:
            st = StakeholderFactory.get_stakeholder(st_id)
            st_name = st.name
        except Exception:
            st_name = st_id

        if text.startswith(f"{st_name}:"):
            return text
        return f"{st_name}: {text}" if text else st_name

    return content


def sanitize_messages(messages: list[Any]) -> list[HumanMessage]:
    """Takes an array of messages (LangChain message objects, dictionaries, or strings),
    sanitizes any '[stakeholder_id]' prefixes by replacing them with 'Stakeholder Name: ',
    removes any EM/EN dashes, and returns a new list of HumanMessage objects
    representing the conversation history.
    """
    sanitized: list[HumanMessage] = []
    for m in messages:
        if isinstance(m, str):
            content = m
        elif isinstance(m, dict):
            content = m.get("content", m.get("message", ""))
        else:
            content = getattr(m, "content", str(m))

        sanitized_content = sanitize_message_content(content)
        sanitized.append(HumanMessage(content=sanitized_content))

    return sanitized


# Aliases for backward compatibility
parse_messages = sanitize_messages
parse_single_message_content = sanitize_message_content
