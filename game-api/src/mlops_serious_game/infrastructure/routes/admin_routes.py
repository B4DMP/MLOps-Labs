from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel

from philoagents.application.services.auth_service import verify_admin_token
from philoagents.application.services.admin_service import (
    get_admin_dashboard_data,
    add_campaign,
    remove_campaign
)

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class CampaignAddRequest(BaseModel):
    new_campaign_name: str
    new_campaign_key: str


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
