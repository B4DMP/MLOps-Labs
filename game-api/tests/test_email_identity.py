"""Players register and log in with their email alone - there is no username anymore."""

import uuid

import pytest
from sqlalchemy import select

from mlops_serious_game.application.services.auth_service import (
    authenticate_user,
    register_user,
)
from mlops_serious_game.infrastructure.database import Campaign, User, get_session

CAMPAIGN_KEY = "email-identity-campaign"
PASSWORD = "correct-horse-battery-staple"


@pytest.fixture(autouse=True)
def _test_campaign():
    """A test campaign, so registration skips verification and needs no SMTP."""
    with get_session() as session:
        campaign = session.scalar(select(Campaign).where(Campaign.campaign_key == CAMPAIGN_KEY))
        if campaign is None:
            session.add(Campaign(campaign_name=CAMPAIGN_KEY, campaign_key=CAMPAIGN_KEY, is_test_campaign=True))
        else:
            campaign.is_test_campaign = True


def _email() -> str:
    return f"identity_{uuid.uuid4().hex[:8]}@example.test"


async def _register(email: str, email_confirm: str | None = None) -> dict:
    return await register_user(email, email_confirm or email, PASSWORD, PASSWORD, 1, CAMPAIGN_KEY)


@pytest.mark.anyio
async def test_registration_needs_only_email_password_and_campaign_key():
    email = _email()

    result = await _register(email)

    assert result["success"] is True
    assert result["email"] == email
    with get_session() as session:
        assert session.scalar(select(User.id).where(User.email == email)) == result["user_id"]


@pytest.mark.anyio
async def test_registration_requires_an_email_even_on_a_test_campaign():
    result = await register_user("", "", PASSWORD, PASSWORD, 1, CAMPAIGN_KEY)

    assert result["success"] is False


@pytest.mark.anyio
async def test_registration_rejects_mismatching_emails():
    result = await _register(_email(), email_confirm=_email())

    assert result == {"success": False, "error": "Email addresses do not match."}


@pytest.mark.anyio
async def test_a_second_account_cannot_reuse_an_email_whatever_its_case():
    email = _email()
    assert (await _register(email))["success"] is True

    duplicate = await _register(email.upper())

    assert duplicate == {"success": False, "error": "An account with this email already exists."}


@pytest.mark.anyio
async def test_login_by_email_is_case_insensitive():
    email = _email()
    registered = await _register(email)

    result = await authenticate_user(email.upper(), PASSWORD)

    assert result["success"] is True
    assert result["user_id"] == registered["user_id"]
    assert result["email"] == email


@pytest.mark.anyio
async def test_login_with_a_wrong_password_or_unknown_email_fails():
    email = _email()
    await _register(email)

    assert (await authenticate_user(email, "wrong"))["success"] is False
    assert (await authenticate_user(_email(), PASSWORD))["success"] is False
