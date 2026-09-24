from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import (
    ADMIN_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    PLAYER_COOKIE_NAME,
    authenticate_user,
    change_password as change_password_service,
    change_username as change_username_service,
    clear_admin_cookie,
    clear_player_cookie,
    confirm_email_change as confirm_email_change_service,
    forgot_password,
    register_user,
    request_email_change as request_email_change_service,
    reset_password,
    set_admin_cookie,
    set_player_cookie,
    sliding_refresh_admin,
    sliding_refresh_player,
    verify_email_code,
    verify_player_token,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _is_secure(request: Request) -> bool:
    return request.url.scheme == "https"


def get_current_player(request: Request) -> str:
    """FastAPI dependency for the profile-management routes below: the cookie-authenticated
    username, or a 401 if there isn't a valid one. Distinct from the websocket's own auth
    (infrastructure/websocket/router.py) - same cookie, same verify_player_token, different
    transport."""
    username = verify_player_token(request.cookies.get(PLAYER_COOKIE_NAME))
    if username is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return username


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
    player_voice_gender: str | None = None


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


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    new_password_confirm: str


class ChangeEmailRequest(BaseModel):
    new_email: str


class ConfirmEmailChangeRequest(BaseModel):
    code: str


class ChangeUsernameRequest(BaseModel):
    new_username: str
    current_password: str


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response):
    result = await authenticate_user(req.username, req.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    if result.get("is_admin"):
        set_admin_cookie(
            response, secure=_is_secure(request), existing_csrf=request.cookies.get(CSRF_COOKIE_NAME)
        )
        return {"type": "admin_login_success"}

    if result.get("needs_verification"):
        return {"type": "verification_required", "username": result["username"]}

    set_player_cookie(
        response, result["username"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "login_success", "username": result["username"]}


@router.post("/register")
async def register(req: RegisterRequest, request: Request, response: Response):
    result = await register_user(
        req.username,
        req.email,
        req.email_confirm,
        req.password,
        req.password_confirm,
        req.users_on_machine,
        req.campaign_key,
        req.player_voice_gender,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    if result.get("is_admin"):
        set_admin_cookie(
            response, secure=_is_secure(request), existing_csrf=request.cookies.get(CSRF_COOKIE_NAME)
        )
        return {"type": "admin_login_success"}

    if result.get("skip_verification"):
        set_player_cookie(
            response, result["username"], secure=_is_secure(request),
            existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
        )
        return {"type": "login_success", "username": result["username"]}

    return {"type": "register_pending_verification", "username": result["username"]}


@router.post("/verify-email")
async def verify_email(req: VerifyEmailRequest, request: Request, response: Response):
    result = verify_email_code(req.username, req.code)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    set_player_cookie(
        response, result["username"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "login_success", "username": result["username"]}


@router.post("/forgot-password")
async def request_password_reset(req: ForgotPasswordRequest):
    result = await forgot_password(req.username, req.email)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "password_reset_code_sent", "username": result["username"]}


@router.post("/reset-password")
async def perform_password_reset(req: ResetPasswordRequest, request: Request, response: Response):
    result = reset_password(req.username, req.code, req.new_password, req.new_password_confirm)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    set_player_cookie(
        response, result["username"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "login_success", "username": result["username"]}


@router.get("/whoami")
async def whoami(request: Request, response: Response):
    """Always 200 - "nobody is logged in" is a normal answer, not an error. Also the sliding-
    expiration keepalive target: any near-expiry cookie present gets silently reissued here."""
    secure = _is_secure(request)
    existing_csrf = request.cookies.get(CSRF_COOKIE_NAME)
    player_username = sliding_refresh_player(
        request.cookies.get(PLAYER_COOKIE_NAME), response, secure=secure, existing_csrf=existing_csrf
    )
    admin_valid = sliding_refresh_admin(
        request.cookies.get(ADMIN_COOKIE_NAME), response, secure=secure, existing_csrf=existing_csrf
    )
    return {
        "player": {"username": player_username} if player_username else None,
        "admin": {"valid": True} if admin_valid else None,
    }


@router.post("/logout")
async def logout(response: Response):
    clear_player_cookie(response)
    return {"success": True}


@router.post("/admin-logout")
async def admin_logout(response: Response):
    clear_admin_cookie(response)
    return {"success": True}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest, username: str = Depends(get_current_player)
):
    result = change_password_service(
        username, req.current_password, req.new_password, req.new_password_confirm
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "password_changed"}


@router.post("/change-email")
async def change_email(
    req: ChangeEmailRequest, username: str = Depends(get_current_player)
):
    result = await request_email_change_service(username, req.new_email)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "email_change_code_sent"}


@router.post("/confirm-email-change")
async def confirm_email_change(
    req: ConfirmEmailChangeRequest, username: str = Depends(get_current_player)
):
    result = confirm_email_change_service(username, req.code)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "email_changed"}


@router.post("/change-username")
async def change_username(
    req: ChangeUsernameRequest, request: Request, response: Response,
    username: str = Depends(get_current_player),
):
    result = change_username_service(username, req.new_username, req.current_password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    # No token round-trips through the client at all - the cookie itself carries the new
    # identity from here on (docs/plans/session-persistence-and-url-routing.md, Profile
    # management: "the client must receive this new token" from the first draft is replaced by
    # just re-setting the cookie directly).
    set_player_cookie(
        response, result["username"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "username_changed", "username": result["username"]}
