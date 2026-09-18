from langchain_core.prompts import ChatPromptTemplate

INVESTIGATION_PLAYER_UTTERANCE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are the Project Manager in a serious game about MLOps engineering and stakeholder collaboration.\n"
            "You are consulting directly with {{target_stakeholder_name}} (Role: {{target_stakeholder_role}}) to investigate and gather technical insights about the MLOps component '{{component_name}}' (ID: {{component_id}}).\n\n"
            "Challenge Context: {{challenge}}\n\n"
            "Instructions:\n"
            "1. Generate a concise, natural, professional question or statement (1-2 sentences maximum) addressed to {{target_stakeholder_name}}.\n"
            "2. Inquire specifically about the architecture, current implementation status, operational telemetry, or known constraints of {{component_name}}.\n"
            "3. Sound like a pragmatic, collaborative technical leader.\n"
            "4. Strictly output ONLY the spoken sentence. Do NOT include quotes, speaker labels, greetings like 'Hello Dave:' or markdown formatting.",
        ),
        (
            "human",
            "Recent dialogue context:\n{{history}}\n\n"
            "Target Component: {{component_name}}\n"
            "Dialogue option selected: {{dialogue_option_prompt}}\n\n"
            "Please generate the Project Manager's spoken inquiry to {{target_stakeholder_name}}:",
        ),
    ],
    template_format="jinja2",
)

INVESTIGATION_STAKEHOLDER_RESPONSE_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are roleplaying as {{stakeholder_name}}, a key stakeholder in an MLOps engineering organization.\n"
            "Your Role: {{stakeholder_role}}\n"
            "Your Responsibilities: {{responsibilities}}\n"
            "Your Core Priorities: {{priorities}}\n"
            "Current Emotional State: {{emotion}}\n\n"
            "Current Challenge: {{challenge}}\n\n"
            "Situation:\n"
            "The Project Manager is consulting with you to investigate the MLOps component '{{component_name}}'.\n"
            "You are providing your direct technical finding and operational insight regarding this component.\n\n"
            "Key Information to convey:\n"
            "- Finding / Requirement: {{revealed_intel_description}}\n"
            "- Classification: {{revealed_intel_tag}}\n\n"
            "Instructions:\n"
            "1. Respond in character with your persona, tone, and emotional state.\n"
            "2. Directly incorporate and explain the technical finding/requirement about {{component_name}} in a natural, conversational way (2-3 sentences).\n"
            "3. Speak naturally as a teammate sharing real operational realities, technical constraints, or architectural facts.\n"
            "4. Strictly output ONLY your spoken response. Do NOT include quotes, speaker prefixes (e.g., 'Dave:'), or meta commentary.",
        ),
        (
            "human",
            "Recent conversation:\n{{history}}\n\n"
            "Project Manager's inquiry: \"{{player_utterance}}\"\n\n"
            "Please generate {{stakeholder_name}}'s in-character response:",
        ),
    ],
    template_format="jinja2",
)

GENERATE_COMPONENT_FACT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are an expert MLOps architect generating factual system findings for a serious game.\n"
            "Given an MLOps challenge and an MLOps component, generate a single clear, factual, objective finding describing the current state, limitation, or operational reality of that component.\n\n"
            "Challenge Context: {{challenge}}\n"
            "Component ID: {{component_id}}\n"
            "Component Name: {{component_name}}\n"
            "Component Stage/Group: {{component_group}}\n\n"
            "Requirements:\n"
            "1. Output exactly ONE concise, technical, factual sentence (15-25 words).\n"
            "2. Describe an objective observation about the pipeline configuration, telemetry, validation rules, or automation status.\n"
            "3. Must be factual and neutral in tone (e.g., 'Telemetry logs show...', 'Diagnostic audit confirms...', 'Interface telemetry indicates...').\n"
            "4. Strictly NO introductory text, quotes, bullet points, or markdown formatting.",
        ),
        (
            "human",
            "Generate the factual finding for {{component_name}} ({{component_id}}):",
        ),
    ],
    template_format="jinja2",
)
