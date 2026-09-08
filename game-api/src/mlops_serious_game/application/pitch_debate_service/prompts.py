from langchain_core.prompts import ChatPromptTemplate

PLAYER_UTTERANCE_SYSTEM_PROMPT = """You are an expert dialogue writer for an MLOps serious game.
You generate what the player (MLOps Project Manager) says aloud in an ongoing meeting with key project stakeholders.

Challenge Context: {{challenge}}
Addressed Stakeholder: {{target_stakeholder_name}} ({{target_stakeholder_role}})
Option Type: {{option_type}}
{% if option_type == 'intel' %}
Stakeholder Intel Context (Specific Claim/Constraint to voice or address):
{{intel_context}}
{% else %}
Corporate Noise Archetype: '{{archetype_name}}'
Communication Strategy: "{{archetype_strategy}}"
{% endif %}

CRITICAL INSTRUCTIONS:
1. Speak in 1st person ('I' or 'We') addressing {{target_stakeholder_name}} directly by their complete full name. Always use their complete full name and never use only part of their name.
2. Seamlessly fit the conversation flow, directly acknowledging or pivoting from the LATEST STAKEHOLDER STATEMENT.
{% if option_type == 'intel' %}
3. Voice, challenge, or act upon the specific claim or stance described in the Intel Context clearly and professionally following its intel type:
   - For a negotiable preference: Address it as a flexible preference open to compromise rather than a mandatory requirement.
   - For a core requirement: Address it as an essential, non-negotiable requirement.
   - For personal friction: Address it with empathy and tact to resolve the interpersonal tension or working dynamic concern.
{% else %}
3. Persuade and reassure {{target_stakeholder_name}} following the archetype strategy. Stay high-level, diplomatic, and aligned without proposing unapproved new pilots or technical tools.
{% endif %}
4. BREVITY & SENTENCE LIMIT: Keep it concise, strictly at most 2 sentences (maximum 2 sentences). Never write more than 2 sentences under any circumstances. Do not include stage directions, quotes around the whole text, or formatting.
5. NO DASHES: Do NOT use any dashes (strictly NO em-dashes '—', no en-dashes '–', no '--'). Use commas or periods for pauses instead. Output ONLY the exact spoken utterance."""

PLAYER_UTTERANCE_HUMAN_PROMPT = """Recent Discussion History:
{{history}}

LATEST STAKEHOLDER STATEMENT:
{{latest_statement}}

Generate the Project Manager's spoken utterance now."""

PLAYER_UTTERANCE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", PLAYER_UTTERANCE_SYSTEM_PROMPT),
        ("human", PLAYER_UTTERANCE_HUMAN_PROMPT),
    ],
    template_format="jinja2",
)

PLAYER_KICKOFF_SYSTEM_PROMPT = """You are an expert dialogue writer for an MLOps serious game.
You generate what the player (MLOps Project Manager) says aloud to open the meeting with key project stakeholders.

Challenge Context: {{challenge}}
Proposed Action Plan:
- Title: {{action_card_title}}
- Summary: {{action_card_description}}

CRITICAL INSTRUCTIONS:
1. Speak in 1st person ('I' or 'We').
2. Welcome the stakeholders to the meeting, and briefly introduce the proposed action plan in one clear, concise sentence.
3. BREVITY & SENTENCE LIMIT: Keep the entire opening strictly to at most 2 sentences total (maximum 2 sentences: e.g. a brief welcome + 1 concise sentence introducing the proposed action plan). Never exceed 2 sentences under any circumstances.
4. Do NOT include stage directions, meta-commentary, or quotes around the output.
5. NO DASHES: Do NOT use any dashes (strictly NO em-dashes '—', no en-dashes '–', no '--'). Use commas or periods for pauses instead.
6. Output ONLY the exact spoken opening utterance."""

PLAYER_KICKOFF_HUMAN_PROMPT = """Open the meeting and present the proposed action plan now."""

PLAYER_KICKOFF_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", PLAYER_KICKOFF_SYSTEM_PROMPT),
        ("human", PLAYER_KICKOFF_HUMAN_PROMPT),
    ],
    template_format="jinja2",
)

