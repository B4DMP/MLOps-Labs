"""Per-account debug flags: on globally or for one account, never leaking to the others."""
from unittest.mock import patch

import pytest

from mlops_serious_game.application import debug_flags
from mlops_serious_game.application.services.admin_service import reset_player
from mlops_serious_game.config import settings

from test_run_scope import _seed_user, _uid, migrated_db  # noqa: F401  (fixture used by name)

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
def _globals_off():
    with patch.object(settings, "ENABLE_GRAPH_DEBUG", False), patch.object(settings, "ENABLE_DOSSIER_DEBUG", False):
        yield


def test_a_flag_is_on_only_for_the_account_it_was_set_for(migrated_db):  # noqa: F811
    _seed_user("dbg_a")
    _seed_user("dbg_b", campaign_key="camp-dbg-b")
    a, b = _uid("dbg_a"), _uid("dbg_b")

    assert debug_flags.set_flags("dbg_a@example.test", {"graph": True})

    assert debug_flags.is_enabled("graph", a)
    assert not debug_flags.is_enabled("graph", b)
    assert not debug_flags.is_enabled("dossier", a)
    assert not debug_flags.is_enabled("graph", None)


def test_the_global_setting_turns_a_flag_on_for_everyone(migrated_db):  # noqa: F811
    _seed_user("dbg_c", campaign_key="camp-dbg-c")
    with patch.object(settings, "ENABLE_DOSSIER_DEBUG", True):
        assert debug_flags.is_enabled("dossier", _uid("dbg_c"))
        assert debug_flags.is_enabled("dossier", None)


def test_setting_one_flag_keeps_the_others_and_rejects_unknown_ones(migrated_db):  # noqa: F811
    _seed_user("dbg_d", campaign_key="camp-dbg-d")
    uid = _uid("dbg_d")
    debug_flags.set_flags("dbg_d@example.test", {"graph": True})
    debug_flags.set_flags("dbg_d@example.test", {"dossier": True})

    assert debug_flags.is_enabled("graph", uid) and debug_flags.is_enabled("dossier", uid)
    with pytest.raises(ValueError):
        debug_flags.set_flags("dbg_d@example.test", {"nope": True})
    assert not debug_flags.set_flags("missing@example.test", {"graph": True})


def test_an_account_reset_keeps_its_debug_flags(migrated_db):  # noqa: F811
    _seed_user("dbg_e", campaign_key="camp-dbg-e")
    uid = _uid("dbg_e")
    debug_flags.set_flags("dbg_e@example.test", {"graph": True})

    reset_player(uid)

    assert debug_flags.is_enabled("graph", uid)
