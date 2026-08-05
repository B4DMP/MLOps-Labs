import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), "src"))
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from philoagents.domain.stakeholder_factory import StakeholderFactory
import asyncio
import datetime
from opik.integrations.langchain import OpikTracer
import random
from philoagents.application.conversation_service.workflow.graph import (
    create_workflow_graph,
)
from philoagents.domain.phase_factory import PhaseFactory
from philoagents.config import settings
from philoagents.infrastructure.opik_utils import configure


configure()

graph_builder = create_workflow_graph()

async def generate_response_with_memory( messages: list, challenge: str, phase_id: int, _thread_id: str, selectionmask: list[bool]):
    async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
        await checkpointer.setup()
        graph = graph_builder.compile(checkpointer=checkpointer)
        opik_tracer = OpikTracer(
            project_name="MLOps serious game",
            thread_id=_thread_id
        )

        config = {
            "configurable": {
                "thread_id": "api_live_test",
                "selectionmask": selectionmask
            },
            "callbacks": [opik_tracer],
            "recursion_limit": 150
        }
        output_state = await graph.ainvoke(
            input={
                "messages": messages,
                "challenge": challenge,
                "phase_id": phase_id
            },
            config=config,
        )
        return output_state

async def reset_thread(thread_id: str):
    async_engine = create_async_engine(settings.POSTGRES_ASYNC_URI)
    async with async_engine.begin() as conn:
        await conn.execute(text("DELETE FROM checkpoints WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_writes WHERE thread_id = :thread_id"), {"thread_id": thread_id})
        await conn.execute(text("DELETE FROM checkpoint_blobs WHERE thread_id = :thread_id"), {"thread_id": thread_id})
    await async_engine.dispose()

BLACK = '\033[30m'
RED = '\033[31m'
GREEN = '\033[32m'
YELLOW = '\033[33m' 
BLUE = '\033[34m'
MAGENTA = '\033[35m'
CYAN = '\033[36m'
LIGHT_GRAY = '\033[37m'
DARK_GRAY = '\033[90m'
BRIGHT_RED = '\033[91m'
BRIGHT_GREEN = '\033[92m'
BRIGHT_YELLOW = '\033[93m'
BRIGHT_BLUE = '\033[94m'
BRIGHT_MAGENTA = '\033[95m'
BRIGHT_CYAN = '\033[96m'
WHITE = '\033[97m'

RESET = '\033[0m' 

stakeholder_colors=[RED,CYAN,BLUE,YELLOW,MAGENTA]

def print_action_card(action_card):
    authors=""
    for a in action_card.get("stakeholder_names", []):
        authors += f"{determine_stakeholder_color(a)}{a}{RESET},"

    print(f"""
-------------------
{action_card.get('title', 'Unknown Title')}
by {authors}
{action_card.get('short_description', 'No description')}

Model: {action_card.get('Model', 0)}
Automation: {action_card.get('Automation', 0)}
Reliability: {action_card.get('Reliability', 0)}
Data: {action_card.get('Data', 0)}
Requirements: {action_card.get('Requirements', 0)}
Efficiency: {action_card.get('Efficiency', 0)}
-------------------
          """)

def determine_stakeholder_color(stakeholder: str):
    if not stakeholder:
        return RESET
    from philoagents.domain.stakeholder_factory import StakeholderFactory
    available_ids = StakeholderFactory.get_available_stakeholders()
    index=0
    for i in range(len(StakeholderFactory.get_available_stakeholders())):
        if StakeholderFactory.get_available_stakeholders()[i]==stakeholder:
           index=i
           break

    return stakeholder_colors[index % len(stakeholder_colors)]

async def api_live_test():
    action_card_count=0
    await reset_thread("api_live_test")

    thread_id= "LT_Convo"+str(datetime.datetime.now())

    phase_index = 2
    challenge_index = 1
    curr_challenge = PhaseFactory.get_challenge_by_index(phase_index, challenge_index)
    test_challenge = curr_challenge.name + ": " + curr_challenge.roundIntroduction + curr_challenge.description
    
    all_available = StakeholderFactory.get_available_stakeholders()
    active_in_phase = StakeholderFactory.get_active_stakeholders(phase_index, all_available)
    
    selectionmask = random.sample(active_in_phase, min(4, len(active_in_phase)))
    cursor = 0
    print('\n Starting with stakeholder chat live test. Write "exit" to stop. \n')
    while(True):
        msg = input('Enter message to stakeholder chat:\n')
        if msg.lower()=="exit":
            break
        
        new_messages = [HumanMessage(content=msg)]
        output_state = await generate_response_with_memory(new_messages, test_challenge, phase_index, thread_id, selectionmask)
        
        all_messages = output_state["messages"]
        if(len(all_messages)<cursor):
            cursor=0
        new_responses = all_messages[cursor:]
        cursor = len(all_messages)
        
        import re
        for m in new_responses:
            m_type = type(m).__name__
            tool_calls = getattr(m, "tool_calls", None)
            
            # Print tool calls if present
            if tool_calls:
                print(f"\n{YELLOW}[TOOL CALL] {m_type} requested tool: {[tc['name'] for tc in tool_calls]} with args: {[tc['args'] for tc in tool_calls]}{RESET}\n")
            
            # Print tool response messages
            if m_type == 'ToolMessage':
                m_content = getattr(m, "content", "")
                m_content_safe = m_content.encode('ascii', errors='replace').decode('ascii')
                print(f"\n{GREEN}[TOOL RESPONSE] Tool '{getattr(m, 'name', 'unknown')}' output: {m_content_safe}{RESET}\n")
                continue
                
            m_content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
            # Sanitize non-ASCII characters for Windows terminal compatibility
            m_content_safe = m_content.encode('ascii', errors='replace').decode('ascii')
            
            # Match pattern [Division-Name] Message
            match = re.match(r"^\[(.*)-(.*)\]\s*(.*)$", m_content_safe, re.DOTALL)
            if match:
                division, name, message = match.groups()
                division = division.strip()
                name = name.strip()
                color = determine_stakeholder_color(name)
                print(f"\n{color}{name} ({division}){RESET} {message}\n")
            elif m_content_safe.strip():
                print(f"\n{m_content_safe}\n")
        
        if("action_cards" in output_state):
            if(len(output_state["action_cards"])!= action_card_count):
                for i in range(action_card_count,len(output_state["action_cards"])):
                    print_action_card(output_state["action_cards"][i])
                    action_card_count+=1
asyncio.run(api_live_test())