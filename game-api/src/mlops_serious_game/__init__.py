import sys
import asyncio
from mlops_serious_game.infrastructure.opik_utils import configure

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

configure()

