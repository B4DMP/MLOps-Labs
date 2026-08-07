import asyncio

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.prebuilt import ToolNode
from mlops_serious_game.config import settings
from langchain_core.messages import RemoveMessage
from mlops_serious_game.application.conversation_service.workflow.chains import (
    get_context_summary_chain,
    get_conversation_summary_chain,
    get_stakeholder_response_chain,
    get_router_chain,
    get_card_gen_checker_chain,
    get_card_gen_chain,
    get_anticheat_chain,
    get_rogue_stakeholder_response_chain
)
from mlops_serious_game.application.conversation_service.workflow.state import ChallengeState
from mlops_serious_game.application.conversation_service.workflow.tools import tools
from mlops_serious_game.domain.exceptions import RoutingStakeholderNotFound,NoStakeholderRoute
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
from mlops_serious_game.domain.stakeholder import Stakeholder
from mlops_serious_game.domain.metric_factory import MetricFactory
from mlops_serious_game.domain.phase_factory import PhaseFactory
from mlops_serious_game.domain.metric import Metric
import random

retriever_node = ToolNode(tools)


async def conversation_node(state: ChallengeState, config: RunnableConfig):

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

    response = await conversation_chain.ainvoke(
        {
            "messages": input_messages,
            "summary":summary,
            "challenge": challenge_text,
            "stakeholder_name": st.name,
            "stakeholder_division":st.division,
            "stakeholder_responsibilities": st.responsibilities,
            "stakeholder_priorities": st.priorities,
            "stakeholder_requirements": st.requirements,
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



async def summarize_conversation_node(state: ChallengeState):
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


async def summarize_context_node(state: ChallengeState):
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


async def connector_node(state: ChallengeState):
    return {}

async def send_message_connector_node(state: ChallengeState, config: RunnableConfig):
    if config["configurable"].get("ws")!=None and config["configurable"].get("callback")!=None:
        asyncio.create_task(config["configurable"].get("callback")(websocket=config["configurable"].get("ws"),state=state))

    return {}

def get_stakeholders_text(state: ChallengeState, config: RunnableConfig):
    stakeholders:str = ""
    phase_id = state.get("phase_id")
    selectionmask = config["configurable"].get("selectionmask")
    if phase_id is not None and selectionmask is not None:
        for st_id in StakeholderFactory.get_active_stakeholders(phase_id,selectionmask):
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders+=(f"- {st.division} ({st.name})\n")
    else:
        for st_id in StakeholderFactory.get_available_stakeholders():
            st = StakeholderFactory.get_stakeholder(st_id)
            stakeholders+=(f"- {st.division} ({st.name})\n")
        
    return stakeholders


async def router_node(state: ChallengeState, config: RunnableConfig):
    
    phase_id = state.get("phase_id")
    router_chain = get_router_chain(phase_id, config["configurable"].get("selectionmask"))

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
        st_ids = StakeholderFactory.get_active_stakeholders(state.get("phase_id"),config["configurable"].get("selectionmask")) if state.get("phase_id") is not None else StakeholderFactory.get_available_stakeholders()
        for st_id in st_ids:
            st = StakeholderFactory.get_stakeholder(st_id)
            target = f"{st.division} ({st.name})".strip().lower()

            if selected.strip().lower() == target:
                selected_stakeholder_ids.append(st_id)
                found = True
                break
        
        if not found:
            raise RoutingStakeholderNotFound(selected)
    return {"stakeholder_ids": list(set(selected_stakeholder_ids))}

async def card_check_node(state: ChallengeState):
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



async def anticheat_node(state: ChallengeState, config: RunnableConfig):
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
    
async def card_gen_node(state: ChallengeState, config: RunnableConfig):
    phase_id = state.get("phase_id")
    card_gen_chain = get_card_gen_chain(phase_id, config["configurable"].get("selectionmask"))
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
    st_ids = StakeholderFactory.get_active_stakeholders(state.get("phase_id"),config["configurable"].get("selectionmask")) if state.get("phase_id") is not None else StakeholderFactory.get_available_stakeholders()
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
    card_dict = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    selectionmask = config["configurable"].get("selectionmask") or []
    selected_count = len(selectionmask) if isinstance(selectionmask, list) else 0
    if selected_count > 4:
        malus = selected_count - 4
        card_dict['Efficiency'] -= malus
        if card_dict['Efficiency'] < -5:
            card_dict['Efficiency'] = -5
    
    new_action_cards=[]
    if "action_cards" in state:
        new_action_cards=state["action_cards"]

    new_action_cards.append(card_dict)
    return {"action_cards":new_action_cards}