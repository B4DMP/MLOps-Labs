"""`/api/admin/deploy/version` reports the running build; it once broke on a missing import."""
from unittest.mock import patch

import pytest

from mlops_serious_game.config import settings
from mlops_serious_game.infrastructure.routes import admin_routes


@pytest.mark.anyio
async def test_deploy_version_returns_the_build_sha():
    with patch.object(settings, "GIT_SHA", "abc123"):
        assert await admin_routes.get_deploy_version("token") == {"git_sha": "abc123"}
