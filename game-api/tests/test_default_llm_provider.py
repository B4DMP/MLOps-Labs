"""The admin-configured server-wide default LLM provider and its place in the resolution
order: per-campaign override > admin-configured default > hardcoded env-key fallback."""

from test_run_scope import _seed_user, migrated_db  # noqa: F401  (fixture used by name)


def _set_campaign_provider(campaign_key: str, provider: str | None) -> None:
    from mlops_serious_game.infrastructure.database.connection import get_session
    from mlops_serious_game.infrastructure.database.models import Campaign

    with get_session() as session:
        campaign = session.query(Campaign).filter_by(campaign_key=campaign_key).one()
        campaign.llm_provider = provider


def test_default_provider_is_unset_until_configured(migrated_db):
    from mlops_serious_game.application.services.default_llm_provider_service import (
        get_default_llm_provider,
    )

    assert get_default_llm_provider() is None


def test_update_then_get_round_trips(migrated_db):
    from mlops_serious_game.application.services.default_llm_provider_service import (
        get_default_llm_provider,
        update_default_llm_provider,
    )

    assert update_default_llm_provider("groq") == "groq"
    assert get_default_llm_provider() == "groq"

    assert update_default_llm_provider(None) is None
    assert get_default_llm_provider() is None


def test_player_provider_prefers_campaign_override_over_admin_default(migrated_db):
    from mlops_serious_game.application.services.auth_service import get_player_llm_provider
    from mlops_serious_game.application.services.default_llm_provider_service import (
        update_default_llm_provider,
    )

    user_id = _seed_user("alice", "camp-1")
    update_default_llm_provider("groq")
    _set_campaign_provider("camp-1", "westai")

    assert get_player_llm_provider(user_id) == "westai"


def test_player_provider_falls_back_to_admin_default_without_campaign_override(migrated_db):
    from mlops_serious_game.application.services.auth_service import get_player_llm_provider
    from mlops_serious_game.application.services.default_llm_provider_service import (
        update_default_llm_provider,
    )

    user_id = _seed_user("bob", "camp-2")
    update_default_llm_provider("mistral")

    assert get_player_llm_provider(user_id) == "mistral"


def test_player_provider_is_none_when_nothing_is_configured(migrated_db):
    from mlops_serious_game.application.services.auth_service import get_player_llm_provider

    user_id = _seed_user("carol", "camp-3")

    assert get_player_llm_provider(user_id) is None
