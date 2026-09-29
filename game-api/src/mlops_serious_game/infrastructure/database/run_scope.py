"""Which run a player is on, and which runs a run can see (docs/plans/results-screen.md, D1/D11).

A player can finish the game and start another. Every per-player table carries a `run_index`, and
the live game reads the *chain* the current run belongs to rather than a flat `run_index ==` test:

- **Fresh start** writes a progression row with `seeded_from_run = None`. Its chain is itself, so
  it sees a clean graph, an empty dossier and no history.
- **Next iteration** (the spiral) writes `seeded_from_run = <previous run>`. Its chain is that run
  plus everything that run could see, so the player returns to requirements carrying the system
  they already built, with its maturity, debt and active anti-patterns intact.

Runs 1 fresh, 2 spiral, 3 fresh, 4 spiral gives run 4 the chain `{3, 4}`: a fresh start after a
spiral correctly begins clean, with no special case anywhere.

Nothing here deletes. A new game inserts a new run; earlier runs keep every row they wrote, which
is what the results screen and the admin aggregates read.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from mlops_serious_game.infrastructure.database.models import GameProgression

# A player who has never written a progression row is on run 1 by definition: the column
# defaults to 1, so their first rows land there whether or not this is ever called.
FIRST_RUN = 1


def current_run_index(session: Session, user_id: int) -> int:
    """The run the player is playing now: the highest `run_index` they have progressed to."""
    highest = session.scalar(
        select(GameProgression.run_index).where(GameProgression.user_id == user_id)
        .order_by(GameProgression.run_index.desc())
    )
    return int(highest) if highest else FIRST_RUN


def _seeded_from(session: Session, user_id: int) -> dict[int, int | None]:
    """`{run_index: seeded_from_run}`, one entry per run the player has started.

    Read in one query and folded here rather than walked with a query per hop: a chain is at most
    as long as the player's run count, but it is resolved on every graph, intel and event read.
    """
    rows = session.execute(
        select(GameProgression.run_index, GameProgression.seeded_from_run).where(
            GameProgression.user_id == user_id
        )
    ).all()
    links: dict[int, int | None] = {}
    for run_index, seeded_from in rows:
        run = int(run_index or FIRST_RUN)
        # A run's rows all carry the same `seeded_from_run`, but the first row of a run is written
        # with it and later rows default to null, so the non-null answer is the authoritative one.
        if seeded_from is not None or run not in links:
            links[run] = int(seeded_from) if seeded_from is not None else links.get(run)
    return links


def run_chain(session: Session, user_id: int, run_index: int | None = None) -> list[int]:
    """Every run whose rows `run_index` can see, itself included, newest first.

    Walks `seeded_from_run` back until a fresh start. Guards against a cycle, so malformed data
    degrades to a short chain instead of hanging the request.
    """
    run = run_index if run_index is not None else current_run_index(session, user_id)
    links = _seeded_from(session, user_id)

    chain: list[int] = []
    seen: set[int] = set()
    while run is not None and run not in seen:
        seen.add(run)
        chain.append(run)
        run = links.get(run)
    return chain


def parent_run(session: Session, user_id: int, run_index: int | None = None) -> int | None:
    """The run this one continues, or None for a fresh start.

    This is the spiral baseline: the results screen scores a next-iteration run on what it added
    to the system it inherited, not on the inherited system itself.
    """
    run = run_index if run_index is not None else current_run_index(session, user_id)
    return _seeded_from(session, user_id).get(run)
