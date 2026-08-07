import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "src"))
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from mlops_serious_game.domain.stakeholder_factory import StakeholderFactory
import asyncio
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.conversation_service.workflow.graph import (
    create_workflow_graph,
)
from mlops_serious_game.config import settings


graph_builder = create_workflow_graph()


async def generate_response_with_memory(messages: list, challenge: str):
    async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
        await checkpointer.setup()
        graph = graph_builder.compile(checkpointer=checkpointer)
        opik_tracer = OpikTracer(
            graph=graph.get_graph(xray=True), thread_id="api_action_card_test"
        )

        config = {
            "configurable": {"thread_id": "api_action_card_test"},
            "callbacks": [opik_tracer],
        }
        output_state = await graph.ainvoke(
            input={
                "messages": messages,
                "challenge": challenge,
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


BLACK = "\033[30m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"  # orange on some systems
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
LIGHT_GRAY = "\033[37m"
DARK_GRAY = "\033[90m"
BRIGHT_RED = "\033[91m"
BRIGHT_GREEN = "\033[92m"
BRIGHT_YELLOW = "\033[93m"
BRIGHT_BLUE = "\033[94m"
BRIGHT_MAGENTA = "\033[95m"
BRIGHT_CYAN = "\033[96m"
WHITE = "\033[97m"

RESET = "\033[0m"

stakeholder_colors = [RED, CYAN, BLUE, YELLOW, MAGENTA]

messages = [
    HumanMessage(
        content="I’m seeing signs that the ML product’s performance has degraded recently. Can you collaborate to assess what’s happening and determine a path forward?"
    ),
    AIMessage(
        name="Marcus Turner",
        content="From a business perspective, this is concerning if forecasts are becoming less reliable. Before we talk solutions, I’d like to understand whether this is a temporary anomaly or a structural issue.",
    ),
    AIMessage(
        name="Olivia Grant",
        content="From QA monitoring, this is structural. Our evaluation dashboards show a consistent performance drop across recent data slices. This points to data or concept drift rather than noise.",
    ),
    AIMessage(
        name="Daniel Whitaker",
        content="I agree. I’ve analyzed feature distributions, and they’ve shifted significantly compared to the training data. The model is behaving as expected given the drift—it’s the environment that changed.",
    ),
    AIMessage(
        name="Emily Brooks",
        content="Infrastructure-wise, pipelines and deployments are stable. No failures or latency spikes. This confirms the issue is model validity, not system reliability.",
    ),
    AIMessage(
        name="Jason Fletcher",
        content="If the model is operating outside its validated assumptions, that raises governance concerns. We need to mitigate risk and ensure transparency if decisions are affected.",
    ),
    HumanMessage(
        content="Given these constraints and priorities, what actions would you recommend collectively?"
    ),
    AIMessage(
        name="Olivia Grant",
        content="First, we should formalize drift detection with thresholds and alerts. That allows us to catch this earlier and prevents silent degradation.",
    ),
    AIMessage(
        name="Daniel Whitaker",
        content="Agreed. In parallel, we should retrain the model using recent data that reflects the new patterns. I’d also recommend scheduled retraining rather than ad hoc updates.",
    ),
    AIMessage(
        name="Emily Brooks",
        content="Monthly retraining is acceptable if we automate it and control compute costs. I also suggest a rollback or fallback mechanism when drift exceeds safe limits.",
    ),
    AIMessage(
        name="Jason Fletcher",
        content="From a compliance standpoint, we must document the drift event, the retraining decision, and notify stakeholders that a model update is occurring.",
    ),
    AIMessage(
        name="Marcus Turner",
        content="This sounds reasonable as long as the cost-benefit balance holds. Improved accuracy protects credibility, and automation keeps costs predictable.",
    ),
    AIMessage(
        name="Daniel Whitaker",
        content="Synthesizing this, the technical response would be: automated drift detection, immediate retraining with recent data, and more frequent scheduled updates.",
    ),
    AIMessage(
        name="Olivia Grant",
        content="With the addition of a fallback mechanism and formal evaluation checkpoints before redeployment.",
    ),
    AIMessage(
        name="Jason Fletcher",
        content="And mandatory documentation and transparent communication to reduce regulatory and reputational risk.",
    ),
    AIMessage(
        name="Emily Brooks",
        content="All of this is operationally feasible within our constraints.",
    ),
    HumanMessage(
        content="So can everybody agree to this action plan? Short answers only please."
    ),
]


def determine_stakeholder_color(stakeholder: str):
    if not stakeholder:
        return RESET
    available_ids = StakeholderFactory.get_available_stakeholders()
    index = 0
    for i in range(len(available_ids)):
        # only compares the first few characters, dirty fix (change routing)
        if available_ids[i][:4] == stakeholder[:4]:
            index = i
            break

    return stakeholder_colors[index % len(stakeholder_colors)]


def print_action_card(action_card):
    authors = ""
    for a in action_card.stakeholder_names:
        authors += f"{determine_stakeholder_color(a)}{a}{RESET},"

    print(f"""
-------------------
{action_card.title}
by {authors}
{action_card.short_description}

Model: {action_card.value_changes[0]}
Automation: {action_card.value_changes[1]}
Reliability: {action_card.value_changes[2]}
Data: {action_card.value_changes[3]}
Requirements: {action_card.value_changes[4]}
Efficiency: {action_card.value_changes[5]}
-------------------
          """)


async def api_action_card_test():
    await reset_thread("api_action_card_test")

    test_challenge = "Data Drift Issues"

    output_state = await generate_response_with_memory(messages, test_challenge)

    all_messages = output_state["messages"]

    for m in all_messages:
        if not m.name:
            print(f"\n Player: {m.content}\n")
            continue
        print(f"\n{determine_stakeholder_color(m.name)}{m.name} {RESET} {m.content}\n")

    if "action_cards" in output_state:
        for c in output_state["action_cards"]:
            print_action_card(c)


asyncio.run(api_action_card_test())
