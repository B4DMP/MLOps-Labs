import datetime
import random
import re
from datetime import timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError
from loguru import logger
from pydantic import BaseModel, Field
from sqlalchemy import select

from mlops_serious_game.application.services.email_service import build_code_email, send_email
from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.database import Campaign, User, get_session

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_MIN_PASSWORD_LENGTH = 8


class UserData(BaseModel):
    id: Optional[str] = Field(None, alias="_id")
    campaign_key: str
    user_name: str


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


def verify_admin_token(token: str) -> bool:
    if not token:
        return False
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub") == settings.ADMIN_USER
    except InvalidTokenError:
        return False


def _create_player_token(username: str) -> str:
    return create_access_token(data={"sub": username, "role": "player"})


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


async def _send_code_email(to_email: str, username: str, code: str, purpose: str) -> None:
    """Raises ValueError (via email_service.send_email) if delivery fails - callers must
    surface this to the user, since the code is never shown anywhere else."""
    ttl = settings.VERIFICATION_CODE_TTL_MINUTES
    subject, body, html = build_code_email(purpose, username, code, ttl)
    await send_email(to_email=to_email, subject=subject, body=body, html_body=html)


async def authenticate_user(username: str, password: str) -> dict:
    username = username.strip() if username else ""
    password = password or ""

    if not username or not password:
        return {"success": False, "error": "Username and password are required."}

    # Admin bootstrap: the admin account has no User row (see register_user's own copy of this
    # check) - the register form now requires email/password fields the admin never fills in, so
    # this needs to also work straight from the plain username+password login screen.
    if username == settings.ADMIN_USER and password == settings.ADMIN_KEY:
        access_token = create_access_token(
            data={"sub": settings.ADMIN_USER},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        return {"success": True, "is_admin": True, "token": access_token}

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user is None or not _verify_password(password, user.password_hash):
            return {"success": False, "error": "Invalid username or password."}

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
                "username": username,
                "token": _create_player_token(username),
            }

    try:
        await _send_code_email(email, username, code, "verification")
    except Exception as e:
        logger.error(f"Could not send verification email to {email}: {e}")
        return {
            "success": False,
            "error": "We couldn't send a verification email right now. Please try again shortly.",
        }

    return {"success": True, "is_admin": False, "needs_verification": True, "username": username}


