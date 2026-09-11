from typing import Any
from fastapi import APIRouter, HTTPException, Header, Depends, Query
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import verify_admin_token
from mlops_serious_game.application.services.admin_service import (
    get_admin_dashboard_data,
    add_campaign,
    remove_campaign,
    list_config_files,
    get_config_file,
    save_and_reload_config_file,
    trigger_generate_offline_intel_artifacts
)
from mlops_serious_game.config import settings

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class CampaignAddRequest(BaseModel):
    new_campaign_name: str
    new_campaign_key: str


class ConfigUpdateRequest(BaseModel):
    data: Any


def check_admin_token(authorization: str = Header(None, alias="Authorization")):
    token = ""
    if authorization:
        if authorization.startswith("Bearer "):
            token = authorization.split("Bearer ", 1)[1]
        else:
            token = authorization

    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized admin access")
    return token


@router.get("/dashboard")
async def get_dashboard(_: str = Depends(check_admin_token)):
    data = get_admin_dashboard_data()
    return {"type": "admin_data_update", **data}


@router.post("/campaigns")
async def create_campaign(req: CampaignAddRequest, _: str = Depends(check_admin_token)):
    add_campaign(req.new_campaign_name, req.new_campaign_key)
    data = get_admin_dashboard_data()
    return {"type": "admin_data_update", **data}


@router.delete("/campaigns/{campaign_key}")
async def delete_campaign(campaign_key: str, _: str = Depends(check_admin_token)):
    remove_campaign(campaign_key)
    data = get_admin_dashboard_data()
    return {"type": "admin_data_update", **data}


@router.get("/configs")
async def get_configs(_: str = Depends(check_admin_token)):
    try:
        files = list_config_files()
        return {"type": "config_files_list", "files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/configs/{filename}")
async def get_config_content(filename: str, _: str = Depends(check_admin_token)):
    try:
        file_data = get_config_file(filename)
        return {"type": "config_file_data", **file_data}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/configs/{filename}")
async def update_config(filename: str, req: ConfigUpdateRequest, _: str = Depends(check_admin_token)):
    try:
        save_and_reload_config_file(filename, req.data)
        updated_data = get_config_file(filename)
        dashboard_data = get_admin_dashboard_data()
        return {
            "type": "config_update_success",
            "message": f"Successfully updated and reloaded {filename}!",
            "file": updated_data,
            "dashboard": dashboard_data
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate-offline-intel")
async def generate_offline_intel(_: str = Depends(check_admin_token)):
    try:
        result = await trigger_generate_offline_intel_artifacts()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/graph-debug")
async def get_graph_debug(
    username: str = Query(..., description="Player username to inspect"),
    _: str = Depends(check_admin_token),
):
    if not settings.ENABLE_GRAPH_DEBUG:
        raise HTTPException(status_code=404, detail="Graph debug view is disabled (set ENABLE_GRAPH_DEBUG=true)")
    try:
        from mlops_serious_game.application.graph_service import store as graph_store
        from mlops_serious_game.application.graph_service.debug import build_graph_debug
        from mlops_serious_game.application.graph_service.view import evaluate_graph
        from mlops_serious_game.domain.graph_factory import GraphFactory
        from mlops_serious_game.domain.pattern import PatternFactory
        from mlops_serious_game.domain.phase_factory import PhaseFactory

        graph = GraphFactory.get_graph()
        replay = graph_store.load_state(username)
        op_log = graph_store.load_log(username)
        evaluation = evaluate_graph(
            graph, replay.state, PatternFactory.patterns, PatternFactory.order
        )
        phases = PhaseFactory.get_phases()
        # Derive played templates from the op log — any batch tagged with a non-seed source
        # that references a real template.
        from mlops_serious_game.infrastructure.database.connection import get_session
        from mlops_serious_game.infrastructure.database.models import GraphOpLog
        from sqlalchemy import select
        with get_session() as session:
            rows = session.scalars(
                select(GraphOpLog).where(GraphOpLog.user_name == username)
            ).all()
            played_templates = {
                r.challenge_template for r in rows
                if r.source_kind not in ("challenge_seed",) and r.challenge_template
            }

        payload = build_graph_debug(
            graph=graph,
            state=replay.state,
            knowledge=replay.knowledge,
            effective=evaluation.effective,
            stage_view=evaluation.stage_graph,
            patterns=PatternFactory.patterns,
            active_patterns=evaluation.active_patterns,
            op_log=op_log,
            phases=phases,
            played_templates=played_templates,
        )
        return {"username": username, **payload}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


