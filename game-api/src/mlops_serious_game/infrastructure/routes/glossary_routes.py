from fastapi import APIRouter

from mlops_serious_game.domain.glossary_factory import GlossaryFactory

router = APIRouter(prefix="/api/glossary", tags=["Glossary"])


@router.get("")
async def get_glossary():
    """Returns the MLOps glossary used to highlight terms in game text.

    Deliberately unauthenticated: it is static teaching content the client needs before a
    player has done anything, and it reveals nothing about a session or another player.
    """
    return {"type": "glossary_config", **GlossaryFactory.get_config_dict()}
