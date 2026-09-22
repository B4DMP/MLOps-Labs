"""The account-level half of the playtest tools (docs/plans/results-screen.md, D9/D10).

Three small things, all touching the database: marking an account as a playtest account, filling a
challenge's dossier so a card can be built, and leaving a breadcrumb on the challenge that was
advanced. The card search itself is pure and lives in `auto_card`.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from mlops_serious_game.application.intel_handler import intel_rows
from mlops_serious_game.domain.Challenge import Challenge
from mlops_serious_game.domain.requirement import (
    ConfidenceType,
    IntelSource,
    StakeholderIntelItem,
)
from mlops_serious_game.domain.requirement_factory import RequirementFactory
from mlops_serious_game.infrastructure.database.connection import get_session
from mlops_serious_game.infrastructure.database.models import GameChallenge, IntelItem, User
from mlops_serious_game.infrastructure.database.run_scope import current_run_index
from mlops_serious_game.infrastructure.database.user_lookup import get_user_id


def taint_user(username: str) -> bool:
    """Marks the account as a playtest account. Returns True if it was not marked already.

    Account-level and never cleared (D10): contamination does not stay inside the challenge that
    caused it. Graph state, emotions and grudges carry forward within a run, the played-challenge
    set carries across runs, and the knowledge-delta series spans runs. So once a tool has
    fabricated progress, nothing downstream of it is research data.

    Called before a tool does anything, not after: a tool that fails half way has still changed
    the account.
    """
    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user is None or user.playtest_tainted:
            return False
        user.playtest_tainted = True
        return True


def auto_gather(username: str, challenge: Challenge) -> int:
    """Puts everything the challenge holds into the dossier, verified and correctly tagged.

    Needed because a card can only touch targets the player has looked at, so skipping the gathering
    steps without it leaves the pitch builder with nothing to build on. Idempotent: an item already
    there is upgraded in place rather than duplicated. Returns how many items were added or changed.
    """
    requirements = RequirementFactory.get_requirements_for_challenge(challenge.id)
    changed = 0
    with get_session() as session:
        user_id = get_user_id(session, username)
        records = list(intel_rows(session, user_id))
        by_id = {
            r.intel_item_data.get("id"): r
            for r in records
            if isinstance(r.intel_item_data, dict) and r.intel_item_data.get("id")
        }

        for requirement in requirements:
            existing = by_id.get(requirement.id)
            if existing is None:
                item = StakeholderIntelItem.from_requirement(
                    requirement,
                    intel_type=ConfidenceType.VERIFIED,
                    categorized_type=requirement.type,
                    description=requirement.description,
                    source=IntelSource.INTERVIEW,
                )
                item.discovered_phase_id = challenge.phase_id
                item.discovered_challenge_template = challenge.template_id
                session.add(
                    IntelItem(
                        user_name=username,
                        user_id=user_id,
                        run_index=current_run_index(session, user_id),
                        intel_item_data=item.model_dump(mode="json"),
                    )
                )
                changed += 1
                continue

            data = dict(existing.intel_item_data)
            tag = requirement.type.value if hasattr(requirement.type, "value") else str(requirement.type)
            already = (
                data.get("intel_type") == ConfidenceType.VERIFIED.value
                and data.get("categorized_type") == tag
            )
            if already:
                continue
            data["intel_type"] = ConfidenceType.VERIFIED.value
            data["categorized_type"] = tag
            data["categorized_description"] = requirement.description
            existing.intel_item_data = data
            flag_modified(existing, "intel_item_data")
            changed += 1
    return changed


def mark_auto_played(username: str, phase_id: int, challenge_id: int) -> None:
    """Records that a playtest tool advanced this challenge. A debugging breadcrumb and nothing
    more: nothing filters on it, the exclusion from research data is `User.playtest_tainted`."""
    with get_session() as session:
        user_id = get_user_id(session, username)
        row = session.scalars(
            select(GameChallenge)
            .where(
                GameChallenge.user_id == user_id,
                GameChallenge.run_index == current_run_index(session, user_id),
                GameChallenge.phase_index == phase_id,
                GameChallenge.challenge_index == challenge_id,
            )
            .order_by(GameChallenge.id.desc())
        ).first()
        if row is not None:
            row.auto_played = True
