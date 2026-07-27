import datetime
from datetime import timedelta, timezone
import jwt
from jwt.exceptions import InvalidTokenError
from pydantic import BaseModel, Field
from typing import Optional

from philoagents.config import settings
from philoagents.infrastructure.mongo.client import MongoClientWrapper

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

    with MongoClientWrapper(model=UserData, collection_name=settings.MONGO_USER_DATA_COLLECTION) as mongo:
        query = {"user_name": username.strip()}
        results: list[UserData] = mongo.fetch_documents(limit=1, query=query)
        if len(results) > 0:
            return {"success": True, "username": username.strip()}
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

    with MongoClientWrapper(model=CampaignData, collection_name=settings.MONGO_CAMPAIGN_DATA_COLLECTION) as campaign_mongo:
        campaign_query = {"campaign_key": campaign_key}
        c_results: list[CampaignData] = campaign_mongo.fetch_documents(limit=1, query=campaign_query)
        if len(c_results) == 0:
            return {"success": False, "error": "Campaign key not found."}

    with MongoClientWrapper(model=UserData, collection_name=settings.MONGO_USER_DATA_COLLECTION) as user_mongo:
        username_query = {"user_name": username}
        u_results: list[UserData] = user_mongo.fetch_documents(limit=1, query=username_query)
        if len(u_results) > 0:
            return {"success": False, "error": "This username already exists. Please choose another username."}

        user_mongo.ingest_documents([
            UserData(user_name=username, campaign_key=campaign_key)
        ])
        return {"success": True, "is_admin": False, "username": username}