async def register_user(
    username: str,
    email: str,
    email_confirm: str,
    password: str,
    password_confirm: str,
    users_on_machine: int,
    campaign_key: str,
) -> dict:
    username = username.strip() if username else ""
    email = email.strip() if email else ""
    email_confirm = email_confirm.strip() if email_confirm else ""
    password = password or ""
    password_confirm = password_confirm or ""
    campaign_key = campaign_key.strip() if campaign_key else ""

    if campaign_key == settings.ADMIN_KEY and username == settings.ADMIN_USER:
        access_token = create_access_token(
            data={"sub": settings.ADMIN_USER},
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        )
        return {
            "success": True,
            "is_admin": True,
            "token": access_token
        }

    if not username or not password or not campaign_key:
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

        # Test campaigns don't require an email, skip verification entirely, and don't enforce
        # the password length policy - this is the only place that decides any of that, the
        # frontend has no notion of "test campaign". ENABLE_DEV_ACCOUNTS extends the same path to
        # every campaign, for a local dev environment with no SMTP configured.
        is_test_campaign = campaign.is_test_campaign or settings.ENABLE_DEV_ACCOUNTS
        # A lighter opt-out than is_test_campaign: still requires a real email and password, but
        # never sends a code - the account is auto-verified straight away.
        skip_email_verification = is_test_campaign or not campaign.require_email_verification

        if not is_test_campaign and len(password) < _MIN_PASSWORD_LENGTH:
            return {"success": False, "error": f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long."}

        if not is_test_campaign and not email:
            return {"success": False, "error": "Email is required."}
        if email or email_confirm:
            if email != email_confirm:
                return {"success": False, "error": "Email addresses do not match."}
            if not _EMAIL_RE.match(email):
                return {"success": False, "error": "Please enter a valid email address."}

        if session.scalar(select(User).where(User.user_name == username)) is not None:
            return {"success": False, "error": "This username already exists. Please choose another username."}

        if email:
            if session.scalar(select(User).where(User.email == email)) is not None:
                return {"success": False, "error": "An account with this email already exists."}
        else:
            # Unique, non-routable placeholder (RFC 2606) - the email column stays NOT NULL/
            # UNIQUE for every account, this one is just never used to send anything.
            email = f"{username}@test-campaign.invalid"

        if skip_email_verification:
            new_user = User(
                user_name=username,
                campaign_key=campaign_key,
                campaign_id=campaign.id,
                email=email,
                password_hash=_hash_password(password),
                users_on_machine=users_on_machine,
                is_verified=True,
            )
            session.add(new_user)
            return {
                "success": True,
                "is_admin": False,
                "skip_verification": True,
                "username": username,
                "token": _create_player_token(username),
            }

        code = _generate_code()
        new_user = User(
            user_name=username,
            campaign_key=campaign_key,
            campaign_id=campaign.id,
            email=email,
            password_hash=_hash_password(password),
            users_on_machine=users_on_machine,
            is_verified=False,
            verification_code=code,
            verification_code_expires_at=(
                datetime.datetime.utcnow() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
            ),
        )
        session.add(new_user)

    try:
        await _send_code_email(email, username, code, "verification")
    except Exception as e:
        logger.error(f"Could not send verification email to {email}: {e}")
        return {
            "success": False,
            "error": (
                "Your account was created, but we couldn't send the verification email right "
                "now. Please try logging in again shortly to get a new code."
            ),
        }

    return {"success": True, "is_admin": False, "username": username}


def verify_email_code(username: str, code: str) -> dict:
    username = username.strip() if username else ""
    code = code.strip() if code else ""

    if not username or not code:
        return {"success": False, "error": "Username and code are required."}

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user is None:
            return {"success": False, "error": "Invalid username or code."}

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

        return {"success": True, "username": username, "token": _create_player_token(username)}


async def forgot_password(username: str, email: str) -> dict:
    username = username.strip() if username else ""
    email = email.strip() if email else ""

    if not username or not email:
        return {"success": False, "error": "Username and email are required."}

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user is None or user.email.lower() != email.lower():
            return {"success": False, "error": "No account found matching that username and email."}

        code = _generate_code()
        user.password_reset_code = code
        user.password_reset_code_expires_at = (
            datetime.datetime.utcnow() + timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES)
        )
        user_email = user.email

    try:
        await _send_code_email(user_email, username, code, "password_reset")
    except Exception as e:
        logger.error(f"Could not send password reset email to {user_email}: {e}")
        return {
            "success": False,
            "error": "We couldn't send a password reset email right now. Please try again shortly.",
        }

    return {"success": True, "username": username}


def reset_password(username: str, code: str, new_password: str, new_password_confirm: str) -> dict:
    username = username.strip() if username else ""
    code = code.strip() if code else ""
    new_password = new_password or ""
    new_password_confirm = new_password_confirm or ""

    if not username or not code or not new_password:
        return {"success": False, "error": "All fields are required."}
    if new_password != new_password_confirm:
        return {"success": False, "error": "Passwords do not match."}
    if len(new_password) < _MIN_PASSWORD_LENGTH:
        return {"success": False, "error": f"Password must be at least {_MIN_PASSWORD_LENGTH} characters long."}

    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == username))
        if user is None:
            return {"success": False, "error": "Invalid username or code."}

        if not user.password_reset_code or not user.password_reset_code_expires_at:
            return {
                "success": False,
                "error": "No password reset is pending. Please request a new code.",
            }
        if datetime.datetime.utcnow() > user.password_reset_code_expires_at:
            return {"success": False, "error": "This code has expired. Please request a new one."}
        if user.password_reset_code != code:
            return {"success": False, "error": "Invalid reset code."}

        user.password_hash = _hash_password(new_password)
        user.password_reset_code = None
        user.password_reset_code_expires_at = None
        user.is_verified = True

        return {"success": True, "username": username, "token": _create_player_token(username)}
