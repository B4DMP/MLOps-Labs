"""Pushing an event to one player's live sockets."""
import asyncio

from mlops_serious_game.infrastructure.websocket.manager import ConnectionManager


def test_the_push_reaches_every_live_socket_of_one_player_only():
    sent = []

    class Socket:
        def __init__(self, name):
            self.name = name

        async def send_json(self, data):
            sent.append((self.name, data["event"], data["payload"]))

    manager = ConnectionManager()
    mine, other = Socket("mine"), Socket("other")
    manager._player_sockets = {7: {mine}, 8: {other}}

    reached = asyncio.run(manager.send_to_player(7, "game:tokens_reset", {"attention_tokens": 20}))

    assert reached == 1
    assert sent == [("mine", "game:tokens_reset", {"attention_tokens": 20})]
