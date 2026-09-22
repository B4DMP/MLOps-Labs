from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_PROJECT_ROOT / ".env", ".env"),
        extra="ignore",
        env_file_encoding="utf-8",
    )

    # -- Security & Admin Configuration --
    ADMIN_USER: str
    ADMIN_KEY: str
    SECRET_KEY: str

    # -- WestAI / RWTH Proxy Configuration --
    WESTAI_API_KEY: str | None = Field(
        default=None,
        validation_alias=AliasChoices("WESTAI_API_KEY", "RWTH_API_KEY"),
    )
    WESTAI_API_BASE: str | None = Field(
        default="https://llm.hpc.itc.rwth-aachen.de/",
        validation_alias=AliasChoices("WESTAI_API_BASE", "RWTH_API_BASE"),
    )
    WESTAI_LLM_MODEL: str = Field(
        default="mistralai/Mistral-Small-3.2-24B-Instruct-2506",
        validation_alias=AliasChoices("WESTAI_LLM_MODEL", "RWTH_LLM_MODEL"),
    )
    WESTAI_LLM_MODEL_CONTEXT_SUMMARY: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    WESTAI_LLM_MODEL_SUMMARY: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    WESTAI_LLM_MODEL_CARD_GEN: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    WESTAI_LLM_MODEL_WRONG_INTEL_GEN: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    WESTAI_LLM_MODEL_DIALOGUE_OPTIONS: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    WESTAI_LLM_MODEL_CONTENT_GEN: str = "Qwen/Qwen3.8-27B"

    # -- MistralAI Proxy Configuration --
    MISTRAL_API_KEY: str | None = None
    MISTRAL_API_BASE: str | None = "https://api.mistral.ai/v1"
    MISTRAL_LLM_MODEL: str = "mistral-small-latest"
    MISTRAL_LLM_MODEL_CONTEXT_SUMMARY: str = "mistral-small-latest"
    MISTRAL_LLM_MODEL_SUMMARY: str = "mistral-small-latest"
    MISTRAL_LLM_MODEL_CARD_GEN: str = "mistral-small-latest"
    MISTRAL_LLM_MODEL_WRONG_INTEL_GEN: str = "mistral-small-latest"
    MISTRAL_LLM_MODEL_DIALOGUE_OPTIONS: str = "mistral-small-latest"

    # -- Persona Gym Configuration --
    SETTINGS_MODEL: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    QUESTION_MODEL: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    EXAMPLE_MODEL: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    EVAL_1: str = "mistralai/Devstral-Small-2-24B-Instruct-2512"
    EVAL_2: str = 'mistralai/Mistral-Small-3.2-24B-Instruct-2506'  

    # --- GROQ Configuration ---
    GROQ_API_KEY: str | None = None
    GROQ_LLM_MODEL: str = "llama-3.3-70b-versatile"  
    GROQ_LLM_MODEL_CONTEXT_SUMMARY: str = "llama-3.3-70b-versatile" 
    GROQ_LLM_MODEL_SUMMARY: str = "llama-3.3-70b-versatile"  
    GROQ_LLM_MODEL_CARD_GEN: str = "llama-3.3-70b-versatile"
    GROQ_LLM_MODEL_DIALOGUE_OPTIONS: str = "llama-3.3-70b-versatile"
    # --- OpenAI Configuration (Required for evaluation) ---
    OPENAI_API_KEY: str | None = None
    CLAUDE_API_KEY: str | None = None
    LLAMA_API_KEY: str | None = None

    # --- PostgreSQL Configuration ---
    POSTGRES_URI: str = Field(
        default="postgresql+psycopg://mlops_labs:mlops_labs@localhost:5432/mlops_labs",
        description="Synchronous connection URI for PostgreSQL instance.",
    )
    POSTGRES_ASYNC_URI: str = Field(
        default="postgresql+asyncpg://mlops_labs:mlops_labs@localhost:5432/mlops_labs",
        description="Asynchronous connection URI for PostgreSQL instance.",
    )
    POSTGRES_DB_NAME: str = "mlops_labs"
    POSTGRES_LONG_TERM_MEMORY_TABLE: str = "stakeholder_long_term_memory"
    POSTGRES_GAME_CHALLENGE_DATA_TABLE: str = "game_challenge_data"
    POSTGRES_GAME_SESSION_DATA_TABLE: str = "game_session_data"
    POSTGRES_GAME_DATA_TABLE: str = "game_challenge_data"
    POSTGRES_PROGRESSION_DATA_TABLE: str = "game_progression_data"
    POSTGRES_CAMPAIGN_DATA_TABLE: str = "campaign_data"
    POSTGRES_USER_DATA_TABLE: str = "user_data"
    POSTGRES_INTEL_DATA_TABLE: str = "intel_data"
    POSTGRES_GRAPH_OP_LOG_TABLE: str = "graph_op_log"
    POSTGRES_GAME_EVENT_TABLE: str = "game_event"
    POSTGRES_USER_SETTINGS_TABLE: str = "user_settings"
    POSTGRES_GAME_RESULT_TABLE: str = "game_result"
    AUTO_MIGRATE: bool = Field(
        default=True,
        description=(
            "Apply pending alembic revisions when the API starts. Turn off to "
            "manage the schema yourself with `alembic upgrade head`."
        ),
    )

    @property
    def POSTGRES_CHECKPOINTER_URI(self) -> str:
        """Standard PostgreSQL URI (postgresql://...) for psycopg / AsyncPostgresSaver."""
        return (
            self.POSTGRES_ASYNC_URI.replace("postgresql+asyncpg://", "postgresql://")
            .replace("postgresql+psycopg://", "postgresql://")
        )
    # --- Comet ML & Opik Configuration ---
    COMET_API_KEY: str | None = Field(
        default=None, description="API key for Comet ML and Opik services."
    )
    COMET_PROJECT: str = Field(
        default="mlops_serious_game_course",
        description="Project name for Comet ML and Opik tracking.",
    )
    COMET_WORKSPACE: str | None = Field(
        default=None, description="Workspace name for Comet ML and Opik tracking."
    )

    # --- Agents Configuration ---
    TOTAL_MESSAGES_SUMMARY_TRIGGER: int = 1000
    TOTAL_MESSAGES_AFTER_SUMMARY: int = 5

    # --- RAG Configuration ---
    RAG_TEXT_EMBEDDING_MODEL_ID: str = "sentence-transformers/all-MiniLM-L6-v2"
    RAG_TEXT_EMBEDDING_MODEL_DIM: int = 384
    RAG_TOP_K: int = 3
    RAG_THREADS: int | None = None
    RAG_CHUNK_SIZE: int = 256

    # --- Feature flags ---
    ENABLE_GRAPH_DEBUG: bool = False
    # Sends the answer key (true tags, real archetypes, the artifacts behind each note) with the
    # dossier. Never on in production: players could read it straight off the websocket.
    ENABLE_DOSSIER_DEBUG: bool = False
    # Lets a player wipe their own account from the settings panel and start over as a freshly
    # registered user. Never on in production: the only thing between a crafted websocket frame
    # and a deleted account is this flag.
    ENABLE_RESET_USER: bool = False
    # Shows "skip this challenge" and "auto-pitch a card" in the settings panel. They exist to
    # manufacture finished games cheaply while testing the results screen and the admin aggregates,
    # and using either taints the account, which leaves the research data (D10). Never on in
    # production: like the reset, the flag is the only thing between a crafted websocket frame and
    # a fabricated run.
    ENABLE_PLAYTEST_TOOLS: bool = False

    # --- Paths Configuration ---
    EVALUATION_DATASET_FILE_PATH: Path = Path("data/evaluation_dataset.json")
    EXTRACTION_METADATA_FILE_PATH: Path = Path("data/extraction_metadata.json")
    EXTRACTION_STAKEHOLDER_DATA_FILE: Path = Path("data/stakeholder_extraction_data")

import os

settings = Settings()

if settings.COMET_API_KEY:
    os.environ["OPIK_API_KEY"] = settings.COMET_API_KEY
if settings.COMET_PROJECT:
    os.environ["OPIK_PROJECT_NAME"] = settings.COMET_PROJECT
if settings.COMET_WORKSPACE:
    os.environ["OPIK_WORKSPACE"] = settings.COMET_WORKSPACE
