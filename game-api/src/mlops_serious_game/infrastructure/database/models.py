import datetime
from typing import Any
from sqlalchemy import DateTime, Integer, String, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from mlops_serious_game.config import settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = settings.POSTGRES_USER_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    campaign_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)


class Campaign(Base):
    __tablename__ = settings.POSTGRES_CAMPAIGN_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_name: Mapped[str] = mapped_column(String(255), nullable=False)
    campaign_key: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)


class GameProgression(Base):
    __tablename__ = settings.POSTGRES_PROGRESSION_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    game_progress_index: Mapped[int] = mapped_column(Integer, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
    additional_data: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)


class GameChallenge(Base):
    __tablename__ = settings.POSTGRES_GAME_CHALLENGE_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
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
    intel_item_data: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)


class GraphOpLog(Base):
    """Append-only log of MLOps graph ops per player. One row per batch; the graph state is
    the fold of all rows in `seq` order, see application/graph_service."""

    __tablename__ = settings.POSTGRES_GRAPH_OP_LOG_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    phase_index: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_template: Mapped[str] = mapped_column(String(255), nullable=False)
    challenge_loop_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ops: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
