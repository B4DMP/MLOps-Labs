import datetime
from typing import Any
from sqlalchemy import DateTime, ForeignKey, Integer, String, JSON, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from mlops_serious_game.config import settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = settings.POSTGRES_USER_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Real external identity string used by the admin API/UI - kept permanently, not just
    # denormalization of campaign_id (see docs/plans/pk-migration.md).
    campaign_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    campaign_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_CAMPAIGN_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class Campaign(Base):
    __tablename__ = settings.POSTGRES_CAMPAIGN_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_name: Mapped[str] = mapped_column(String(255), nullable=False)
    campaign_key: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    use_questionnaire: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class GameProgression(Base):
    __tablename__ = settings.POSTGRES_PROGRESSION_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    game_progress_index: Mapped[int] = mapped_column(Integer, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
    additional_data: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)


class GameChallenge(Base):
    __tablename__ = settings.POSTGRES_GAME_CHALLENGE_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    phase_index: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_index: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_loop_index: Mapped[int] = mapped_column(Integer, nullable=False)
    action_card: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    metric_values: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
    pitch_debate_messages: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    online_intel_gathering_messages: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    attention_tokens: Mapped[int] = mapped_column(Integer, default=8, nullable=True)
    emotion_values: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)


class GameSession(Base):
    __tablename__ = settings.POSTGRES_GAME_SESSION_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    stakeholder_archetypes: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    # {stakeholder_id: persona_key} drawn once for this player and kept for the whole game
    stakeholder_personas: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    # 3 per game, never regenerated (D15): spent on a Veto Breaker or an Emergency Addendum
    escalation_points: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    # What neglected stakeholders remember, fired in the simulation phase (plan 07)
    grudges: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )


class IntelItem(Base):
    __tablename__ = settings.POSTGRES_INTEL_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    intel_item_data: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)


class GraphOpLog(Base):
    """Append-only log of MLOps graph ops per player. One row per batch; the graph state is
    the fold of all rows in `seq` order, see application/graph_service."""

    __tablename__ = settings.POSTGRES_GRAPH_OP_LOG_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    phase_index: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_template: Mapped[str] = mapped_column(String(255), nullable=False)
    challenge_loop_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ops: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    # The DeltaReport this batch produced, when it came from a simulation (source_kind
    # "action_card"/"world_event" via run_simulation) - null for seed/challenge_seed/admin
    # batches. Read back on a replayed `simulation:run` so the player is shown the exact report
    # that was actually applied, never a re-simulated one (code review, D-question 1).
    report: Mapped[Any] = mapped_column(JSON, nullable=True)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )


class GameEventRow(Base):
    """Append-only log of `GameEvent`s per player (plan 11, D51): one row per event, `seq`
    monotonic per user. See `application/event_log_service` for the fold/read side."""

    __tablename__ = settings.POSTGRES_GAME_EVENT_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    phase_id: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_id: Mapped[int] = mapped_column(Integer, nullable=False)
    step: Mapped[str] = mapped_column(String(16), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    direction: Mapped[str] = mapped_column(String(8), nullable=False)
    magnitude: Mapped[str | None] = mapped_column(String(16), nullable=True)
    cause: Mapped[str] = mapped_column(String(128), nullable=False)
    params: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    refs: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
