import datetime
from typing import Any
from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, JSON, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from mlops_serious_game.config import settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = settings.POSTGRES_USER_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Real external identity string used by the admin API/UI - kept permanently, not just
    # denormalization of campaign_id (see docs/plans/pk-migration.md).
    campaign_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    campaign_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_CAMPAIGN_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Set the first time a playtest tool fabricates progress, never cleared (D10). Account-level
    # because contamination does not stay inside one challenge or run: see docs/plans/results-screen.md.
    playtest_tainted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    users_on_machine: Mapped[int] = mapped_column(Integer, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Pending email-verification code, generated at registration and re-issued on every login
    # attempt while unverified (docs/plans/password-auth.md).
    verification_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    verification_code_expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    # Kept separate from verification_code so a forgot-password request on an already-verified
    # account can never be confused with (or short-circuit) the registration-verification path.
    password_reset_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    password_reset_code_expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)
    # Pending email change (docs/plans/session-persistence-and-url-routing.md, Profile
    # management): mirrors the password-reset pair above - `email` only ever updates once the
    # code sent to `pending_email` is confirmed, never on request alone.
    pending_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_change_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    email_change_code_expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime, nullable=True)


class Campaign(Base):
    __tablename__ = settings.POSTGRES_CAMPAIGN_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    campaign_name: Mapped[str] = mapped_column(String(255), nullable=False)
    campaign_key: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    use_questionnaire: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Off by default: a research campaign wants one run per player (the end screen says so).
    allow_replay: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Players registering with this campaign's key skip email entirely and are auto-verified -
    # see auth_service.register_user. Never enable this on a real campaign.
    is_test_campaign: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # On by default. Set false to let players register with an email but skip the code-verification
    # step (auto-verified on registration) - a lighter opt-out than is_test_campaign, which also
    # drops the email requirement and the password-length policy. See auth_service.register_user.
    require_email_verification: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Teacher(Base):
    """A monitoring-only account (docs/plans/teacher-role.md): can watch the players of its
    assigned campaigns in real time, but has none of the admin panel's editing rights. Unlike
    the admin account (settings.ADMIN_USER, no DB row), teachers are plural and self-contained,
    so they get a real table - created and password-managed only by an admin, never by
    self-registration."""

    __tablename__ = settings.POSTGRES_TEACHER_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_name: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )


class TeacherCampaign(Base):
    """Which campaigns a teacher may monitor - a teacher sees nothing outside this join, unlike
    the admin preview route which can pick any campaign set on the fly."""

    __tablename__ = settings.POSTGRES_TEACHER_CAMPAIGN_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    teacher_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_TEACHER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    campaign_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_CAMPAIGN_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )


class GameProgression(Base):
    __tablename__ = settings.POSTGRES_PROGRESSION_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    game_progress_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # Which playthrough this row belongs to. 1 for everyone who played before replay existed.
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # The run this one continues, or null for a fresh start. This is the whole difference
    # between the two new-game modes: see docs/plans/results-screen.md (D11) and `run_chain`.
    seeded_from_run: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
    additional_data: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)


class GameChallenge(Base):
    __tablename__ = settings.POSTGRES_GAME_CHALLENGE_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    phase_index: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_index: Mapped[int] = mapped_column(Integer, nullable=False)
    challenge_loop_index: Mapped[int] = mapped_column(Integer, nullable=False)
    action_card: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    metric_values: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
    messages: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    attention_tokens: Mapped[int] = mapped_column(Integer, default=20, nullable=True)
    emotion_values: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    # Debugging breadcrumb only: which challenge a playtest tool advanced. Nothing filters on it;
    # the exclusion from research data is `User.playtest_tainted`.
    auto_played: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class GameSession(Base):
    __tablename__ = settings.POSTGRES_GAME_SESSION_DATA_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
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
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    intel_item_data: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)


class GraphOpLog(Base):
    """Append-only log of MLOps graph ops per player. One row per batch; the graph state is
    the fold of all rows in `seq` order, see application/graph_service."""

    __tablename__ = settings.POSTGRES_GRAPH_OP_LOG_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
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
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
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


