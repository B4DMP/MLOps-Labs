from typing import Any
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import verify_admin_token
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

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class CampaignAddRequest(BaseModel):
    new_campaign_name: str
    new_campaign_key: str
    is_active: bool = True
    use_questionnaire: bool = True


class CampaignUpdateRequest(BaseModel):
    is_active: bool | None = None
    use_questionnaire: bool | None = None
    campaign_name: str | None = None


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
async def get_dashboard(campaign: str | None = None, _: str = Depends(check_admin_token)):
    data = get_admin_dashboard_data(campaign=campaign)
    return {"type": "admin_data_update", **data}


@router.post("/campaigns")
async def create_campaign(req: CampaignAddRequest, _: str = Depends(check_admin_token)):
    add_campaign(
        new_campaign_name=req.new_campaign_name,
        new_campaign_key=req.new_campaign_key,
        is_active=req.is_active,
        use_questionnaire=req.use_questionnaire,
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
            campaign_name=req.campaign_name,
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


