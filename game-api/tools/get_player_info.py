import click
from sqlalchemy import select

from philoagents.infrastructure.database import GameProgression, GameSession, get_session


@click.command()
def main() -> None:
    """Display player progress."""
    try:
        player_data = {}
        with get_session() as session:
            progressions = session.scalars(select(GameProgression)).all()
            for prog in progressions:
                player = prog.user_name
                g_idx = prog.game_progress_index
                ts = prog.time_stamp

                if player not in player_data:
                    player_data[player] = {
                        "maxProgressIndex": g_idx,
                        "furthestProgression": (0, 0),
                        "lastPlayed": ts,
                    }
                else:
                    player_data[player]["maxProgressIndex"] = max(
                        player_data[player]["maxProgressIndex"], g_idx
                    )
                    if ts and (
                        not player_data[player]["lastPlayed"]
                        or ts > player_data[player]["lastPlayed"]
                    ):
                        player_data[player]["lastPlayed"] = ts

            game_sessions = session.scalars(select(GameSession)).all()
            for gs in game_sessions:
                player = gs.user_name
                p_idx = gs.phase_index
                c_idx = gs.challenge_index
                ts = gs.time_stamp

                if player not in player_data:
                    player_data[player] = {
                        "maxProgressIndex": 2,
                        "furthestProgression": (p_idx, c_idx),
                        "lastPlayed": ts,
                    }
                else:
                    if (p_idx, c_idx) > player_data[player]["furthestProgression"]:
                        player_data[player]["furthestProgression"] = (p_idx, c_idx)
                    if ts and (
                        not player_data[player]["lastPlayed"]
                        or ts > player_data[player]["lastPlayed"]
                    ):
                        player_data[player]["lastPlayed"] = ts

        for p in player_data:
            print(
                p,
                f"Game completed?: {player_data[p]['maxProgressIndex'] == 5}, ",
                f"furthestProgression: {player_data[p]['furthestProgression']}, ",
                f"LastPlayed: {player_data[p]['lastPlayed']}",
            )

    except Exception as e:
        print(f"Error accessing PostgreSQL: {e}")


if __name__ == "__main__":
    main()
