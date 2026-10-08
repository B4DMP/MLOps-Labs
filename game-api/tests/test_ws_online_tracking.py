import asyncio
from unittest.mock import AsyncMock, MagicMock

from mlops_serious_game.infrastructure.websocket.manager import ConnectionManager


def _ws():
    ws = MagicMock()
    ws.accept = AsyncMock()
    return ws


def test_reconnect_overlap_keeps_player_online():
    m = ConnectionManager()
    old, new = _ws(), _ws()
    asyncio.run(m.connect(old, 1))
    asyncio.run(m.connect(new, 1))
    m.disconnect(old, 1)
    assert m.online_user_ids() == {1}
    m.disconnect(new, 1)
    assert m.online_user_ids() == set()


def test_read_only_viewer_is_not_online():
    m = ConnectionManager()
    asyncio.run(m.connect(_ws(), 2, read_only=True))
    assert m.online_user_ids() == set()
