from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from mlops_serious_game.application.services.bug_report_service import submit_bug_report
from mlops_serious_game.infrastructure.routes.auth_routes import get_current_player

router = APIRouter(prefix="/api/bug-reports", tags=["Bug Reports"])

MAX_MESSAGE_LENGTH = 4000


class BugReportRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)
    page_url: str | None = None
    debug_info: dict[str, Any] = Field(default_factory=dict)


@router.post("")
async def create_bug_report(
    req: BugReportRequest, request: Request, user_id: int = Depends(get_current_player)
):
    try:
        result = await submit_bug_report(
            user_id,
            req.message.strip(),
            req.debug_info,
            page_url=req.page_url,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, **result}
