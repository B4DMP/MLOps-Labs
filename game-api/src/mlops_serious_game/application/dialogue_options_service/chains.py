from langchain_core.prompts import ChatPromptTemplate
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI

from mlops_serious_game.application.dialogue_options_service.state import GeneratedDialogueOptions
from mlops_serious_game.config import settings

def get_dialogue_option_model(
    temperature: float = 0.7,
    model_name: str | None = None,
) -> ChatOpenAI | ChatGroq:
    """Returns the chat model configured for generating dialogue options."""
    if settings.MISTRAL_API_KEY:
        return ChatOpenAI(
            api_key=settings.MISTRAL_API_KEY,
            base_url=settings.MISTRAL_API_BASE,
            model_name=model_name or settings.MISTRAL_LLM_MODEL_DIALOGUE_OPTIONS,
            temperature=temperature,
        )
    elif settings.WESTAI_API_KEY:
        return ChatOpenAI(
            api_key=settings.WESTAI_API_KEY,
            base_url=settings.WESTAI_API_BASE,
            model_name=model_name or settings.WESTAI_LLM_MODEL_DIALOGUE_OPTIONS,
            temperature=temperature,
        )
    else:
        return ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model_name=model_name or settings.GROQ_LLM_MODEL_DIALOGUE_OPTIONS,
            temperature=temperature,
        )


def get_dialogue_option_generator_chain():
    """Builds and returns the LCEL chain with structured output for generating dialogue options."""
    model = get_dialogue_option_model()
    structured_model = model.with_structured_output(GeneratedDialogueOptions)

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are an expert dialogue designer for an MLOps serious game.\n"
                "Your task is to generate 4 natural, immersive dialogue options for the player (MLOps Project Manager) in an ongoing meeting.\n\n"
                "Challenge Context: {{challenge}}\n"
                "Active Speaker: {{active_speaker_name}}\n"
                "LATEST STAKEHOLDER STATEMENT (Primary context to respond to):\n{{latest_statement}}\n\n"
                "Target Stakeholder Intel Context:\n{{intel_description}}\n\n"
                "Corporate Noise Archetype Instructions:\n{{archetype_instructions}}\n\n"
                "CRITICAL INSTRUCTIONS FOR 'intel_option_specs':\n"
                "1. Generate 1 IntelOptionSpec for EACH assigned intel item listed in 'Target Stakeholder Intel Context', maintaining the exact same order.\n"
                "2. The dialogue option MUST explicitly address the target stakeholder BY FIRST NAME (e.g. 'Willis, ...' or 'Mathis, ...') and state, voice, or act upon the specific claim/belief described in that intel item.\n"
                "3. The option MUST fit naturally into the conversation as a realistic, professional response to the LATEST STAKEHOLDER STATEMENT.\n"
                "4. Keep the sentence clean, natural, and direct. DO NOT construct convoluted, accusatory, or run-on sentences. Express the claim or belief simply and naturally in 1st person ('I', 'We').\n\n"
                "CRITICAL INSTRUCTIONS FOR 'corporate_noise_specs':\n"
                "1. Generate 1 corporate noise spec for EACH assigned archetype listed in 'Corporate Noise Archetype Instructions'.\n"
                "2. Each noise option MUST directly engage with the specific concern/topic raised in the LATEST STAKEHOLDER STATEMENT using the assigned archetype's communication strategy.\n"
                "3. STRICT BAN ON PROPOSING NEW CONCRETE ACTIONS OR PILOTS: Corporate noise options MUST NOT propose new pilots, implementations, technical safeguards, tools, or new process steps. They MUST remain vague, high-level, descriptive of current alignment/status, or offer corporate reassurance without committing to new concrete actions.\n"
                "4. STRICT BAN ON UNRELATED TOPICS: Do NOT introduce unreferenced past topics (e.g. no model drift, KL-divergence, CABs, or shadow deployments unless explicitly mentioned in the latest statement).\n"
                "5. Set 'archetype_name' to the exact name of the assigned archetype.",
            ),
            (
                "human",
                "Recent Discussion History:\n{{history}}\n\n"
                "LATEST STAKEHOLDER STATEMENT TO RESPOND TO:\n{{latest_statement}}\n\n"
                "Generate the dialogue options now.",
            ),
        ],
        template_format="jinja2",
    )
    return prompt | structured_model
