import asyncio
from functools import wraps

import click

from philoagents.application.conversation_service.generate_response import (
    get_streaming_response,
)


def async_command(f):
    """Decorator to run an async click command."""

    @wraps(f)
    def wrapper(*args, **kwargs):
        return asyncio.run(f(*args, **kwargs))

    return wrapper


@click.command()
@click.option(
    "--challenge",
    type=str,
    required=True,
    help="The current MLOps challenge to run the workflow against.",
)
@click.option(
    "--query",
    type=str,
    required=True,
    help="User query to start the conversation.",
)
@async_command
async def main(challenge: str, query: str) -> None:
    """CLI command to query the conversation workflow.

    Args:
        challenge: The current MLOps challenge.
        query: Initial user message.
    """

    print(
        f"\033[32mStarting workflow with challenge: `{challenge}` "
        f"and query: `{query}`\033[0m"
    )
    print("\033[32mResponse:\033[0m")
    print("\033[32m--------------------------------\033[0m")

    async for chunk in get_streaming_response(
        messages=query,
        challenge=challenge,
    ):
        print(f"\033[32m{chunk}\033[0m", end="", flush=True)

    print("\n\033[32m--------------------------------\033[0m")


if __name__ == "__main__":
    main()
