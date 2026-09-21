from fastapi import APIRouter

from mlops_serious_game.domain.glossary_factory import GlossaryFactory

router = APIRouter(prefix="/api/glossary", tags=["Glossary"])


@router.get("")
async def get_glossary():
    """Returns the glossaries used to highlight terms in game text.

    Two of them: the MLOps practice and the vocabulary of the world the game is set in. They
    travel together because the client matches them in one pass, so that a phrase claimed by
    both ("distribution centre" against "distribution") is decided once instead of being
    highlighted twice.

    Deliberately unauthenticated: it is static teaching content the client needs before a
    player has done anything, and it reveals nothing about a session or another player.
    """
    return {"type": "glossary_config", "glossaries": GlossaryFactory.get_configs_dict()}
