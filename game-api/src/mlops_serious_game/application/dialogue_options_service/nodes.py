import random
import re
from typing import Any
from langchain_core.runnables import RunnableConfig

from mlops_serious_game.application.dialogue_options_service.chains import (
    get_dialogue_option_generator_chain,
)
from mlops_serious_game.application.dialogue_options_service.state import (
    DialogueOption,
    DialogueOptionsState,
    GeneratedDialogueOptions,
)
from mlops_serious_game.domain.emotion_factory import EmotionFactory
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory


async def dialogue_option_node(
    state: DialogueOptionsState,
    config: RunnableConfig = None,
) -> dict[str, Any]:
    """Generates 4 distinct dialogue options (intel-based and corporate noise) for the player."""
    messages = state.get("messages", [])
    discovered_intel_items = list(state.get("discovered_intel_items", []) or state.get("intel_items", []) or [])

    _split = state.get("challenge", "").split("#")
    challenge_text = "".join(_split)

    # Determine latest statement and active speaker
    last_msg = messages[-1] if messages else None
    if last_msg:
        content_str = getattr(last_msg, "content", str(last_msg))
        latest_statement = content_str
        match = re.match(r"^\[(.*?)\]\s*(.*)$", content_str, re.DOTALL)
        if match:
            active_speaker_id = match.group(1).strip()
            st_obj = StakeholderFactory.get_stakeholder(active_speaker_id)
            active_speaker_name = st_obj.name
        else:
            active_speaker_id = None
            active_speaker_name = "the stakeholder"
    else:
        latest_statement = "(Meeting started)"
        active_speaker_id = None
        active_speaker_name = "the stakeholder"

    history_msgs = messages[-6:] if len(messages) >= 6 else messages
    history_str = (
        "\n".join([f"{getattr(m, 'type', 'message')}: {getattr(m, 'content', str(m))}" for m in history_msgs])
        if history_msgs
        else "(Meeting started)"
    )

    # 1. Select intel items to incorporate into dialogue options
    if discovered_intel_items:
        k = min(2, len(discovered_intel_items))
        selected_intels = random.sample(discovered_intel_items, k)
        intel_desc_list = []
        for idx, item in enumerate(selected_intels, 1):
            if isinstance(item, dict):
                req_id = item.get("requirement_id")
                item_desc = item.get("description") or item.get("categorized_description", "")
                st_id = item.get("stakeholder_id")
            else:
                req_id = getattr(item, "requirement_id", None)
                item_desc = getattr(item, "description", None) or getattr(item, "categorized_description", "")
                st_id = getattr(item, "stakeholder_id", None)

            if not st_id and req_id:
                req = RequirementFactory.get_requirement(req_id)
                if req:
                    st_id = req.stakeholder_id
                    if not item_desc:
                        item_desc = req.description

            st_obj = StakeholderFactory.get_stakeholder(st_id) if st_id else None
            st_name = st_obj.name if st_obj else (st_id or "the stakeholder")

            if active_speaker_id and st_id == active_speaker_id:
                target_type = "Direct Target (Active Speaker)"
            else:
                target_type = f"Bridge Target (Pivot from {active_speaker_name})"

            intel_desc_list.append(
                f"Intel Item {idx} [{target_type} - Target: {st_name}]:\n"
                f"  - Specific Claim/Belief to Voice: \"{item_desc}\""
            )
        intel_desc = "\n\n".join(intel_desc_list)
    else:
        selected_intels = []
        intel_desc = "General project status alignment"

    # 2. Select corporate noise convincer archetypes
    all_archetypes = list(EmotionFactory.get_convincer_archetypes().values())
    needed_noise = 4 - len(selected_intels)
    assigned_archetypes = random.sample(
        all_archetypes, min(needed_noise, len(all_archetypes))
    )
    arch_instruct_list = []
    for idx, arch in enumerate(assigned_archetypes, 1):
        arch_instruct_list.append(
            f"Noise Option {idx} Archetype: '{arch.name}'\n"
            f"  - Strategy to follow: \"{arch.strategy}\""
        )
    archetype_instructions = "\n\n".join(arch_instruct_list)

    # 3. Invoke LLM structured generation
    chain = get_dialogue_option_generator_chain()
    gen_result: GeneratedDialogueOptions = await chain.ainvoke(
        {
            "challenge": challenge_text,
            "active_speaker_name": active_speaker_name,
            "latest_statement": latest_statement,
            "intel_description": intel_desc,
            "archetype_instructions": archetype_instructions,
            "history": history_str,
        },
        config,
    )

    options: list[DialogueOption] = []
    intel_specs = gen_result.intel_option_specs or []

    # 4. Build Intel Dialogue Options
    for idx, item in enumerate(selected_intels):
        if isinstance(item, dict):
            req_id = item.get("requirement_id")
            item_desc = item.get("description") or item.get("categorized_description", "")
            st_id = item.get("stakeholder_id")
            item_id = item.get("id") or req_id
            intel_type = item.get("intel_type") or item.get("categorized_type") or item.get("categorized_intent")
        else:
            req_id = getattr(item, "requirement_id", None)
            item_desc = getattr(item, "description", None) or getattr(item, "categorized_description", "")
            st_id = getattr(item, "stakeholder_id", None)
            item_id = getattr(item, "id", None) or req_id
            intel_type = getattr(item, "intel_type", None) or getattr(item, "categorized_type", None) or getattr(item, "categorized_intent", None)

        if hasattr(intel_type, "value"):
            intel_type = intel_type.value

        if not st_id and req_id:
            req = RequirementFactory.get_requirement(req_id)
            if req:
                st_id = req.stakeholder_id
                if not item_desc:
                    item_desc = req.description

        if not item_id:
            item_id = f"intel_{st_id}_{idx+1}" if st_id else f"intel_{idx+1}"

        st_obj = None
        if st_id:
            try:
                st_obj = StakeholderFactory.get_stakeholder(st_id)
            except Exception:
                st_obj = None

        if st_obj:
            st_name = st_obj.name
        elif st_id:
            st_name = " ".join([w.capitalize() for w in st_id.split("_")])
        else:
            st_name = "Stakeholder"

        st_first_name = (st_name.split()[0].replace(",", "")) if st_name else "Team"

        text = intel_specs[idx].text if (idx < len(intel_specs) and intel_specs[idx].text) else f"{st_first_name}, regarding the stance: {item_desc}"

        if st_first_name.lower() not in text.lower():
            text = f"{st_first_name}, {text}"
        options.append(
            DialogueOption(
                text=text,
                intel_item_id=str(item_id) if item_id else None,
                intel_description=str(item_desc) if item_desc else None,
                intel_stakeholder_name=str(st_name) if st_name else None,
                intel_type=str(intel_type) if intel_type else None,
            )
        )

    # 5. Build Corporate Noise Dialogue Options
    noise_specs = gen_result.corporate_noise_specs or []
    for idx, spec in enumerate(noise_specs[:needed_noise]):
        arch = EmotionFactory.get_archetype_by_name(spec.archetype_name) or (
            assigned_archetypes[idx] if idx < len(assigned_archetypes) else None
        )
        if not arch and all_archetypes:
            arch = all_archetypes[idx % len(all_archetypes)]

        if arch and not arch.name:
            if idx < len(assigned_archetypes) and assigned_archetypes[idx].name:
                arch.name = assigned_archetypes[idx].name
            elif spec.archetype_name:
                arch.name = spec.archetype_name
            else:
                arch.name = "General Alignment"

        options.append(
            DialogueOption(text=spec.text, intel_item_id=None, archetype=arch)
        )

    # 6. Shuffle and return
    random.shuffle(options)
    return {
        "dialogue_options": options,
        "discovered_intel_items": discovered_intel_items,
        "intel_items": discovered_intel_items,
        "active_speaker_id": active_speaker_id,
        "active_speaker_name": active_speaker_name,
    }
