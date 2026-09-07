from langchain_core.prompts import ChatPromptTemplate


ACTION_CARD_SYSTEM_PROMPT = """You are an expert MLOps Solution Architect and Game Designer in a serious game for stakeholder engagement in MLOps.
The player (MLOps Project Manager) has gathered intelligence items (technical requirements, operational constraints, and architectural preferences) and is merging them into a concrete Action Card proposal.

Challenge Context:
{{challenge_context}}

Merged Intel Items:
{{intel_items_text}}

CRITICAL INSTRUCTIONS:
1. Title: Create a concise, punchy, professional MLOps action proposal title (3 to 7 words). Do NOT prefix with 'Action Proposal:' or 'Card:'. Focus directly on the strategic action (e.g., 'Automated Drift Detection with Rollback Safeguards').
2. Description: Detail ONLY technical and operational information explaining what technical actions are being taken and how they will be implemented (e.g., specific MLOps pipelines, tooling, automated checks, workflows or architectural changes).
3. EXCLUSION RULE: Do NOT include ANY information about which stakeholders were involved, mentioned, or satisfied by this action card. Keep the description strictly focused on the technical/operational/organizational execution.
4. LENGTH: The description MUST be limited to at most two sentences (maximum 2 sentences).
5. Tone: Realistic, authoritative, and aligned with enterprise MLOps engineering best practices.
6. Formatting: Do NOT use markdown asterisks or quotes inside the title or description text. Strictly do not use any dashes (strictly NO em-dashes '—', no en-dashes '–', no '--'). Use standard commas or periods instead."""


ACTION_CARD_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", ACTION_CARD_SYSTEM_PROMPT),
        ("human", "Synthesize these merged intel items into an Action Card proposal now."),
    ],
    template_format="jinja2",
)
