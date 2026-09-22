from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import (
    authenticate_user,
    forgot_password,
    register_user,
    reset_password,
    verify_email_code,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    email: str
    email_confirm: str
    password: str
    password_confirm: str
    users_on_machine: int
    campaign_key: str


class VerifyEmailRequest(BaseModel):
    username: str
    code: str


class ForgotPasswordRequest(BaseModel):
    username: str
    email: str


class ResetPasswordRequest(BaseModel):
    username: str
    code: str
    new_password: str
    new_password_confirm: str


@router.post("/login")
async def login(req: LoginRequest):
    result = await authenticate_user(req.username, req.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    if result.get("is_admin"):
        return {"type": "admin_login_success", "token": result["token"]}

    if result.get("needs_verification"):
        return {"type": "verification_required", "username": result["username"]}

    return {"type": "login_success", "username": result["username"], "token": result["token"]}


@router.post("/register")
async def register(req: RegisterRequest):
    result = await register_user(
        req.username,
        req.email,
        req.email_confirm,
        req.password,
        req.password_confirm,
        req.users_on_machine,
        req.campaign_key,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    if result.get("is_admin"):
        return {"type": "admin_login_success", "token": result["token"]}

    if result.get("skip_verification"):
        return {"type": "login_success", "username": result["username"], "token": result["token"]}

    return {"type": "register_pending_verification", "username": result["username"]}


@router.post("/verify-email")
async def verify_email(req: VerifyEmailRequest):
    result = verify_email_code(req.username, req.code)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "login_success", "username": result["username"], "token": result["token"]}


@router.post("/forgot-password")
async def request_password_reset(req: ForgotPasswordRequest):
    result = await forgot_password(req.username, req.email)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "password_reset_code_sent", "username": result["username"]}


@router.post("/reset-password")
async def perform_password_reset(req: ResetPasswordRequest):
    result = reset_password(req.username, req.code, req.new_password, req.new_password_confirm)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "login_success", "username": result["username"], "token": result["token"]}
