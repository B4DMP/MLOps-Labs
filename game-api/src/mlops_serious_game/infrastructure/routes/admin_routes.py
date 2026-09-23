from typing import Any, Literal
from fastapi import APIRouter, HTTPException, Depends, Query, Request
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import ADMIN_COOKIE_NAME, verify_admin_token
from mlops_serious_game.application.services.admin_service import (
    get_admin_dashboard_data,
    add_campaign,
    update_campaign,
    remove_campaign,
    remove_player,
    remove_all_players,
    list_config_files,
    get_config_file,
    save_and_reload_config_file,
    trigger_generate_offline_intel_artifacts
)
from mlops_serious_game.application.services.admin_results import (
    get_player_results,
    get_results_dashboard,
)
from mlops_serious_game.config import settings

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class CampaignAddRequest(BaseModel):
    new_campaign_name: str
    new_campaign_key: str
    is_active: bool = True
    use_questionnaire: bool = True
    allow_replay: bool = False
    is_test_campaign: bool = False
    require_email_verification: bool = True


class CampaignUpdateRequest(BaseModel):
    is_active: bool | None = None
    use_questionnaire: bool | None = None
    allow_replay: bool | None = None
    campaign_name: str | None = None
    is_test_campaign: bool | None = None
    require_email_verification: bool | None = None


class ConfigUpdateRequest(BaseModel):
    data: Any


def check_admin_token(request: Request):
    token = request.cookies.get(ADMIN_COOKIE_NAME, "")
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="Unauthorized admin access")
    return token


@router.get("/dashboard")
async def get_dashboard(campaign: str | None = None, _: str = Depends(check_admin_token)):
    data = get_admin_dashboard_data(campaign=campaign)
    return {"type": "admin_data_update", **data}


@router.get("/results")
async def get_results(
    campaign: str | None = None,
    include_playtest: bool = False,
    runs: Literal["first", "all"] = "first",
    _: str = Depends(check_admin_token),
):
    """Campaign aggregates over finished runs. Playtest accounts and replays are left out unless
    asked for, so the default numbers are the ones a study can stand behind."""
    return get_results_dashboard(campaign, include_playtest=include_playtest, runs=runs)


@router.get("/results/player/{player_name}")
async def get_player_results_route(
    player_name: str,
    run: int | None = None,
    refresh: bool = False,
    _: str = Depends(check_admin_token),
):
    try:
        return get_player_results(player_name, run, refresh=refresh)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/campaigns")
async def create_campaign(req: CampaignAddRequest, _: str = Depends(check_admin_token)):
    add_campaign(
        new_campaign_name=req.new_campaign_name,
        new_campaign_key=req.new_campaign_key,
        is_active=req.is_active,
        use_questionnaire=req.use_questionnaire,
        allow_replay=req.allow_replay,
        is_test_campaign=req.is_test_campaign,
        require_email_verification=req.require_email_verification,
    )
    data = get_admin_dashboard_data()
    return {"type": "admin_data_update", **data}


@router.patch("/campaigns/{campaign_key}")
async def patch_campaign(campaign_key: str, req: CampaignUpdateRequest, _: str = Depends(check_admin_token)):
    try:
        update_campaign(
            campaign_key=campaign_key,
            is_active=req.is_active,
            use_questionnaire=req.use_questionnaire,
            allow_replay=req.allow_replay,
            campaign_name=req.campaign_name,
            is_test_campaign=req.is_test_campaign,
            require_email_verification=req.require_email_verification,
        )
        data = get_admin_dashboard_data()
        return {"type": "admin_data_update", **data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update campaign: {str(e)}")


@router.delete("/campaigns/{campaign_key}")
async def delete_campaign(campaign_key: str, _: str = Depends(check_admin_token)):
    remove_campaign(campaign_key)
    data = get_admin_dashboard_data()
    return {"type": "admin_data_update", **data}


@router.delete("/players")
async def delete_all_players(_: str = Depends(check_admin_token)):
    try:
        remove_all_players()
        data = get_admin_dashboard_data()
        return {"type": "admin_data_update", **data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete all players: {str(e)}")


@router.delete("/players/{player_name}")
async def delete_player(player_name: str, _: str = Depends(check_admin_token)):
    try:
        remove_player(player_name)
        data = get_admin_dashboard_data()
        return {"type": "admin_data_update", **data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete player: {str(e)}")


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
        from mlops_serious_game.infrastructure.database.user_lookup import get_user_id
        from sqlalchemy import select
        with get_session() as session:
            rows = session.scalars(
                select(GraphOpLog).where(GraphOpLog.user_id == get_user_id(session, username))
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


class TestEmailRequest(BaseModel):
    recipient_email: str
    # "generic" (default) sends the plain SMTP-connectivity test below. "verification" /
    # "password_reset" send the exact same styled code email a player would get, with a
    # placeholder code, to any address - for previewing/testing that template without touching
    # any real player account.
    template: str = "generic"


@router.get("/email/status")
async def get_smtp_status(_: str = Depends(check_admin_token)):
    from mlops_serious_game.application.services.email_service import get_email_status
    try:
        status = get_email_status()
        return {"type": "smtp_status", **status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/email/test")
async def send_test_email(req: TestEmailRequest, _: str = Depends(check_admin_token)):
    from mlops_serious_game.application.services.email_service import build_code_email, send_email
    from mlops_serious_game.config import settings
    try:
        if req.template in ("verification", "password_reset"):
            subject, text_body, html_body = build_code_email(
                req.template, "Test Player", "123456", settings.VERIFICATION_CODE_TTL_MINUTES
            )
        else:
            subject = "MLOps Serious Game - SMTP Test Email"
            text_body = (
                "Hello,\n\n"
                "This is a test email sent from the MLOps Serious Game Admin Panel.\n"
                "If you are receiving this message, your SMTP configuration is working properly!\n\n"
                "Best regards,\n"
                "MLOps Serious Game Platform"
            )
            html_body = (
                "<div style='font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;'>"
                "<h2 style='color: #11303e;'>MLOps Serious Game - SMTP Test</h2>"
                "<p>This is a test email sent from the <strong>MLOps Serious Game Admin Panel</strong>.</p>"
                "<p style='color: #10b981; font-weight: bold;'>Your SMTP configuration is working properly!</p>"
                "<hr style='border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;' />"
                "<small style='color: #64748b;'>Delivered via configured SMTP</small>"
                "</div>"
            )
        await send_email(
            to_email=req.recipient_email,
            subject=subject,
            body=text_body,
            html_body=html_body,
        )
        return {
            "type": "email_test_success",
            "message": f"Test email successfully sent to {req.recipient_email}!",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

