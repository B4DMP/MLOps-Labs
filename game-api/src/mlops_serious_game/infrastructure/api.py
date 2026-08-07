import warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from opik.integrations.langchain import OpikTracer

from philoagents.application.conversation_service.reset_conversation import reset_conversation_state
from .opik_utils import configure

from philoagents.infrastructure.routes.auth_routes import router as auth_router
from philoagents.infrastructure.routes.admin_routes import router as admin_router
from philoagents.infrastructure.websocket.router import router as websocket_router

from philoagents.infrastructure.database import init_db

configure()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handles startup and shutdown events for the API."""
    init_db()
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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST Routers
app.include_router(auth_router)
app.include_router(admin_router)

# Include Unified WebSocket Router (/ws)
app.include_router(websocket_router)


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
