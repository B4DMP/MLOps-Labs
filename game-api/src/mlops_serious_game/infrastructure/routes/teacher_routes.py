from fastapi import APIRouter, Depends, HTTPException, Request

from mlops_serious_game.application.services.admin_service import (
    get_campaigns_data,
    get_teacher_dashboard_data,
)
from mlops_serious_game.application.services.auth_service import TEACHER_COOKIE_NAME, verify_teacher_token
from mlops_serious_game.application.services.teacher_service import get_teacher_campaign_keys
from mlops_serious_game.application.services.token_reset_service import player_in_campaigns, reset_and_notify

router = APIRouter(prefix="/api/teacher", tags=["Teacher"])


def check_teacher_token(request: Request) -> dict:
    token = request.cookies.get(TEACHER_COOKIE_NAME, "")
    teacher = verify_teacher_token(token)
    if teacher is None:
        raise HTTPException(status_code=401, detail="Unauthorized teacher access")
    return teacher


@router.get("/campaigns")
async def get_assigned_campaigns(teacher: dict = Depends(check_teacher_token)):
    keys = set(get_teacher_campaign_keys(teacher["id"]))
    campaigns = [c for c in get_campaigns_data() if c["key"] in keys]
    return {"campaigns": campaigns}


@router.get("/dashboard")
async def get_dashboard(campaign: str | None = None, teacher: dict = Depends(check_teacher_token)):
    """Players across every campaign assigned to this teacher, or - if `campaign` names one of
    them - just that one. A campaign the teacher isn't assigned to is silently ignored rather
    than erroring, so a stale filter left over from a removed assignment just falls back to
    "all assigned" instead of surfacing a confusing 403 on every poll."""
    assigned_keys = get_teacher_campaign_keys(teacher["id"])
    scope = [campaign] if campaign and campaign in assigned_keys else assigned_keys
    data = get_teacher_dashboard_data(scope)
    return {"type": "teacher_data_update", **data}


@router.post("/players/{email}/reset-tokens")
async def reset_player_tokens(email: str, teacher: dict = Depends(check_teacher_token)):
    """Refills the attention tokens of a player's current challenge. Only players in the
    teacher's own campaigns; a stranger gets the same 404 as an unknown email."""
    user_id = player_in_campaigns(email, get_teacher_campaign_keys(teacher["id"]))
    if user_id is None:
        raise HTTPException(status_code=404, detail="Unknown player")
    result = await reset_and_notify(user_id, f"Teacher {teacher['id']}")
    if result is None:
        raise HTTPException(status_code=409, detail="This player is not in a challenge right now.")
    return result
