from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from mlops_serious_game.application.services.auth_service import (
    ADMIN_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    PLAYER_COOKIE_NAME,
    TEACHER_COOKIE_NAME,
    authenticate_user,
    change_password as change_password_service,
    clear_admin_cookie,
    clear_impersonation_cookie,
    clear_player_cookie,
    clear_teacher_cookie,
    confirm_email_change as confirm_email_change_service,
    forgot_password,
    get_player_email,
    register_user,
    request_email_change as request_email_change_service,
    reset_password,
    resolve_player,
    set_admin_cookie,
    set_player_cookie,
    set_teacher_cookie,
    sliding_refresh_admin,
    sliding_refresh_impersonation,
    sliding_refresh_player,
    sliding_refresh_teacher,
    verify_email_code,
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _is_secure(request: Request) -> bool:
    return request.url.scheme == "https"


def get_current_player(request: Request) -> int:
    """FastAPI dependency for the profile-management routes below: the cookie-authenticated
    user id, or a 401 if there isn't a valid one. Distinct from the websocket's own auth
    (infrastructure/websocket/router.py) - same cookie, same verify_player_token, different
    transport."""
    resolved = resolve_player(request.cookies)
    if resolved is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    user_id, is_impersonation = resolved
    if is_impersonation:
        raise HTTPException(status_code=403, detail="Account changes are disabled while viewing as a player.")
    return user_id


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    email_confirm: str
    password: str
    password_confirm: str
    users_on_machine: int
    campaign_key: str
    player_voice_gender: str | None = None


class VerifyEmailRequest(BaseModel):
    email: str
    code: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
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


@router.post("/login")
async def login(req: LoginRequest, request: Request, response: Response):
    result = await authenticate_user(req.email, req.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    if result.get("is_admin"):
        set_admin_cookie(
            response, secure=_is_secure(request), existing_csrf=request.cookies.get(CSRF_COOKIE_NAME)
        )
        return {"type": "admin_login_success"}

    if result.get("is_teacher"):
        set_teacher_cookie(
            response, result["teacher_id"], result["username"],
            secure=_is_secure(request), existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
        )
        return {"type": "teacher_login_success", "username": result["username"]}

    if result.get("needs_verification"):
        return {"type": "verification_required", "email": result["email"]}

    set_player_cookie(
        response, result["user_id"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "login_success", "user_id": result["user_id"], "email": result["email"]}


@router.post("/register")
async def register(req: RegisterRequest, request: Request, response: Response):
    result = await register_user(
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

    if result.get("skip_verification"):
        set_player_cookie(
            response, result["user_id"], secure=_is_secure(request),
            existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
        )
        return {"type": "login_success", "user_id": result["user_id"], "email": result["email"]}

    return {"type": "register_pending_verification", "email": result["email"]}


@router.post("/verify-email")
async def verify_email(req: VerifyEmailRequest, request: Request, response: Response):
    result = verify_email_code(req.email, req.code)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    set_player_cookie(
        response, result["user_id"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "login_success", "user_id": result["user_id"], "email": result["email"]}


@router.post("/forgot-password")
async def request_password_reset(req: ForgotPasswordRequest):
    result = await forgot_password(req.email)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "password_reset_code_sent", "email": result["email"]}


@router.post("/reset-password")
async def perform_password_reset(req: ResetPasswordRequest, request: Request, response: Response):
    result = reset_password(req.email, req.code, req.new_password, req.new_password_confirm)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    set_player_cookie(
        response, result["user_id"], secure=_is_secure(request),
        existing_csrf=request.cookies.get(CSRF_COOKIE_NAME),
    )
    return {"type": "login_success", "user_id": result["user_id"], "email": result["email"]}


@router.get("/whoami")
async def whoami(request: Request, response: Response):
    """Always 200 - "nobody is logged in" is a normal answer, not an error. Also the sliding-
    expiration keepalive target: any near-expiry cookie present gets silently reissued here."""
    secure = _is_secure(request)
    existing_csrf = request.cookies.get(CSRF_COOKIE_NAME)
    player_token = request.cookies.get(PLAYER_COOKIE_NAME)
    player_id = sliding_refresh_player(
        player_token, response, secure=secure, existing_csrf=existing_csrf
    )
    if player_token and player_id is None:
        # A signature-valid cookie naming a user that no longer exists (e.g. a database reset) -
        # stop sending it back rather than reporting "logged out" on every request forever.
        clear_player_cookie(response)
    admin_valid = sliding_refresh_admin(
        request.cookies.get(ADMIN_COOKIE_NAME), response, secure=secure, existing_csrf=existing_csrf
    )
    teacher = sliding_refresh_teacher(
        request.cookies.get(TEACHER_COOKIE_NAME), response, secure=secure, existing_csrf=existing_csrf
    )
    impersonated_id = sliding_refresh_impersonation(
        request.cookies, response, secure=secure, existing_csrf=existing_csrf
    )
    return {
        "player": {"id": player_id, "email": get_player_email(player_id)} if player_id else None,
        "admin": {"valid": True} if admin_valid else None,
        "teacher": {"id": teacher["id"], "user_name": teacher["user_name"]} if teacher else None,
        "impersonating": (
            {"id": impersonated_id, "email": get_player_email(impersonated_id)}
            if impersonated_id
            else None
        ),
    }


@router.post("/logout")
async def logout(response: Response):
    clear_player_cookie(response)
    return {"success": True}


@router.post("/admin-logout")
async def admin_logout(response: Response):
    clear_admin_cookie(response)
    return {"success": True}


@router.post("/impersonate/stop")
async def stop_impersonation(response: Response):
    clear_impersonation_cookie(response)
    return {"success": True}


@router.post("/teacher-logout")
async def teacher_logout(response: Response):
    clear_teacher_cookie(response)
    return {"success": True}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest, user_id: int = Depends(get_current_player)
):
    result = change_password_service(
        user_id, req.current_password, req.new_password, req.new_password_confirm
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "password_changed"}


@router.post("/change-email")
async def change_email(
    req: ChangeEmailRequest, user_id: int = Depends(get_current_player)
):
    result = await request_email_change_service(user_id, req.new_email)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "email_change_code_sent"}


@router.post("/confirm-email-change")
async def confirm_email_change(
    req: ConfirmEmailChangeRequest, user_id: int = Depends(get_current_player)
):
    result = confirm_email_change_service(user_id, req.code)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"type": "email_changed"}
