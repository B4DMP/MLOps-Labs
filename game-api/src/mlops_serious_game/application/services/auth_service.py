import datetime
import random
import re
from datetime import timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Response
from jwt.exceptions import InvalidTokenError
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from mlops_serious_game.application.services import user_settings_service
from mlops_serious_game.application.services.email_service import build_code_email, send_email
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.database import Campaign, Teacher, User, get_session

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120

# Reissue a cookie once its token has less than half its lifetime left, so a session that stays
# active (even only over the websocket - see the frontend keepalive) never expires mid-game.
_SLIDING_REFRESH_THRESHOLD = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES / 2)

PLAYER_COOKIE_NAME = "mlops_player"
ADMIN_COOKIE_NAME = "mlops_admin"
TEACHER_COOKIE_NAME = "mlops_teacher"
CSRF_COOKIE_NAME = "mlops_csrf"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MIN_PASSWORD_LENGTH = 8


class UserData(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    campaign_key: str
    email: str


class CampaignData(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    campaign_key: str
    campaign_name: str


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str | None) -> dict | None:
    """Returns the token's payload, or None if it's missing, malformed, or expired."""
    if not token:
        return None
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except InvalidTokenError:
        return None


def verify_admin_token(token: str) -> bool:
    payload = decode_token(token)
    return payload is not None and payload.get("sub") == settings.ADMIN_USER


def _teacher_row_exists(teacher_id: int) -> bool:
    """Same reasoning as player_exists: a signature-valid token naming a teacher row that has
    since been deleted (by an admin, e.g. removing course staff after a semester) must stop
    working here, not stay "valid" until the JWT itself expires."""
    with get_session() as session:
        return session.scalar(select(Teacher.id).where(Teacher.id == teacher_id)) is not None


def verify_teacher_token(token: str | None) -> dict | None:
    """Returns {"id", "user_name"} for a valid, unexpired teacher token naming a teacher that
    still exists, else None. Used directly by the teacher routes' auth dependency, unlike the
    admin/player checks which are split into a boolean verify + a separate sliding-refresh."""
    payload = decode_token(token)
    if payload is None or payload.get("role") != "teacher":
        return None
    teacher_id = payload.get("teacher_id")
    username = payload.get("sub")
    if teacher_id is None or username is None or not _teacher_row_exists(teacher_id):
        return None
    return {"id": teacher_id, "user_name": username}


def player_exists(user_id: int) -> bool:
    """Whether a `User` row still backs this id."""
    with get_session() as session:
        return session.scalar(select(User.id).where(User.id == user_id)) is not None


def _player_id_from_payload(payload: dict | None) -> int | None:
    """The `User.id` a valid player payload names, if that user still exists."""
    if payload is None or payload.get("role") != "player":
        return None
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    return user_id if player_exists(user_id) else None


def verify_player_token(token: str) -> int | None:
    """Returns the token's user id if it's a valid, unexpired player token naming a user that
    still exists, else None.

    The token itself is a self-contained, signed JWT: it verifies against nothing but its own
    signature and expiry, so it would otherwise stay "valid" after the row it names is gone (a
    database reset, an account deletion) - every call site trusts this for DB writes keyed by
    user id, so a stale-but-unexpired cookie must fail here, not reach a NOT NULL constraint deep
    in a handler.
    """
    return _player_id_from_payload(decode_token(token))


def get_player_email(user_id: int) -> str | None:
    with get_session() as session:
        return session.scalar(select(User.email).where(User.id == user_id))


def _create_player_token(user_id: int) -> str:
    return create_access_token(data={"sub": str(user_id), "role": "player"})


def _create_admin_token() -> str:
    return create_access_token(
        data={"sub": settings.ADMIN_USER},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def _create_teacher_token(teacher_id: int, username: str) -> str:
    return create_access_token(data={"sub": username, "role": "teacher", "teacher_id": teacher_id})


def _generate_csrf_token() -> str:
    import secrets
    return secrets.token_urlsafe(32)


def _set_csrf_cookie_if_absent(response: Response, *, existing: str | None, secure: bool) -> None:
    if existing:
        return
    # Not a secret - a random nonce the frontend reads back and echoes as a header, so it must
    # stay JS-readable (httponly=False) for the double-submit check to work at all.
    response.set_cookie(
        CSRF_COOKIE_NAME,
        _generate_csrf_token(),
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def set_player_cookie(
    response: Response, user_id: int, *, secure: bool, existing_csrf: str | None = None
) -> None:
    response.set_cookie(
        PLAYER_COOKIE_NAME,
        _create_player_token(user_id),
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    _set_csrf_cookie_if_absent(response, existing=existing_csrf, secure=secure)


def set_admin_cookie(response: Response, *, secure: bool, existing_csrf: str | None = None) -> None:
    response.set_cookie(
        ADMIN_COOKIE_NAME,
        _create_admin_token(),
        httponly=True,
        secure=secure,
        samesite="lax",
        # Scoped to /api, not just /api/admin: /api/auth/whoami (which every screen calls to
        # check both sessions) is outside /api/admin, so a tighter scope would never let whoami
        # see this cookie at all. /api still excludes the one thing worth excluding - /ws, which
        # admin never needs.
        path="/api",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    _set_csrf_cookie_if_absent(response, existing=existing_csrf, secure=secure)


def set_teacher_cookie(
    response: Response, teacher_id: int, username: str, *, secure: bool, existing_csrf: str | None = None
) -> None:
    response.set_cookie(
        TEACHER_COOKIE_NAME,
        _create_teacher_token(teacher_id, username),
        httponly=True,
        secure=secure,
        samesite="lax",
        # Same reasoning as the admin cookie: the teacher dashboard is REST-polled, never over
        # the websocket, so it never needs to be visible at /ws.
        path="/api",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    _set_csrf_cookie_if_absent(response, existing=existing_csrf, secure=secure)


def clear_player_cookie(response: Response) -> None:
    response.delete_cookie(PLAYER_COOKIE_NAME, path="/")


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE_NAME, path="/api")


def clear_teacher_cookie(response: Response) -> None:
    response.delete_cookie(TEACHER_COOKIE_NAME, path="/api")


def _remaining_lifetime(payload: dict) -> timedelta:
    exp = datetime.datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    return exp - datetime.datetime.now(timezone.utc)


def sliding_refresh_player(
    token: str | None, response: Response, *, secure: bool, existing_csrf: str | None = None
) -> str | None:
    """If the player token is valid and close to expiring, reissue its cookie on `response`.
    Returns the current user id, or None if the token isn't a valid player token for a user that
    still exists - this is what `/auth/whoami` reports back as "logged in", so a stale cookie left
    over from before a database reset must read as logged-out here, not be reissued forever."""
    payload = decode_token(token)
    user_id = _player_id_from_payload(payload)
    if user_id is None:
        return None
    if _remaining_lifetime(payload) < _SLIDING_REFRESH_THRESHOLD:
        set_player_cookie(response, user_id, secure=secure, existing_csrf=existing_csrf)
    return user_id


def sliding_refresh_admin(
    token: str | None, response: Response, *, secure: bool, existing_csrf: str | None = None
) -> bool:
    """Same as sliding_refresh_player, for the admin cookie. Returns whether the token is
    currently a valid admin token."""
    payload = decode_token(token)
    if payload is None or payload.get("sub") != settings.ADMIN_USER:
        return False
    if _remaining_lifetime(payload) < _SLIDING_REFRESH_THRESHOLD:
        set_admin_cookie(response, secure=secure, existing_csrf=existing_csrf)
    return True


def sliding_refresh_teacher(
    token: str | None, response: Response, *, secure: bool, existing_csrf: str | None = None
) -> dict | None:
    """Same as sliding_refresh_admin, for the teacher cookie. Returns {"id", "user_name"} for a
    currently-valid teacher token, else None."""
    teacher = verify_teacher_token(token)
    if teacher is None:
        return None
    payload = decode_token(token)
    if _remaining_lifetime(payload) < _SLIDING_REFRESH_THRESHOLD:
        set_teacher_cookie(response, teacher["id"], teacher["user_name"], secure=secure, existing_csrf=existing_csrf)
    return teacher


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


async def _send_code_email(to_email: str, code: str, purpose: str) -> None:
    """Raises ValueError (via email_service.send_email) if delivery fails - callers must
    surface this to the user, since the code is never shown anywhere else."""
    ttl = settings.VERIFICATION_CODE_TTL_MINUTES
    subject, body, html = build_code_email(purpose, code, ttl)
    await send_email(to_email=to_email, subject=subject, body=body, html_body=html)


def _find_user_by_email(session, email: str) -> User | None:
    """Case-insensitive, since some rows predate email normalisation."""
    return session.scalar(select(User).where(func.lower(User.email) == email.lower()))


async def authenticate_user(login: str, password: str) -> dict:
    """`login` is the player's email; admin and teacher accounts still sign in by their name."""
    login = login.strip() if login else ""
    password = password or ""

    if not login or not password:
        return {"success": False, "error": "Email and password are required."}

    # Admin bootstrap: the admin account has no User row - the login screen is where the admin signs in.
    if login == settings.ADMIN_USER and password == settings.ADMIN_KEY:
        access_token = create_access_token(
            data={"sub": settings.ADMIN_USER},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        return {"success": True, "is_admin": True, "token": access_token}

    # Teacher accounts live in their own table (created only by an admin, never by
    # self-registration - see teacher_service.create_teacher), so this is checked before the
    # player lookup below rather than folded into it.
    with get_session() as session:
        teacher = session.scalar(select(Teacher).where(Teacher.user_name == login))
        if teacher is not None:
            if not verify_password(password, teacher.password_hash):
                return {"success": False, "error": "Invalid email or password."}
            return {
                "success": True,
                "is_teacher": True,
                "teacher_id": teacher.id,
                "username": teacher.user_name,
            }

    with get_session() as session:
        user = _find_user_by_email(session, login)
        if user is None or not verify_password(password, user.password_hash):
            return {"success": False, "error": "Invalid email or password."}

        campaign = session.scalar(select(Campaign).where(Campaign.id == user.campaign_id))
        if campaign is not None and not campaign.is_active:
            return {"success": False, "error": "This campaign is currently inactive. Login is disabled."}

        if not user.is_verified:
            code = _generate_code()
            user.verification_code = code
            user.verification_code_expires_at = (
                datetime.datetime.utcnow() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
            )
            email = user.email
        else:
            return {
                "success": True,
                "is_admin": False,
                "needs_verification": False,
                "user_id": user.id,
                "email": user.email,
            }

    try:
        await _send_code_email(email, code, "verification")
    except Exception as e:
        logger.error(f"Could not send verification email to {email}: {e}")
        return {
            "success": False,
            "error": "We couldn't send a verification email right now. Please try again shortly.",
        }

    return {"success": True, "is_admin": False, "needs_verification": True, "email": email}


async def register_user(
    email: str,
    email_confirm: str,
    password: str,
    password_confirm: str,
    users_on_machine: int,
    campaign_key: str,
    player_voice_gender: str | None = None,
) -> dict:
    email = email.strip().lower() if email else ""
    email_confirm = email_confirm.strip().lower() if email_confirm else ""
    password = password or ""
    password_confirm = password_confirm or ""
    campaign_key = campaign_key.strip() if campaign_key else ""
    # A preference, not a security field - garbage or an unset value quietly falls back to the
    # default rather than failing registration over it.
    if player_voice_gender not in user_settings_service.PLAYER_VOICE_GENDER_VALUES:
        player_voice_gender = user_settings_service.DEFAULT_SETTINGS["player_voice_gender"]

    if not email or not password or not campaign_key:
        return {"success": False, "error": "All fields are required."}
    if password != password_confirm:
        return {"success": False, "error": "Passwords do not match."}
    if not isinstance(users_on_machine, int) or users_on_machine < 1:
        return {"success": False, "error": "Please enter how many people play on this device (at least 1)."}

    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        if campaign is None:
            return {"success": False, "error": "Campaign key not found."}
        if not campaign.is_active:
            return {"success": False, "error": "This campaign is currently inactive. Registration is disabled."}

        # Test campaigns skip verification entirely and don't enforce the password length
        # policy - this is the only place that decides any of that, the frontend has no notion
        # of "test campaign". ENABLE_DEV_ACCOUNTS extends the same path to
        # every campaign, for a local dev environment with no SMTP configured.
        is_test_campaign = campaign.is_test_campaign or settings.ENABLE_DEV_ACCOUNTS
        # A lighter opt-out than is_test_campaign: still requires a real email and password, but
        # never sends a code - the account is auto-verified straight away.
        skip_email_verification = is_test_campaign or not campaign.require_email_verification

        if not is_test_campaign and len(password) < _MIN_PASSWORD_LENGTH:
            return {"success": False, "error": f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long."}

        if email != email_confirm:
            return {"success": False, "error": "Email addresses do not match."}
        if not _EMAIL_RE.match(email):
            return {"success": False, "error": "Please enter a valid email address."}

        if _find_user_by_email(session, email) is not None:
            return {"success": False, "error": "An account with this email already exists."}

        if skip_email_verification:
            new_user = User(
                campaign_key=campaign_key,
                campaign_id=campaign.id,
                email=email,
                password_hash=hash_password(password),
                users_on_machine=users_on_machine,
                is_verified=True,
            )
            session.add(new_user)
            session.flush()
            new_user_id = new_user.id
        else:
            code = _generate_code()
            new_user = User(
                campaign_key=campaign_key,
                campaign_id=campaign.id,
                email=email,
                password_hash=hash_password(password),
                users_on_machine=users_on_machine,
                is_verified=False,
                verification_code=code,
                verification_code_expires_at=(
                    datetime.datetime.utcnow() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
                ),
            )
            session.add(new_user)
            session.flush()
            new_user_id = new_user.id

    # The `with` block above has now committed the new user, so `user_settings_service` (which
    # opens its own session) can see the row - it would be a silent no-op if called any earlier.
    user_settings_service.update_settings(new_user_id, {"player_voice_gender": player_voice_gender})

    if skip_email_verification:
        return {
            "success": True,
            "is_admin": False,
            "skip_verification": True,
            "user_id": new_user_id,
            "email": email,
        }

    try:
        await _send_code_email(email, code, "verification")
    except Exception as e:
        logger.error(f"Could not send verification email to {email}: {e}")
        return {
            "success": False,
            "error": (
                "Your account was created, but we couldn't send the verification email right "
                "now. Please try logging in again shortly to get a new code."
            ),
        }

    return {"success": True, "is_admin": False, "email": email}


def verify_email_code(email: str, code: str) -> dict:
    email = email.strip() if email else ""
    code = code.strip() if code else ""

    if not email or not code:
        return {"success": False, "error": "Email and code are required."}

    with get_session() as session:
        user = _find_user_by_email(session, email)
        if user is None:
            return {"success": False, "error": "Invalid email or code."}

        if not user.is_verified:
            if not user.verification_code or not user.verification_code_expires_at:
                return {
                    "success": False,
                    "error": "No verification code is pending. Please log in again to request a new one.",
                }
            if datetime.datetime.utcnow() > user.verification_code_expires_at:
                return {
                    "success": False,
                    "error": "This code has expired. Please log in again to request a new one.",
                }
            if user.verification_code != code:
                return {"success": False, "error": "Invalid verification code."}

            user.is_verified = True
            user.verification_code = None
            user.verification_code_expires_at = None

        return {"success": True, "user_id": user.id, "email": user.email}


async def forgot_password(email: str) -> dict:
    email = email.strip() if email else ""

    if not email:
        return {"success": False, "error": "Email is required."}

    with get_session() as session:
        user = _find_user_by_email(session, email)
        if user is None:
            return {"success": False, "error": "No account found for that email."}

        code = _generate_code()
        user.password_reset_code = code
        user.password_reset_code_expires_at = (
            datetime.datetime.utcnow() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
        )
        user_email = user.email

    try:
        await _send_code_email(user_email, code, "password_reset")
    except Exception as e:
        logger.error(f"Could not send password reset email to {user_email}: {e}")
        return {
            "success": False,
            "error": "We couldn't send a password reset email right now. Please try again shortly.",
        }

    return {"success": True, "email": user_email}


def reset_password(email: str, code: str, new_password: str, new_password_confirm: str) -> dict:
    email = email.strip() if email else ""
    code = code.strip() if code else ""
    new_password = new_password or ""
    new_password_confirm = new_password_confirm or ""

    if not email or not code or not new_password:
        return {"success": False, "error": "All fields are required."}
    if new_password != new_password_confirm:
        return {"success": False, "error": "Passwords do not match."}
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        return {"success": False, "error": f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long."}

    with get_session() as session:
        user = _find_user_by_email(session, email)
        if user is None:
            return {"success": False, "error": "Invalid email or code."}

        if not user.password_reset_code or not user.password_reset_code_expires_at:
            return {
                "success": False,
                "error": "No password reset is pending. Please request a new code.",
            }
        if datetime.datetime.utcnow() > user.password_reset_code_expires_at:
            return {"success": False, "error": "This code has expired. Please request a new one."}
        if user.password_reset_code != code:
            return {"success": False, "error": "Invalid reset code."}

        user.password_hash = hash_password(new_password)
        user.password_reset_code = None
        user.password_reset_code_expires_at = None
        user.is_verified = True

        return {"success": True, "user_id": user.id, "email": user.email}


# --- Profile management (docs/plans/session-persistence-and-url-routing.md) ---
# Reachable while already logged in, cookie-authenticated - a different trust boundary from the
# pre-login flows above, which is why each of these re-verifies the current password rather than
# just trusting the session for anything identity-changing.

def change_password(user_id: int, current_password: str, new_password: str, new_password_confirm: str) -> dict:
    current_password = current_password or ""
    new_password = new_password or ""
    new_password_confirm = new_password_confirm or ""

    if not current_password or not new_password:
        return {"success": False, "error": "All fields are required."}
    if new_password != new_password_confirm:
        return {"success": False, "error": "Passwords do not match."}
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        return {"success": False, "error": f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long."}

    with get_session() as session:
        user = session.scalar(select(User).where(User.id == user_id))
        if user is None or not verify_password(current_password, user.password_hash):
            return {"success": False, "error": "Current password is incorrect."}

        user.password_hash = hash_password(new_password)

    return {"success": True}


async def request_email_change(user_id: int, new_email: str) -> dict:
    new_email = new_email.strip().lower() if new_email else ""

    if not new_email:
        return {"success": False, "error": "A new email address is required."}
    if not _EMAIL_RE.match(new_email):
        return {"success": False, "error": "Please enter a valid email address."}

    with get_session() as session:
        user = session.scalar(select(User).where(User.id == user_id))
        if user is None:
            return {"success": False, "error": "Account not found."}
        if user.email.lower() == new_email.lower():
            return {"success": False, "error": "That's already your current email address."}
        if _find_user_by_email(session, new_email) is not None:
            return {"success": False, "error": "An account with this email already exists."}

        code = _generate_code()
        user.pending_email = new_email
        user.email_change_code = code
        user.email_change_code_expires_at = (
            datetime.datetime.utcnow() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
        )

    try:
        # Sent to the *new* address, not the old one - that's what actually stops a typo'd or
        # someone-else's address from silently taking over the account: only the person who can
        # read mail at the new address can produce the code that finishes the change.
        await _send_code_email(new_email, code, "email_change")
    except Exception as e:
        logger.error(f"Could not send email-change verification to {new_email}: {e}")
        return {
            "success": False,
            "error": "We couldn't send a verification email right now. Please try again shortly.",
        }

    return {"success": True}


def confirm_email_change(user_id: int, code: str) -> dict:
    code = code.strip() if code else ""
    if not code:
        return {"success": False, "error": "A code is required."}

    with get_session() as session:
        user = session.scalar(select(User).where(User.id == user_id))
        if user is None:
            return {"success": False, "error": "Account not found."}

        if not user.pending_email or not user.email_change_code or not user.email_change_code_expires_at:
            return {
                "success": False,
                "error": "No email change is pending. Please request a new code.",
            }
        if datetime.datetime.utcnow() > user.email_change_code_expires_at:
            return {"success": False, "error": "This code has expired. Please request a new one."}
        if user.email_change_code != code:
            return {"success": False, "error": "Invalid code."}

        user.email = user.pending_email
        user.pending_email = None
        user.email_change_code = None
        user.email_change_code_expires_at = None

    return {"success": True}
