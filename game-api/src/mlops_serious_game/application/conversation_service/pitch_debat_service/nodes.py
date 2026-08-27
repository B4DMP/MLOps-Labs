import asyncio
import random

from langchain_core.messages import AIMessage, RemoveMessage
from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import ToolNode

from mlops_serious_game.application.conversation_service.pitch_debat_service.chains import (
    get_anticheat_chain,
    get_card_gen_chain,
    get_card_gen_checker_chain,
    get_context_summary_chain,
    get_conversation_summary_chain,
    get_rogue_stakeholder_response_chain,
    get_router_chain,
    get_stakeholder_response_chain,
)
from mlops_serious_game.application.conversation_service.pitch_debat_service.state import (
    PitchDebateState,
)
from mlops_serious_game.application.conversation_service.pitch_debat_service.tools import tools
from mlops_serious_game.config import settings
from mlops_serious_game.domain.exceptions import (
    NoStakeholderRoute,
    RoutingStakeholderNotFound,
)
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory

retriever_node = ToolNode(tools)


async def conversation_node(state: PitchDebateState, config: RunnableConfig):

    summary = state.get("summary", "")
    #select rogue stakeholder, only if not during evaluation
    rogue_percentage=20
    if random.randint(0,100) <= rogue_percentage and state.get("phase_id") is not None:
        conversation_chain=get_rogue_stakeholder_response_chain()
    else:
        conversation_chain = get_stakeholder_response_chain()
    st=StakeholderFactory.get_stakeholder(state["stakeholder_ids"][-1])
    
    input_messages = state["messages"]
    
    #convert stakeholder ids into stakeholder names
    _split= state["challenge"].split("#")
    challenge_text = ""
    for i in range( len(_split)):
        challenge_text += _split[i]

    # Fetch challenge-specific requirements
    from mlops_serious_game.domain.requirement_factory import RequirementFactory
    challenge_id = state.get("challenge_id", 0)
    reqs = RequirementFactory.get_requirements_for_stakeholder_in_challenge(challenge_id, st.id)
    if reqs:
        reqs_str = "\n".join([f"- [{req.type.value.upper()}] {req.description}" for req in reqs])
    else:
        reqs_str = st.requirements

    response = await conversation_chain.ainvoke(
        {
            "messages": input_messages,
            "summary":summary,
            "challenge": challenge_text,
            "stakeholder_name": st.name,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_requirements": reqs_str,
        },
        config,
    )

    named_response = AIMessage(
        content=f"[{st.id}] {response.content}",
        additional_kwargs=response.additional_kwargs,
        response_metadata=response.response_metadata,
        id=response.id,
        name="Stakeholder",
        tool_calls=response.tool_calls,
    )
    if named_response.tool_calls:
        return {"messages": named_response}
    # Remove the last stakeholder_id after processing
    new_stakeholder_ids = state["stakeholder_ids"][:-1]
    return {"messages": named_response, "stakeholder_ids": new_stakeholder_ids}



async def summarize_conversation_node(state: PitchDebateState):
    summary = state.get("summary", "")
    summary_chain = get_conversation_summary_chain(summary)

    response = await summary_chain.ainvoke(
        {
            "messages": state["messages"],
            "summary": summary,
        }
    )
    delete_messages = [
        RemoveMessage(id=m.id)
        for m in state["messages"][: -settings.TOTAL_MESSAGES_AFTER_SUMMARY]
    ]
    return {"summary": response.content, "messages": delete_messages}


async def summarize_context_node(state: PitchDebateState):
    context_summary_chain = get_context_summary_chain()
    if not state["messages"][-1].content or len(state["messages"][-1].content.strip()) < 10:
        response_content = "No relevant information found in the knowledge base."
    else:
        response = await context_summary_chain.ainvoke(
            {
                "context": state["messages"][-1].content,
            }
        )
        response_content = response.content
    print("RAG retrieval, context summary: " + response_content)
    state["messages"][-1].content = response_content
    return {}


async def connector_node(state: PitchDebateState):
    return {}

async def send_message_connector_node(state: PitchDebateState, config: RunnableConfig):
    if config["configurable"].get("ws")!=None and config["configurable"].get("callback")!=None:
        asyncio.create_task(config["configurable"].get("callback")(websocket=config["configurable"].get("ws"),state=state))

    return {}

def get_stakeholders_text(state: PitchDebateState, config: RunnableConfig):
    stakeholders:str = ""
    phase_id = state.get("phase_id")
    if phase_id is not None:
        for st_id in StakeholderFactory.get_active_stakeholders(phase_id):
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders+=(f"- {st.name}\n")
    else:
        for st_id in StakeholderFactory.get_available_stakeholders():
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders+=(f"- {st.name}\n")
        
    return stakeholders


