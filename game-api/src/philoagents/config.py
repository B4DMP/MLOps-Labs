from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", env_file_encoding="utf-8"
    )

    # -- Security & Admin Configuration --
    ADMIN_USER: str
    ADMIN_KEY: str
    SECRET_KEY: str

    # -- RWTH Proxy Configuration
    RWTH_API_KEY: str | None = None
    RWTH_API_BASE: str | None = "https://llm.hpc.itc.rwth-aachen.de/"
    RWTH_LLM_MODEL: str = "openai/gpt-oss-120b"  
    RWTH_LLM_MODEL_ROUTER: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"  
    RWTH_LLM_MODEL_CONTEXT_SUMMARY: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    RWTH_LLM_MODEL_SUMMARY: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"  
    RWTH_LLM_MODEL_CARD_GEN: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"

    # -- Persona Gym Configuration --
    SETTINGS_MODEL: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    QUESTION_MODEL: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    EXAMPLE_MODEL: str = "mistralai/Mistral-Small-3.2-24B-Instruct-2506"
    EVAL_1: str = "mistralai/Devstral-Small-2-24B-Instruct-2512"
    EVAL_2: str = 'mistralai/Mistral-Small-3.2-24B-Instruct-2506'  

    # --- GROQ Configuration ---
    GROQ_API_KEY: str | None = None
    GROQ_LLM_MODEL: str = "openai/gpt-oss-20b"  
    GROQ_LLM_MODEL_ROUTER: str = "openai/gpt-oss-20b"  
    GROQ_LLM_MODEL_CONTEXT_SUMMARY: str = "groq/compound-mini" 
    GROQ_LLM_MODEL_SUMMARY: str = "groq/compound-mini"  
    GROQ_LLM_MODEL_CARD_GEN: str = "openai/gpt-oss-20b"
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
    POSTGRES_GAME_DATA_TABLE: str = "game_data"
    POSTGRES_PROGRESSION_DATA_TABLE: str = "game_progression_data"
    POSTGRES_CAMPAIGN_DATA_TABLE: str = "campaign_data"
    POSTGRES_USER_DATA_TABLE: str = "user_data"

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
        default="philoagents_course",
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
    RAG_DEVICE: str = "cpu"
    RAG_CHUNK_SIZE: int = 256

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
