from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import (
    authenticate_user,
    register_user
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str


class RegisterRequest(BaseModel):
    username: str
    campaign_key: str


@router.post("/login")
async def login(req: LoginRequest):
    result = authenticate_user(req.username)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "login_success", "username": result["username"]}


@router.post("/register")
async def register(req: RegisterRequest):
    result = register_user(req.username, req.campaign_key)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    if result.get("is_admin"):
        return {
            "type": "admin_login_success",
            "token": result["token"]
        }

    return {"type": "register_success", "username": result["username"]}
