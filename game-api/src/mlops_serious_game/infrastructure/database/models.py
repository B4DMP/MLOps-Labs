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


class GameSession(Base):
    __tablename__ = settings.POSTGRES_GAME_DATA_TABLE

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
    emotion_values: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)


class IntelItem(Base):
    __tablename__ = settings.POSTGRES_INTEL_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    intel_item_data: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    