async def router_node(state: PitchDebateState, config: RunnableConfig):
    
    phase_id = state.get("phase_id")
    router_chain = get_router_chain(phase_id)

    decision = await router_chain.ainvoke(
        {
            "routing_stakeholders": get_stakeholders_text(state, config),
            "last_message": state["messages"][-1].content,
            "messages": state["messages"]
        }
    )

    selected_stakeholder_ids=[]

    if(len(decision.stakeholders)==0):
         raise NoStakeholderRoute

    for selected in decision.stakeholders:
        found = False
        st_ids = StakeholderFactory.get_active_stakeholders(state.get("phase_id")) if state.get("phase_id") is not None else StakeholderFactory.get_available_stakeholders()
        for st_id in st_ids:
            st = StakeholderFactory.get_stakeholder(st_id)
            target = st.name.strip().lower()

            if selected.strip().lower() == target:
                selected_stakeholder_ids.append(st_id)
                found = True
                break
        
        if not found:
            raise RoutingStakeholderNotFound(selected)
    return {"stakeholder_ids": list(set(selected_stakeholder_ids))}

async def card_check_node(state: PitchDebateState):
    #do not generate action cards when the stakeholder are evaluated
    if state.get("phase_id") is None:
        return {"generate_card": False}
        
    card_check_chain = get_card_gen_checker_chain()
    action_cards=""
    if("action_cards" in state):
        for c in state["action_cards"]:
            if c:
                title = c.get("title", "")
                desc = c.get("short_description", "")
                sts = ", ".join(c.get("stakeholder_names", []))
                action_cards += f"-----\nTitle: {title}\nDescription: {desc}\nProposed by: {sts}\n\n"
    
    decision = await card_check_chain.ainvoke({
         "messages": state["messages"],
         "action_cards":action_cards ,
         "challenge":state["challenge"],
         "action_card_images":PhaseFactory.action_card_images
    })
    if(decision.status=="accept"):
        return {"generate_card":True}
    else:
        return {"generate_card":False}



async def anticheat_node(state: PitchDebateState, config: RunnableConfig):
    #do not check if in evaluation
    if state.get("phase_id") is None:
        return {"cheating_detected": False}
    
    #do not check if it is the first message (Dirty fix)
    if len(state["messages"]) ==1:
        return {"cheating_detected": False}

    phase_id = state.get("phase_id")
    anticheat_chain = get_anticheat_chain()
    currencies_explanation=""
    for m_id in MetricFactory.get_available_metrics():
        currencies_explanation+=(f"currency name:{MetricFactory.get_metric(m_id).name}; currency description:{MetricFactory.get_metric(m_id).description}; active: {MetricFactory.get_metric(m_id).phases[phase_id]} \n,")
    
    decision = await anticheat_chain.ainvoke({
         "messages": state["messages"],
         "challenge":state["challenge"],
         "stakeholders":get_stakeholders_text(state, config),
         "metrics":currencies_explanation
    })

    if(decision.status=="accept"):
        return {"cheating_detected":False}
    else:
        return {"cheating_detected":True, "messages": [RemoveMessage(id=state["messages"][-1].id)]}
    
async def card_gen_node(state: PitchDebateState, config: RunnableConfig):
    phase_id = state.get("phase_id")
    card_gen_chain = get_card_gen_chain(phase_id)
    currencies_explanation=""
    for m_id in MetricFactory.get_available_metrics():
        currencies_explanation+=(f"currency name:{MetricFactory.get_metric(m_id).name}; currency prompt:{MetricFactory.get_metric(m_id).metric_prompt}; active: {MetricFactory.get_metric(m_id).phases[phase_id]} \n,")

    action_cards=""
    if("action_cards" in state):
        for c in state["action_cards"]:
            if c:
                title = c.get("title")
                desc = c.get("short_description")
                action_cards += f"-----\n{title}\n{desc}\n\n"
 
    input_messages = state["messages"]

    last_stakeholder_message = ""
    for m in reversed(input_messages):
        m_content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
        m_type = m.get("type", "") if isinstance(m, dict) else getattr(m, "type", "")
        if m_type == "ai" and m_content:
            last_stakeholder_message = m_content
            break

    # Get allowed stakeholder names for the prompt
    st_ids = StakeholderFactory.get_active_stakeholders(state.get("phase_id")) if state.get("phase_id") is not None else StakeholderFactory.get_available_stakeholders()
    allowed_names = ", ".join([StakeholderFactory.get_stakeholder(st_id).name for st_id in st_ids])

    response = await card_gen_chain.ainvoke(
        {
            "last_stakeholder_message": last_stakeholder_message,
            "active_currencies": str(currencies_explanation),
            "stakeholder_names": allowed_names,
            "challenge":state["challenge"],
            "action_cards":action_cards,
            "action_card_images": PhaseFactory.action_card_images
        }
    )
    print(f"generated new action card: {response}")

    #solves pydantic error
    import uuid
    card_dict = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    card_dict["id"] = str(uuid.uuid4())
    
    new_action_cards=[]
    if "action_cards" in state:
        new_action_cards=state["action_cards"]

    new_action_cards.append(card_dict)
    return {"action_cards":new_action_cards}