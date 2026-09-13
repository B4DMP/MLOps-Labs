import datetime
from datetime import timedelta, timezone
from typing import Optional
import jwt
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, Field
from sqlalchemy import select

from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.database import Campaign, User, get_session

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120


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


def authenticate_user(username: str) -> dict:
    if not username or not username.strip():
        return {"success": False, "error": "Username cannot be empty."}

    clean_username = username.strip()
    with get_session() as session:
        user = session.scalar(select(User).where(User.user_name == clean_username))
        if user is not None:
            campaign = session.scalar(select(Campaign).where(Campaign.id == user.campaign_id))
            if campaign is not None and not campaign.is_active:
                return {"success": False, "error": "This campaign is currently inactive. Login is disabled."}
            return {"success": True, "username": clean_username}
        else:
            return {"success": False, "error": "Username not found."}


def register_user(username: str, campaign_key: str) -> dict:
    username = username.strip() if username else ""
    campaign_key = campaign_key.strip() if campaign_key else ""

    if not username or not campaign_key:
        return {"success": False, "error": "Username and Campaign Key are required."}

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

    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == campaign_key))
        if campaign is None:
            return {"success": False, "error": "Campaign key not found."}
        if not campaign.is_active:
            return {"success": False, "error": "This campaign is currently inactive. Registration is disabled."}

        existing_user = session.scalar(select(User).where(User.user_name == username))
        if existing_user is not None:
            return {"success": False, "error": "This username already exists. Please choose another username."}

        new_user = User(user_name=username, campaign_key=campaign_key, campaign_id=campaign.id)
        session.add(new_user)
        return {"success": True, "is_admin": False, "username": username}