class UserSettings(Base):
    """One row per player: the preferences the settings panel owns
    (docs/plans/player-settings-and-tts.md).

    The `user_id` FK cascades like every other per-player table, so a reset (which deletes and
    recreates the `User` row) also returns these to their defaults, which is what "as if freshly
    registered" means.

    `voice_*` hold raw `SpeechSynthesisVoice.name` strings. They are OS- and browser-specific, so
    a stored name that no longer resolves is not an error: the client falls back to matching a
    voice by name pattern.
    """

    __tablename__ = settings.POSTGRES_USER_SETTINGS_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    auto_skip_conversations: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    mute_tts: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    voice_male: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voice_female: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voice_narrator: Mapped[str | None] = mapped_column(String(255), nullable=True)
    voice_player: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # "auto" (default) prefers the server-side edge-tts narration and falls back to
    # window.speechSynthesis on a failed backend call; "webspeech" skips the backend entirely and
    # forces the old client-only behaviour.
    tts_backend: Mapped[str] = mapped_column(String(32), default="auto", nullable=False)
    # Which of the two server-side player voices (tts_service.PLAYER_VOICES) narrates the
    # player's own lines. Chosen at registration, editable later in settings.
    player_voice_gender: Mapped[str] = mapped_column(String(16), default="male", nullable=False)
    # Multiplier on narration speed, applied on both TTS paths (tts_service.py's edge-tts `rate`
    # and window.speechSynthesis's `utterance.rate`). 1.0 is unchanged, below slower, above faster.
    speech_rate: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )


class GameResult(Base):
    """One computed results payload per (player, run), cached on first request.

    Building a run's results folds its whole op log and event log, which is fine once for the
    player but not once per run per admin page load. The payload is the whole screen: grade,
    pillars, metrics, pipeline and knowledge delta (docs/plans/results-screen.md).
    """

    __tablename__ = settings.POSTGRES_GAME_RESULT_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    run_index: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    payload: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )


class BugReportRow(Base):
    """A player-submitted "Report a Bug" note, with a client-supplied debug snapshot attached.

    No docker/container logs are gathered here - just what the browser already knows (current
    phase/challenge, page URL, user agent) plus the player's own message.
    """

    __tablename__ = settings.POSTGRES_BUG_REPORT_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey(f"{settings.POSTGRES_USER_DATA_TABLE}.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    message: Mapped[str] = mapped_column(String(4000), nullable=False)
    page_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    debug_info: Mapped[Any] = mapped_column(JSON, default=dict, nullable=False)
    time_stamp: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )


class BugReportRecipientsRow(Base):
    """Single-row table (id=1) holding who gets emailed on a new bug report. Admin-editable via
    /api/admin/bug-reports/recipients; falls back to `settings.BUG_REPORT_DEFAULT_RECIPIENTS`
    when no row exists yet."""

    __tablename__ = settings.POSTGRES_BUG_REPORT_RECIPIENTS_TABLE

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipients: Mapped[Any] = mapped_column(JSON, default=list, nullable=False)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )


class LlmCacheEntry(Base):
    """One cached LLM answer. `key_hash` is a sha256 of the prompt and the model settings."""

    __tablename__ = settings.POSTGRES_LLM_CACHE_TABLE
    __table_args__ = (
        UniqueConstraint("cache_name", "version", "key_hash", name="uq_llm_cache_key"),
        Index("ix_llm_cache_lru", "cache_name", "version", "last_used_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cache_name: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[str] = mapped_column(String(128), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )
    last_used_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, default=datetime.datetime.utcnow, nullable=False
    )


class LlmCacheStat(Base):
    """Hits and misses of one cache under one build version."""

    __tablename__ = settings.POSTGRES_LLM_CACHE_STAT_TABLE

    cache_name: Mapped[str] = mapped_column(String(64), primary_key=True)
    version: Mapped[str] = mapped_column(String(128), primary_key=True)
    hits: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    misses: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
