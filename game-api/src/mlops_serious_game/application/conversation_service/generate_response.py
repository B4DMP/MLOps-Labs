import uuid
from typing import Any, AsyncGenerator, Union

from mlops_serious_game.config import settings
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from opik.integrations.langchain import OpikTracer

from mlops_serious_game.application.conversation_service.workflow.graph import (
    create_workflow_graph,
)
from mlops_serious_game.application.conversation_service.workflow.state import ChallengeState


async def get_response(
    messages: str | list[str] | list[dict[str, Any]],
    challenge: str, _thread_id: str, phase_id: int, challenge_id: int = 0, ws=None, callback=None
) -> tuple[str, ChallengeState]:
    """Run a conversation through the workflow graph.

    Args:
        message: Initial message to start the conversation.
        challenge: the current MLOps challenge

    Returns:
        tuple[str, ChallengeState]: A tuple containing:
            - The content of the last message in the conversation.
            - The final state after running the workflow.

    Raises:
        RuntimeError: If there's an error running the conversation workflow.
    """


    graph_builder = create_workflow_graph()
    
    input_messages_amount=0

    try:
        async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
            await checkpointer.setup()
            graph = graph_builder.compile(checkpointer=checkpointer)
            opik_tracer = OpikTracer(
                project_name="MLOps serious game",
                metadata={"thread_id": _thread_id},
            )

            config = {
                "configurable": {"thread_id": _thread_id,
                                  "ws":ws, "callback":callback},
                "callbacks": [opik_tracer],
                "recursion_limit": 150
            }
            output_state = await graph.ainvoke(
                input={
                    "messages": __format_messages(messages=messages),
                    "challenge": challenge,
                    "phase_id": phase_id,
                    "challenge_id": challenge_id,
                },
                config=config,
            )
            return_messages=[]

            for i in range(len(output_state["messages"]) - 1, -1, -1):
                msg = output_state["messages"][i]
                if isinstance(msg, AIMessage):
                    if msg.content and not msg.tool_calls:
                         return_messages.append(msg)
                elif isinstance(msg, HumanMessage):
                    break

        return return_messages, output_state
    except Exception as e:
        raise RuntimeError(f"Error running conversation workflow: {str(e)}") from e




async def get_streaming_response(
    messages: str | list[str] | list[dict[str, Any]],
    challenge: str,
    new_thread: bool = False,
) -> AsyncGenerator[str, None]:
    """Run a conversation through the workflow graph with streaming response.

        Args:
        messages: Initial message to start the conversation.
        challenge: the current MLOps challenge
    Yields:
        Chunks of the response as they become available.

    Raises:
        RuntimeError: If there's an error running the conversation workflow.
    """
    graph_builder = create_workflow_graph()

    try:
        async with AsyncPostgresSaver.from_conn_string(settings.POSTGRES_CHECKPOINTER_URI) as checkpointer:
            await checkpointer.setup()
            graph = graph_builder.compile(checkpointer=checkpointer)
            thread_id = "challenge_graph"
            opik_tracer = OpikTracer(
                thread_id=thread_id
            )
            
            config = {
                "configurable": {"thread_id": thread_id},
                "callbacks": [],
                "recursion_limit": 150
            }

            async for chunk in graph.astream(
                    input={
                        "messages": __format_messages(messages=messages),
                        "challenge": challenge,
                    },
                    config=config,
                    stream_mode="messages",
                ):
                if chunk[1]["langgraph_node"] == "conversation_node" and isinstance(
                    chunk[0], AIMessageChunk
                ):
                    print(chunk[0].content)
                    yield chunk[0].content


    except Exception as e:
        raise RuntimeError(
            f"Error running streaming conversation workflow: {str(e)}"
        ) from e


def __format_messages(
    messages: Union[str, list[dict[str, Any]]],
) -> list[Union[HumanMessage, AIMessage]]:
    """Convert various message formats to a list of LangChain message objects.

    Args:
        messages: Can be one of:
            - A single string message
            - A list of string messages
            - A list of dictionaries with 'role' and 'content' keys

    Returns:
        List[Union[HumanMessage, AIMessage]]: A list of LangChain message objects
    """

    if isinstance(messages, str):
        return [HumanMessage(content=messages)]

    if isinstance(messages, list):
        if not messages:
            return []

        if (
            isinstance(messages[0], dict)
            and "role" in messages[0]
            and "content" in messages[0]
        ):
            result = []
            for msg in messages:
                if msg["role"] == "user":
                    result.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    result.append(AIMessage(content=msg["content"]))
            return result

        return [HumanMessage(content=message) for message in messages]

    return []
