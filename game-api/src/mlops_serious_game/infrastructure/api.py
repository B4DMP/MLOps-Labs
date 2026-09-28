import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from opik.integrations.langchain import OpikTracer

from loguru import logger
from mlops_serious_game.config import settings

from mlops_serious_game.application.pitch_debate_service import reset_conversation_state
from .opik_utils import configure

from mlops_serious_game.infrastructure.middleware.csrf import CSRFMiddleware
from mlops_serious_game.infrastructure.routes.auth_routes import router as auth_router
from mlops_serious_game.infrastructure.routes.admin_routes import router as admin_router
from mlops_serious_game.infrastructure.routes.glossary_routes import router as glossary_router
from mlops_serious_game.infrastructure.routes.teacher_routes import router as teacher_router
from mlops_serious_game.infrastructure.routes.tts_routes import router as tts_router
from mlops_serious_game.infrastructure.websocket.router import router as websocket_router

from mlops_serious_game.infrastructure.database import init_db, init_checkpointer, run_migrations

configure()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup and shutdown events for the API."""
    # Migrations first: on an empty database the revision chain builds the
    # schema, and init_db then only fills in anything alembic does not create.
    run_migrations()
    init_db()
    await init_checkpointer()
    if settings.MISTRAL_API_KEY:
        logger.info(f"LLM Configuration: Using MistralAI proxy with model '{settings.MISTRAL_LLM_MODEL}' (Base URL: {settings.MISTRAL_API_BASE})")
    elif settings.WESTAI_API_KEY:
        logger.info(f"LLM Configuration: Using WestAI proxy with model '{settings.WESTAI_LLM_MODEL}' (Base URL: {settings.WESTAI_API_BASE})")
    else:
        logger.info(f"LLM Configuration: Using Groq with model '{settings.GROQ_LLM_MODEL}'")
    yield
    opik_tracer = OpikTracer()
    opik_tracer.flush()


app = FastAPI(
    title="MLOps Serious Game API",
    description="Unified API & WebSocket Server for MLOps Labs",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    # A wildcard is rejected by browsers once credentials (cookies) are involved, so this has to
    # be the real, configured origin list rather than "*" now that auth rides cookies.
    allow_origins=settings.FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(CSRFMiddleware)

# Include REST Routers
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(teacher_router)
app.include_router(glossary_router)
app.include_router(tts_router)

# Include Unified WebSocket Router (/ws)
app.include_router(websocket_router)


@app.get("/health")
async def health_check():
    """Health check endpoint for container readiness probes."""
    return {"status": "ok"}


@app.post("/reset-memory")
async def reset_conversation():
    """Resets the conversation state."""
    try:
        result = await reset_conversation_state()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
